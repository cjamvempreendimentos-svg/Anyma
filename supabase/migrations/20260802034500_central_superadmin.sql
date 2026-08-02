begin;

create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.platform_access_logs (
  id bigint generated always as identity primary key,
  admin_user_id uuid not null references auth.users(id) on delete restrict,
  store_id uuid not null references public.stores(id) on delete restrict,
  reason text not null check (char_length(reason) between 3 and 240),
  accessed_at timestamptz not null default now()
);

create index platform_access_logs_admin_accessed_idx
  on public.platform_access_logs (admin_user_id, accessed_at desc);
create index platform_access_logs_store_accessed_idx
  on public.platform_access_logs (store_id, accessed_at desc);

alter table public.platform_admins enable row level security;
alter table public.platform_access_logs enable row level security;

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select exists (
    select 1
    from public.platform_admins administrator
    where administrator.user_id = (select auth.uid())
      and administrator.active
  );
$$;

revoke all on function private.is_platform_admin() from public, anon;
grant execute on function private.is_platform_admin() to authenticated;

create or replace function private.is_store_member(target_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select private.is_platform_admin() or exists (
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
  select private.is_platform_admin() or exists (
    select 1
    from public.store_members membership
    where membership.store_id = target_store_id
      and membership.user_id = (select auth.uid())
      and membership.active
      and membership.role = any(allowed_roles)
  );
$$;

drop policy profiles_select_self on public.profiles;
create policy profiles_select_authorized on public.profiles
for select to authenticated
using ((select auth.uid()) = user_id or (select private.is_platform_admin()));

create policy platform_admins_select_self on public.platform_admins
for select to authenticated
using ((select auth.uid()) = user_id);

create policy platform_access_logs_select_admin on public.platform_access_logs
for select to authenticated
using ((select private.is_platform_admin()));

revoke all on public.platform_admins, public.platform_access_logs from anon, authenticated;
grant select on public.platform_admins, public.platform_access_logs to authenticated;

create or replace function private.log_platform_access(p_store_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (select 1 from public.stores where id = p_store_id) then
    raise exception 'Loja não encontrada' using errcode = 'P0002';
  end if;

  insert into public.platform_access_logs (admin_user_id, store_id, reason)
  values ((select auth.uid()), p_store_id, left(coalesce(nullif(trim(p_reason), ''), 'Teste administrativo'), 240));
end;
$$;

revoke all on function private.log_platform_access(uuid, text) from public, anon;
grant execute on function private.log_platform_access(uuid, text) to authenticated;

create function public.log_platform_access(p_store_id uuid, p_reason text default 'Teste administrativo')
returns void
language sql
security invoker
set search_path = pg_catalog, public, private
as $$ select private.log_platform_access(p_store_id, p_reason); $$;

revoke all on function public.log_platform_access(uuid, text) from public, anon;
grant execute on function public.log_platform_access(uuid, text) to authenticated;

commit;
