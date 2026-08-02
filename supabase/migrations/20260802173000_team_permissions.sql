begin;

create table public.store_invitations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  email text not null check (email = lower(trim(email)) and char_length(email) between 5 and 254),
  role text not null check (role in ('admin', 'manager', 'operator', 'viewer')),
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by uuid not null references auth.users(id) on delete restrict,
  accepted_by uuid references auth.users(id) on delete restrict,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create unique index store_invitations_pending_email_idx
  on public.store_invitations (store_id, email)
  where status = 'pending';
create index store_invitations_store_created_idx
  on public.store_invitations (store_id, created_at desc);

alter table public.store_invitations enable row level security;

create policy store_invitations_select_admin
on public.store_invitations for select to authenticated
using ((select private.has_store_role(store_id, array['owner', 'admin'])));

revoke all on public.store_invitations from anon, authenticated;
grant select on public.store_invitations to authenticated;

drop policy if exists store_members_insert_admin on public.store_members;
drop policy if exists store_members_update_admin on public.store_members;
drop policy if exists store_members_delete_admin on public.store_members;
revoke insert, update, delete on public.store_members from authenticated;

create or replace function private.bootstrap_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  created_store_id uuid;
  invitation public.store_invitations;
  invitation_token text;
  profile_name text;
  store_name text;
  store_slug text;
begin
  profile_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1));
  invitation_token := nullif(trim(new.raw_user_meta_data ->> 'invite_token'), '');

  insert into public.profiles (user_id, full_name)
  values (new.id, left(profile_name, 120));

  if invitation_token is not null then
    select * into invitation
    from public.store_invitations
    where token_hash = encode(extensions.digest(invitation_token, 'sha256'), 'hex')
      and email = lower(trim(new.email))
      and status = 'pending'
      and expires_at > now()
    for update;

    if not found then
      raise exception 'Convite inválido, expirado ou destinado a outro e-mail' using errcode = '22023';
    end if;

    insert into public.store_members (store_id, user_id, role)
    values (invitation.store_id, new.id, invitation.role);

    update public.store_invitations
    set status = 'accepted', accepted_by = new.id, accepted_at = now()
    where id = invitation.id;
  else
    store_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'store_name'), ''), 'Minha loja');
    store_slug := left(lower(regexp_replace(store_name, '[^a-zA-Z0-9]+', '-', 'g')), 45)
      || '-' || left(replace(new.id::text, '-', ''), 8);

    insert into public.stores (name, slug)
    values (left(store_name, 120), store_slug)
    returning id into created_store_id;

    insert into public.store_members (store_id, user_id, role)
    values (created_store_id, new.id, 'owner');
  end if;

  return new;
end;
$$;

revoke all on function private.bootstrap_new_user() from public, anon, authenticated;

create or replace function private.create_team_invitation(
  p_store_id uuid,
  p_email text,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  normalized_email text := lower(trim(p_email));
  actor_role text;
  existing_user_id uuid;
  existing_member_role text;
  raw_token text;
  created_invitation public.store_invitations;
begin
  if not private.has_store_role(p_store_id, array['owner', 'admin']) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'E-mail inválido' using errcode = '22023';
  end if;
  if p_role not in ('admin', 'manager', 'operator', 'viewer') then
    raise exception 'Função inválida' using errcode = '22023';
  end if;

  select role into actor_role
  from public.store_members
  where store_id = p_store_id and user_id = (select auth.uid()) and active;

  if not private.is_platform_admin() and actor_role = 'admin' and p_role = 'admin' then
    raise exception 'Somente o proprietário pode conceder acesso de administrador' using errcode = '42501';
  end if;

  select id into existing_user_id
  from auth.users
  where lower(email) = normalized_email
  limit 1;

  if existing_user_id is not null then
    select role into existing_member_role
    from public.store_members
    where store_id = p_store_id and user_id = existing_user_id;

    if existing_member_role = 'owner' then
      raise exception 'O proprietário já pertence à loja' using errcode = '23505';
    end if;

    insert into public.store_members (store_id, user_id, role, active)
    values (p_store_id, existing_user_id, p_role, true)
    on conflict (store_id, user_id) do update
      set role = excluded.role, active = true;

    return jsonb_build_object('status', 'added', 'user_id', existing_user_id);
  end if;

  update public.store_invitations
  set status = 'revoked'
  where store_id = p_store_id and email = normalized_email and status = 'pending';

  raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.store_invitations (store_id, email, role, token_hash, invited_by)
  values (
    p_store_id,
    normalized_email,
    p_role,
    encode(extensions.digest(raw_token, 'sha256'), 'hex'),
    (select auth.uid())
  ) returning * into created_invitation;

  return jsonb_build_object(
    'status', 'pending',
    'invitation_id', created_invitation.id,
    'token', raw_token,
    'expires_at', created_invitation.expires_at
  );
end;
$$;

create or replace function private.update_team_member(
  p_store_id uuid,
  p_user_id uuid,
  p_role text,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor_role text;
  target_role text;
begin
  if not private.has_store_role(p_store_id, array['owner', 'admin']) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if p_role not in ('admin', 'manager', 'operator', 'viewer') then
    raise exception 'Função inválida' using errcode = '22023';
  end if;
  if p_user_id = (select auth.uid()) then
    raise exception 'Seu próprio acesso não pode ser alterado por esta tela' using errcode = '42501';
  end if;

  select role into actor_role from public.store_members
  where store_id = p_store_id and user_id = (select auth.uid()) and active;
  select role into target_role from public.store_members
  where store_id = p_store_id and user_id = p_user_id;

  if target_role is null then
    raise exception 'Integrante não encontrado' using errcode = 'P0002';
  end if;
  if target_role = 'owner' then
    raise exception 'O acesso do proprietário não pode ser alterado' using errcode = '42501';
  end if;
  if not private.is_platform_admin() and actor_role = 'admin' and (target_role = 'admin' or p_role = 'admin') then
    raise exception 'Administrador não pode alterar outro administrador' using errcode = '42501';
  end if;

  update public.store_members
  set role = p_role, active = p_active
  where store_id = p_store_id and user_id = p_user_id;
end;
$$;

create or replace function private.cancel_team_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  target_store_id uuid;
begin
  select store_id into target_store_id
  from public.store_invitations
  where id = p_invitation_id and status = 'pending';

  if target_store_id is null or not private.has_store_role(target_store_id, array['owner', 'admin']) then
    raise exception 'Convite não encontrado ou acesso negado' using errcode = '42501';
  end if;

  update public.store_invitations set status = 'revoked' where id = p_invitation_id;
end;
$$;

create or replace function private.list_store_team(p_store_id uuid)
returns table (
  user_id uuid,
  full_name text,
  email text,
  role text,
  active boolean,
  joined_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select membership.user_id, profile.full_name, account.email::text, membership.role,
    membership.active, membership.created_at
  from public.store_members membership
  join public.profiles profile on profile.user_id = membership.user_id
  join auth.users account on account.id = membership.user_id
  where membership.store_id = p_store_id
    and private.has_store_role(p_store_id, array['owner', 'admin'])
  order by (membership.role = 'owner') desc, profile.full_name;
$$;

revoke all on function private.create_team_invitation(uuid, text, text),
  private.update_team_member(uuid, uuid, text, boolean),
  private.cancel_team_invitation(uuid), private.list_store_team(uuid)
  from public, anon;
grant execute on function private.create_team_invitation(uuid, text, text),
  private.update_team_member(uuid, uuid, text, boolean),
  private.cancel_team_invitation(uuid), private.list_store_team(uuid)
  to authenticated;

create function public.create_team_invitation(p_store_id uuid, p_email text, p_role text)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, private
as $$ select private.create_team_invitation(p_store_id, p_email, p_role); $$;

create function public.update_team_member(p_store_id uuid, p_user_id uuid, p_role text, p_active boolean)
returns void
language sql
security invoker
set search_path = pg_catalog, public, private
as $$ select private.update_team_member(p_store_id, p_user_id, p_role, p_active); $$;

create function public.cancel_team_invitation(p_invitation_id uuid)
returns void
language sql
security invoker
set search_path = pg_catalog, public, private
as $$ select private.cancel_team_invitation(p_invitation_id); $$;

create function public.list_store_team(p_store_id uuid)
returns table (user_id uuid, full_name text, email text, role text, active boolean, joined_at timestamptz)
language sql
stable
security invoker
set search_path = pg_catalog, public, private
as $$ select * from private.list_store_team(p_store_id); $$;

revoke all on function public.create_team_invitation(uuid, text, text),
  public.update_team_member(uuid, uuid, text, boolean),
  public.cancel_team_invitation(uuid), public.list_store_team(uuid)
  from public, anon;
grant execute on function public.create_team_invitation(uuid, text, text),
  public.update_team_member(uuid, uuid, text, boolean),
  public.cancel_team_invitation(uuid), public.list_store_team(uuid)
  to authenticated;

create or replace function private.list_store_products(p_store_id uuid)
returns table (
  id uuid,
  store_id uuid,
  sku text,
  name text,
  category text,
  cost_cents integer,
  price_cents integer,
  stock_quantity integer,
  min_stock integer,
  color text,
  active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select product.id, product.store_id, product.sku, product.name, product.category,
    case
      when private.has_store_role(p_store_id, array['owner', 'admin', 'manager'])
        then product.cost_cents
      else null
    end as cost_cents,
    product.price_cents, product.stock_quantity, product.min_stock, product.color,
    product.active, product.created_at, product.updated_at
  from public.products product
  where product.store_id = p_store_id
    and product.active
    and private.is_store_member(p_store_id)
  order by product.name;
$$;

revoke all on function private.list_store_products(uuid) from public, anon;
grant execute on function private.list_store_products(uuid) to authenticated;

create function public.list_store_products(p_store_id uuid)
returns table (
  id uuid,
  store_id uuid,
  sku text,
  name text,
  category text,
  cost_cents integer,
  price_cents integer,
  stock_quantity integer,
  min_stock integer,
  color text,
  active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = pg_catalog, public, private
as $$ select * from private.list_store_products(p_store_id); $$;

revoke all on function public.list_store_products(uuid) from public, anon;
grant execute on function public.list_store_products(uuid) to authenticated;
revoke select on public.products from authenticated;

drop policy if exists financial_entries_select_member on public.financial_entries;
create policy financial_entries_select_management on public.financial_entries
for select to authenticated
using ((select private.has_store_role(store_id, array['owner', 'admin', 'manager'])));

drop policy if exists suppliers_select_member on public.suppliers;
create policy suppliers_select_management on public.suppliers
for select to authenticated
using ((select private.has_store_role(store_id, array['owner', 'admin', 'manager'])));

drop policy if exists purchases_select_member on public.purchases;
create policy purchases_select_management on public.purchases
for select to authenticated
using ((select private.has_store_role(store_id, array['owner', 'admin', 'manager'])));

drop policy if exists purchase_items_select_member on public.purchase_items;
create policy purchase_items_select_management on public.purchase_items
for select to authenticated
using ((select private.has_store_role(store_id, array['owner', 'admin', 'manager'])));

drop policy if exists sales_select_member on public.sales;
create policy sales_select_authorized on public.sales
for select to authenticated
using (
  (select private.has_store_role(store_id, array['owner', 'admin', 'manager', 'viewer']))
  or sold_by = (select auth.uid())
);

drop policy if exists sale_items_select_member on public.sale_items;
create policy sale_items_select_authorized on public.sale_items
for select to authenticated
using (exists (
  select 1 from public.sales sale
  where sale.id = sale_id
    and (
      private.has_store_role(sale.store_id, array['owner', 'admin', 'manager', 'viewer'])
      or sale.sold_by = (select auth.uid())
    )
));

drop policy if exists sale_payments_select_member on public.sale_payments;
create policy sale_payments_select_authorized on public.sale_payments
for select to authenticated
using (exists (
  select 1 from public.sales sale
  where sale.id = sale_id
    and (
      private.has_store_role(sale.store_id, array['owner', 'admin', 'manager', 'viewer'])
      or sale.sold_by = (select auth.uid())
    )
));

drop policy if exists cash_sessions_select_member on public.cash_sessions;
create policy cash_sessions_select_authorized on public.cash_sessions
for select to authenticated
using (
  (select private.has_store_role(store_id, array['owner', 'admin', 'manager']))
  or operator_id = (select auth.uid())
);

drop policy if exists cash_movements_select_member on public.cash_movements;
create policy cash_movements_select_authorized on public.cash_movements
for select to authenticated
using (exists (
  select 1 from public.cash_sessions session
  where session.id = cash_session_id
    and (
      private.has_store_role(session.store_id, array['owner', 'admin', 'manager'])
      or session.operator_id = (select auth.uid())
    )
));

drop policy if exists cash_reconciliations_select_member on public.cash_reconciliations;
create policy cash_reconciliations_select_authorized on public.cash_reconciliations
for select to authenticated
using (exists (
  select 1 from public.cash_sessions session
  where session.id = cash_session_id
    and (
      private.has_store_role(session.store_id, array['owner', 'admin', 'manager'])
      or session.operator_id = (select auth.uid())
    )
));

drop policy if exists inventory_movements_select_member on public.inventory_movements;
create policy inventory_movements_select_authorized on public.inventory_movements
for select to authenticated
using (
  (select private.has_store_role(store_id, array['owner', 'admin', 'manager', 'viewer']))
  or created_by = (select auth.uid())
);

commit;
