begin;

create table public.cash_reconciliations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  cash_session_id uuid not null unique references public.cash_sessions(id) on delete restrict,
  counted_amount_cents integer not null check (counted_amount_cents >= 0),
  next_opening_amount_cents integer not null check (next_opening_amount_cents >= 0),
  removed_amount_cents integer not null check (removed_amount_cents >= 0),
  destination text not null check (destination in ('Caixa', 'Cofre', 'Banco', 'Proprietário', 'Outro')),
  notes text not null default '',
  reconciled_by uuid not null references auth.users(id) on delete restrict,
  reconciled_at timestamptz not null default now(),
  check (next_opening_amount_cents + removed_amount_cents = counted_amount_cents),
  check (
    (removed_amount_cents = 0 and destination = 'Caixa') or
    (removed_amount_cents > 0 and destination <> 'Caixa')
  )
);

create index cash_reconciliations_store_date_idx
  on public.cash_reconciliations (store_id, reconciled_at desc);
create index cash_reconciliations_reconciled_by_idx
  on public.cash_reconciliations (reconciled_by);

alter table public.cash_reconciliations enable row level security;

create policy cash_reconciliations_select_member
on public.cash_reconciliations for select to authenticated
using ((select private.is_store_member(store_id)));

revoke all on public.cash_reconciliations from anon, authenticated;
grant select on public.cash_reconciliations to authenticated;

create function private.save_cash_reconciliation(
  p_cash_session_id uuid,
  p_next_opening_amount_cents integer,
  p_destination text,
  p_notes text
)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
declare
  current_session public.cash_sessions;
  removed_amount integer;
  normalized_destination text;
  reconciliation_id uuid;
begin
  select * into current_session
  from public.cash_sessions
  where id = p_cash_session_id
  for update;

  if not found or current_session.status <> 'closed' then
    raise exception 'O turno precisa estar fechado para ser conciliado' using errcode = '22023';
  end if;

  if current_session.operator_id <> (select auth.uid())
    and not private.has_store_role(current_session.store_id, array['owner','admin','manager']) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  if exists (select 1 from public.cash_reconciliations where cash_session_id = current_session.id) then
    raise exception 'Este fechamento já foi conciliado' using errcode = '23505';
  end if;

  if p_next_opening_amount_cents is null
    or p_next_opening_amount_cents < 0
    or p_next_opening_amount_cents > current_session.closing_amount_cents then
    raise exception 'O fundo reservado deve estar entre zero e o valor contado' using errcode = '22023';
  end if;

  removed_amount := current_session.closing_amount_cents - p_next_opening_amount_cents;
  normalized_destination := case when removed_amount = 0 then 'Caixa' else p_destination end;

  if normalized_destination not in ('Caixa','Cofre','Banco','Proprietário','Outro')
    or (removed_amount > 0 and normalized_destination = 'Caixa') then
    raise exception 'Informe o destino do dinheiro retirado' using errcode = '22023';
  end if;

  insert into public.cash_reconciliations (
    store_id, cash_session_id, counted_amount_cents, next_opening_amount_cents,
    removed_amount_cents, destination, notes, reconciled_by
  ) values (
    current_session.store_id, current_session.id, current_session.closing_amount_cents,
    p_next_opening_amount_cents, removed_amount, normalized_destination,
    left(trim(coalesce(p_notes, '')), 500), (select auth.uid())
  ) returning id into reconciliation_id;

  return reconciliation_id;
end;
$$;

create function public.reconcile_cash_session(
  p_cash_session_id uuid,
  p_next_opening_amount_cents integer,
  p_destination text,
  p_notes text
)
returns uuid language sql security invoker
set search_path = pg_catalog, public, private
as $$
  select private.save_cash_reconciliation(
    p_cash_session_id, p_next_opening_amount_cents, p_destination, p_notes
  );
$$;

create function private.close_cash_session_v2(
  p_cash_session_id uuid,
  p_closing_amount_cents integer,
  p_next_opening_amount_cents integer,
  p_destination text,
  p_notes text
)
returns integer language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
declare
  current_session public.cash_sessions;
  expected_total bigint;
  difference_total integer;
begin
  select * into current_session
  from public.cash_sessions
  where id = p_cash_session_id
  for update;

  if not found or current_session.status <> 'open'
    or current_session.operator_id <> (select auth.uid()) then
    raise exception 'Turno aberto não encontrado para este operador' using errcode = '42501';
  end if;

  if p_closing_amount_cents is null or p_closing_amount_cents < 0 then
    raise exception 'Valor contado inválido' using errcode = '22023';
  end if;

  select current_session.opening_amount_cents + coalesce(sum(
    case movement_type
      when 'sale' then amount_cents
      when 'supply' then amount_cents
      when 'withdrawal' then -amount_cents
      else 0
    end
  ), 0)
  into expected_total
  from public.cash_movements
  where cash_session_id = current_session.id;

  if expected_total < 0 or expected_total > 2147483647 then
    raise exception 'Saldo esperado fora do limite' using errcode = '22003';
  end if;

  difference_total := p_closing_amount_cents - expected_total::integer;

  update public.cash_sessions
  set status = 'closed',
      expected_amount_cents = expected_total::integer,
      closing_amount_cents = p_closing_amount_cents,
      difference_cents = difference_total,
      notes = left(trim(coalesce(p_notes, '')), 500),
      closed_at = now()
  where id = current_session.id;

  perform private.save_cash_reconciliation(
    current_session.id, p_next_opening_amount_cents, p_destination, p_notes
  );

  return difference_total;
end;
$$;

create function public.close_cash_session_v2(
  p_cash_session_id uuid,
  p_closing_amount_cents integer,
  p_next_opening_amount_cents integer,
  p_destination text,
  p_notes text
)
returns integer language sql security invoker
set search_path = pg_catalog, public, private
as $$
  select private.close_cash_session_v2(
    p_cash_session_id, p_closing_amount_cents, p_next_opening_amount_cents,
    p_destination, p_notes
  );
$$;

create function private.open_cash_session_v2(p_store_id uuid, p_opening_amount_cents integer)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
declare
  latest_session public.cash_sessions;
  latest_reconciliation public.cash_reconciliations;
  created_session_id uuid;
begin
  if not private.has_store_role(p_store_id, array['owner','admin','manager','operator']) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  if p_opening_amount_cents is null or p_opening_amount_cents < 0 then
    raise exception 'Fundo inicial inválido' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.cash_sessions
    where store_id = p_store_id and operator_id = (select auth.uid()) and status = 'open'
  ) then
    raise exception 'Este operador já possui um turno aberto' using errcode = '23505';
  end if;

  select * into latest_session
  from public.cash_sessions
  where store_id = p_store_id and operator_id = (select auth.uid()) and status = 'closed'
  order by closed_at desc
  limit 1;

  if found then
    select * into latest_reconciliation
    from public.cash_reconciliations
    where cash_session_id = latest_session.id;

    if found and latest_reconciliation.next_opening_amount_cents <> p_opening_amount_cents then
      raise exception 'O fundo inicial deve ser % conforme o último fechamento',
        latest_reconciliation.next_opening_amount_cents using errcode = '22023';
    end if;
  end if;

  insert into public.cash_sessions (store_id, operator_id, opening_amount_cents)
  values (p_store_id, (select auth.uid()), p_opening_amount_cents)
  returning id into created_session_id;

  return created_session_id;
end;
$$;

create function public.open_cash_session_v2(p_store_id uuid, p_opening_amount_cents integer)
returns uuid language sql security invoker
set search_path = pg_catalog, public, private
as $$ select private.open_cash_session_v2(p_store_id, p_opening_amount_cents); $$;

revoke all on function private.save_cash_reconciliation(uuid,integer,text,text),
  private.close_cash_session_v2(uuid,integer,integer,text,text),
  private.open_cash_session_v2(uuid,integer) from public, anon;
grant execute on function private.save_cash_reconciliation(uuid,integer,text,text),
  private.close_cash_session_v2(uuid,integer,integer,text,text),
  private.open_cash_session_v2(uuid,integer) to authenticated;

revoke all on function public.reconcile_cash_session(uuid,integer,text,text),
  public.close_cash_session_v2(uuid,integer,integer,text,text),
  public.open_cash_session_v2(uuid,integer) from public, anon;
grant execute on function public.reconcile_cash_session(uuid,integer,text,text),
  public.close_cash_session_v2(uuid,integer,integer,text,text),
  public.open_cash_session_v2(uuid,integer) to authenticated;

commit;
