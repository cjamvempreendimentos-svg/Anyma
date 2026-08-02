alter table public.store_invitations
  drop constraint if exists store_invitations_role_check;

alter table public.store_invitations
  add constraint store_invitations_role_check
  check (role in ('owner', 'admin', 'manager', 'operator', 'viewer'));

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
  platform_admin boolean := private.is_platform_admin();
  actor_role text;
  existing_user_id uuid;
  existing_member_role text;
  raw_token text;
  created_invitation public.store_invitations;
begin
  if not platform_admin
    and not private.has_store_role(p_store_id, array['owner', 'admin']) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'E-mail inválido' using errcode = '22023';
  end if;

  if p_role not in ('owner', 'admin', 'manager', 'operator', 'viewer') then
    raise exception 'Função inválida' using errcode = '22023';
  end if;

  if p_role = 'owner' and not platform_admin then
    raise exception 'Somente a administração da plataforma pode conceder o perfil Proprietária'
      using errcode = '42501';
  end if;

  select role into actor_role
  from public.store_members
  where store_id = p_store_id
    and user_id = (select auth.uid())
    and active;

  if not platform_admin and actor_role = 'admin' and p_role = 'admin' then
    raise exception 'Somente a proprietária pode conceder acesso de administrador'
      using errcode = '42501';
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
      raise exception 'A proprietária já pertence à loja' using errcode = '23505';
    end if;

    insert into public.store_members (store_id, user_id, role, active)
    values (p_store_id, existing_user_id, p_role, true)
    on conflict (store_id, user_id) do update
      set role = excluded.role, active = true;

    return jsonb_build_object('status', 'added', 'user_id', existing_user_id);
  end if;

  update public.store_invitations
  set status = 'revoked'
  where store_id = p_store_id
    and email = normalized_email
    and status = 'pending';

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
