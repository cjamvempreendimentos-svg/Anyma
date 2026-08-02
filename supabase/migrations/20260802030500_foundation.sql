begin;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.store_members (
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'manager', 'operator', 'viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (store_id, user_id)
);

create index store_members_user_active_idx
  on public.store_members (user_id, store_id)
  where active;

create table public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  sku text not null check (char_length(sku) between 1 and 60),
  name text not null check (char_length(name) between 2 and 160),
  category text not null default 'Sem categoria' check (char_length(category) between 1 and 80),
  cost_cents integer not null default 0 check (cost_cents >= 0),
  price_cents integer not null check (price_cents >= 0),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  min_stock integer not null default 0 check (min_stock >= 0),
  color text not null default '#70745a' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, sku)
);

create index products_store_active_name_idx
  on public.products (store_id, active, name);
create index products_low_stock_idx
  on public.products (store_id, stock_quantity, min_stock)
  where active;

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  payment_method text not null check (payment_method in ('Pix', 'Crédito', 'Débito', 'Dinheiro')),
  total_cents integer not null check (total_cents >= 0),
  customer_name text not null default 'Consumidor final',
  sold_by uuid not null references auth.users(id) on delete restrict,
  sold_at timestamptz not null default now()
);

create index sales_store_sold_at_idx
  on public.sales (store_id, sold_at desc);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  sale_id uuid not null references public.sales(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  subtotal_cents integer not null check (subtotal_cents >= 0)
);

create index sale_items_sale_idx on public.sale_items (sale_id);
create index sale_items_store_product_idx on public.sale_items (store_id, product_id);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  movement_type text not null check (movement_type in ('opening', 'purchase', 'adjustment', 'sale', 'return')),
  quantity_delta integer not null check (quantity_delta <> 0),
  reason text not null default '',
  sale_id uuid references public.sales(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index inventory_movements_store_product_created_idx
  on public.inventory_movements (store_id, product_id, created_at desc);

create or replace function private.is_store_member(target_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select exists (
    select 1
    from public.store_members membership
    where membership.store_id = target_store_id
      and membership.user_id = (select auth.uid())
      and membership.active
  );
$$;

create or replace function private.has_store_role(target_store_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select exists (
    select 1
    from public.store_members membership
    where membership.store_id = target_store_id
      and membership.user_id = (select auth.uid())
      and membership.active
      and membership.role = any(allowed_roles)
  );
$$;

revoke all on function private.is_store_member(uuid) from public, anon;
revoke all on function private.has_store_role(uuid, text[]) from public, anon;
grant execute on function private.is_store_member(uuid) to authenticated;
grant execute on function private.has_store_role(uuid, text[]) to authenticated;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();
create trigger stores_set_updated_at
before update on public.stores
for each row execute function private.set_updated_at();
create trigger products_set_updated_at
before update on public.products
for each row execute function private.set_updated_at();

create or replace function private.bootstrap_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  created_store_id uuid;
  profile_name text;
  store_name text;
  store_slug text;
begin
  profile_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1));
  store_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'store_name'), ''), 'Minha loja');
  store_slug := left(lower(regexp_replace(store_name, '[^a-zA-Z0-9]+', '-', 'g')), 45)
    || '-' || left(replace(new.id::text, '-', ''), 8);

  insert into public.profiles (user_id, full_name)
  values (new.id, left(profile_name, 120));

  insert into public.stores (name, slug)
  values (left(store_name, 120), store_slug)
  returning id into created_store_id;

  insert into public.store_members (store_id, user_id, role)
  values (created_store_id, new.id, 'owner');

  return new;
end;
$$;

revoke all on function private.bootstrap_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.bootstrap_new_user();

alter table public.profiles enable row level security;
alter table public.stores enable row level security;
alter table public.store_members enable row level security;
alter table public.products enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.inventory_movements enable row level security;

create policy profiles_select_self on public.profiles
for select to authenticated
using ((select auth.uid()) = user_id);
create policy profiles_update_self on public.profiles
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy stores_select_member on public.stores
for select to authenticated
using ((select private.is_store_member(id)));
create policy stores_update_admin on public.stores
for update to authenticated
using ((select private.has_store_role(id, array['owner', 'admin'])))
with check ((select private.has_store_role(id, array['owner', 'admin'])));

create policy store_members_select_member on public.store_members
for select to authenticated
using ((select private.is_store_member(store_id)));
create policy store_members_insert_admin on public.store_members
for insert to authenticated
with check ((select private.has_store_role(store_id, array['owner', 'admin'])));
create policy store_members_update_admin on public.store_members
for update to authenticated
using ((select private.has_store_role(store_id, array['owner', 'admin'])))
with check ((select private.has_store_role(store_id, array['owner', 'admin'])));
create policy store_members_delete_admin on public.store_members
for delete to authenticated
using ((select private.has_store_role(store_id, array['owner', 'admin'])));

create policy products_select_member on public.products
for select to authenticated
using ((select private.is_store_member(store_id)));
create policy products_insert_manager on public.products
for insert to authenticated
with check ((select private.has_store_role(store_id, array['owner', 'admin', 'manager'])));
create policy products_update_manager on public.products
for update to authenticated
using ((select private.has_store_role(store_id, array['owner', 'admin', 'manager'])))
with check ((select private.has_store_role(store_id, array['owner', 'admin', 'manager'])));
create policy products_delete_admin on public.products
for delete to authenticated
using ((select private.has_store_role(store_id, array['owner', 'admin'])));

create policy sales_select_member on public.sales
for select to authenticated
using ((select private.is_store_member(store_id)));
create policy sale_items_select_member on public.sale_items
for select to authenticated
using ((select private.is_store_member(store_id)));
create policy inventory_movements_select_member on public.inventory_movements
for select to authenticated
using ((select private.is_store_member(store_id)));

revoke all on public.profiles, public.stores, public.store_members, public.products,
  public.sales, public.sale_items, public.inventory_movements from anon, authenticated;
grant select, update (full_name) on public.profiles to authenticated;
grant select, update (name) on public.stores to authenticated;
grant select, insert, update, delete on public.store_members to authenticated;
grant select, insert, delete on public.products to authenticated;
grant update (sku, name, category, cost_cents, price_cents, min_stock, color, active)
  on public.products to authenticated;
grant select on public.sales, public.sale_items, public.inventory_movements to authenticated;

create or replace function public.create_product(
  p_store_id uuid,
  p_sku text,
  p_name text,
  p_category text,
  p_cost_cents integer,
  p_price_cents integer,
  p_stock_quantity integer,
  p_min_stock integer,
  p_color text default '#70745a'
)
returns public.products
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  created_product public.products;
begin
  if not private.has_store_role(p_store_id, array['owner', 'admin', 'manager']) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if p_stock_quantity < 0 then
    raise exception 'Estoque inicial inválido' using errcode = '22023';
  end if;

  insert into public.products (
    store_id, sku, name, category, cost_cents, price_cents, stock_quantity, min_stock, color
  ) values (
    p_store_id, trim(p_sku), trim(p_name), coalesce(nullif(trim(p_category), ''), 'Sem categoria'),
    p_cost_cents, p_price_cents, p_stock_quantity, p_min_stock, p_color
  ) returning * into created_product;

  if p_stock_quantity > 0 then
    insert into public.inventory_movements (
      store_id, product_id, movement_type, quantity_delta, reason, created_by
    ) values (
      p_store_id, created_product.id, 'opening', p_stock_quantity, 'Estoque inicial', (select auth.uid())
    );
  end if;
  return created_product;
end;
$$;

create or replace function public.adjust_product_stock(
  p_product_id uuid,
  p_quantity_delta integer,
  p_reason text
)
returns public.products
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  current_product public.products;
begin
  select * into current_product
  from public.products
  where id = p_product_id
  for update;

  if not found or not private.has_store_role(current_product.store_id, array['owner', 'admin', 'manager']) then
    raise exception 'Produto não encontrado ou acesso negado' using errcode = '42501';
  end if;
  if p_quantity_delta = 0 or current_product.stock_quantity + p_quantity_delta < 0 then
    raise exception 'Quantidade de estoque inválida' using errcode = '22023';
  end if;

  update public.products
  set stock_quantity = stock_quantity + p_quantity_delta
  where id = p_product_id
  returning * into current_product;

  insert into public.inventory_movements (
    store_id, product_id, movement_type, quantity_delta, reason, created_by
  ) values (
    current_product.store_id, current_product.id, 'adjustment', p_quantity_delta,
    left(coalesce(nullif(trim(p_reason), ''), 'Ajuste manual'), 240), (select auth.uid())
  );
  return current_product;
end;
$$;

create or replace function public.complete_sale(
  p_store_id uuid,
  p_payment_method text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  created_sale_id uuid;
  item jsonb;
  current_product public.products;
  item_quantity integer;
  running_total bigint := 0;
begin
  if not private.has_store_role(p_store_id, array['owner', 'admin', 'manager', 'operator']) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if p_payment_method not in ('Pix', 'Crédito', 'Débito', 'Dinheiro') then
    raise exception 'Forma de pagamento inválida' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100 then
    raise exception 'A venda deve ter entre 1 e 100 itens' using errcode = '22023';
  end if;

  insert into public.sales (store_id, payment_method, total_cents, sold_by)
  values (p_store_id, p_payment_method, 0, (select auth.uid()))
  returning id into created_sale_id;

  for item in select value from jsonb_array_elements(p_items)
  loop
    item_quantity := (item ->> 'quantity')::integer;
    if item_quantity < 1 then
      raise exception 'Quantidade vendida inválida' using errcode = '22023';
    end if;

    select * into current_product
    from public.products
    where id = (item ->> 'product_id')::uuid
      and store_id = p_store_id
      and active
    for update;

    if not found then
      raise exception 'Produto da venda não encontrado' using errcode = 'P0002';
    end if;
    if current_product.stock_quantity < item_quantity then
      raise exception 'Estoque insuficiente para %', current_product.name using errcode = '22023';
    end if;

    update public.products
    set stock_quantity = stock_quantity - item_quantity
    where id = current_product.id;

    insert into public.sale_items (
      store_id, sale_id, product_id, product_name, quantity, unit_price_cents, subtotal_cents
    ) values (
      p_store_id, created_sale_id, current_product.id, current_product.name, item_quantity,
      current_product.price_cents, current_product.price_cents * item_quantity
    );

    insert into public.inventory_movements (
      store_id, product_id, movement_type, quantity_delta, reason, sale_id, created_by
    ) values (
      p_store_id, current_product.id, 'sale', -item_quantity, 'Venda concluída',
      created_sale_id, (select auth.uid())
    );
    running_total := running_total + (current_product.price_cents::bigint * item_quantity);
  end loop;

  if running_total > 2147483647 then
    raise exception 'Valor total excede o limite permitido' using errcode = '22003';
  end if;
  update public.sales set total_cents = running_total::integer where id = created_sale_id;
  return created_sale_id;
end;
$$;

revoke all on function public.create_product(uuid, text, text, text, integer, integer, integer, integer, text) from public, anon;
revoke all on function public.adjust_product_stock(uuid, integer, text) from public, anon;
revoke all on function public.complete_sale(uuid, text, jsonb) from public, anon;
grant execute on function public.create_product(uuid, text, text, text, integer, integer, integer, integer, text) to authenticated;
grant execute on function public.adjust_product_stock(uuid, integer, text) to authenticated;
grant execute on function public.complete_sale(uuid, text, jsonb) to authenticated;

alter function public.create_product(uuid, text, text, text, integer, integer, integer, integer, text) set schema private;
alter function public.adjust_product_stock(uuid, integer, text) set schema private;
alter function public.complete_sale(uuid, text, jsonb) set schema private;

create function public.create_product(
  p_store_id uuid, p_sku text, p_name text, p_category text, p_cost_cents integer,
  p_price_cents integer, p_stock_quantity integer, p_min_stock integer, p_color text default '#70745a'
)
returns public.products
language sql
security invoker
set search_path = pg_catalog, public, private
as $$
  select private.create_product(p_store_id, p_sku, p_name, p_category, p_cost_cents,
    p_price_cents, p_stock_quantity, p_min_stock, p_color);
$$;

create function public.adjust_product_stock(p_product_id uuid, p_quantity_delta integer, p_reason text)
returns public.products
language sql
security invoker
set search_path = pg_catalog, public, private
as $$ select private.adjust_product_stock(p_product_id, p_quantity_delta, p_reason); $$;

create function public.complete_sale(p_store_id uuid, p_payment_method text, p_items jsonb)
returns uuid
language sql
security invoker
set search_path = pg_catalog, public, private
as $$ select private.complete_sale(p_store_id, p_payment_method, p_items); $$;

revoke all on function private.create_product(uuid, text, text, text, integer, integer, integer, integer, text) from public, anon;
revoke all on function private.adjust_product_stock(uuid, integer, text) from public, anon;
revoke all on function private.complete_sale(uuid, text, jsonb) from public, anon;
grant execute on function private.create_product(uuid, text, text, text, integer, integer, integer, integer, text) to authenticated;
grant execute on function private.adjust_product_stock(uuid, integer, text) to authenticated;
grant execute on function private.complete_sale(uuid, text, jsonb) to authenticated;

revoke all on function public.create_product(uuid, text, text, text, integer, integer, integer, integer, text) from public, anon;
revoke all on function public.adjust_product_stock(uuid, integer, text) from public, anon;
revoke all on function public.complete_sale(uuid, text, jsonb) from public, anon;
grant execute on function public.create_product(uuid, text, text, text, integer, integer, integer, integer, text) to authenticated;
grant execute on function public.adjust_product_stock(uuid, integer, text) to authenticated;
grant execute on function public.complete_sale(uuid, text, jsonb) to authenticated;

create index sales_sold_by_idx on public.sales (sold_by);
create index sale_items_product_idx on public.sale_items (product_id);
create index inventory_movements_product_idx on public.inventory_movements (product_id);
create index inventory_movements_sale_idx on public.inventory_movements (sale_id) where sale_id is not null;
create index inventory_movements_created_by_idx on public.inventory_movements (created_by);

commit;
