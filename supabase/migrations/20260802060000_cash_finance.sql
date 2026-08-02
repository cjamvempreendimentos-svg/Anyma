begin;

create table public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  operator_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'open' check (status in ('open', 'closed')),
  opening_amount_cents integer not null check (opening_amount_cents >= 0),
  expected_amount_cents integer check (expected_amount_cents >= 0),
  closing_amount_cents integer check (closing_amount_cents >= 0),
  difference_cents integer,
  notes text not null default '' check (char_length(notes) <= 500),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  check ((status = 'open' and closed_at is null) or (status = 'closed' and closed_at is not null))
);

create unique index cash_sessions_one_open_operator_idx
  on public.cash_sessions (store_id, operator_id) where status = 'open';
create index cash_sessions_store_opened_idx on public.cash_sessions (store_id, opened_at desc);
create index cash_sessions_operator_idx on public.cash_sessions (operator_id);

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  cash_session_id uuid not null references public.cash_sessions(id) on delete restrict,
  movement_type text not null check (movement_type in ('sale', 'supply', 'withdrawal')),
  amount_cents integer not null check (amount_cents > 0),
  description text not null check (char_length(description) between 2 and 240),
  sale_id uuid references public.sales(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check ((movement_type = 'sale' and sale_id is not null) or (movement_type <> 'sale' and sale_id is null))
);

create index cash_movements_session_created_idx on public.cash_movements (cash_session_id, created_at desc);
create index cash_movements_store_created_idx on public.cash_movements (store_id, created_at desc);
create index cash_movements_created_by_idx on public.cash_movements (created_by);
create unique index cash_movements_sale_idx on public.cash_movements (sale_id) where sale_id is not null;

create table public.financial_entries (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  entry_type text not null check (entry_type in ('income', 'expense')),
  category text not null check (char_length(category) between 2 and 80),
  description text not null check (char_length(description) between 2 and 240),
  amount_cents integer not null check (amount_cents > 0),
  payment_method text check (payment_method in ('Pix', 'Crédito', 'Débito', 'Dinheiro', 'Boleto', 'Transferência')),
  due_date date not null,
  status text not null default 'open' check (status in ('open', 'paid', 'cancelled')),
  paid_at timestamptz,
  sale_id uuid references public.sales(id) on delete restrict,
  purchase_id uuid references public.purchases(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'paid' and paid_at is not null) or status <> 'paid')
);

create index financial_entries_store_due_idx on public.financial_entries (store_id, status, due_date);
create index financial_entries_created_by_idx on public.financial_entries (created_by);
create unique index financial_entries_sale_idx on public.financial_entries (sale_id) where sale_id is not null;
create unique index financial_entries_purchase_idx on public.financial_entries (purchase_id) where purchase_id is not null;

alter table public.sales add column cash_session_id uuid references public.cash_sessions(id) on delete restrict;
create index sales_cash_session_idx on public.sales (cash_session_id) where cash_session_id is not null;

create trigger financial_entries_set_updated_at before update on public.financial_entries
for each row execute function private.set_updated_at();

alter table public.cash_sessions enable row level security;
alter table public.cash_movements enable row level security;
alter table public.financial_entries enable row level security;

create policy cash_sessions_select_member on public.cash_sessions for select to authenticated
using ((select private.is_store_member(store_id)));
create policy cash_movements_select_member on public.cash_movements for select to authenticated
using ((select private.is_store_member(store_id)));
create policy financial_entries_select_member on public.financial_entries for select to authenticated
using ((select private.is_store_member(store_id)));
create policy financial_entries_insert_manager on public.financial_entries for insert to authenticated
with check ((select private.has_store_role(store_id, array['owner','admin','manager'])) and created_by = (select auth.uid()));
create policy financial_entries_update_manager on public.financial_entries for update to authenticated
using ((select private.has_store_role(store_id, array['owner','admin','manager'])))
with check ((select private.has_store_role(store_id, array['owner','admin','manager'])));

revoke all on public.cash_sessions, public.cash_movements, public.financial_entries from anon, authenticated;
grant select on public.cash_sessions, public.cash_movements to authenticated;
grant select, insert on public.financial_entries to authenticated;
grant update (category, description, amount_cents, payment_method, due_date, status, paid_at) on public.financial_entries to authenticated;

create function private.open_cash_session(p_store_id uuid, p_opening_amount_cents integer)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare created_session_id uuid;
begin
  if not private.has_store_role(p_store_id, array['owner','admin','manager','operator']) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if p_opening_amount_cents < 0 then raise exception 'Valor de abertura inválido' using errcode = '22023'; end if;
  if exists (select 1 from public.cash_sessions where store_id = p_store_id and operator_id = (select auth.uid()) and status = 'open') then
    raise exception 'Você já possui um turno aberto nesta loja' using errcode = '23505';
  end if;
  insert into public.cash_sessions (store_id, operator_id, opening_amount_cents)
  values (p_store_id, (select auth.uid()), p_opening_amount_cents) returning id into created_session_id;
  return created_session_id;
end;
$$;

create function public.open_cash_session(p_store_id uuid, p_opening_amount_cents integer)
returns uuid language sql security invoker set search_path = pg_catalog, public, private
as $$ select private.open_cash_session(p_store_id, p_opening_amount_cents); $$;

create function private.register_cash_movement(p_cash_session_id uuid, p_movement_type text, p_amount_cents integer, p_description text)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare current_session public.cash_sessions; created_movement_id uuid;
begin
  select * into current_session from public.cash_sessions where id = p_cash_session_id for update;
  if not found or current_session.status <> 'open' or current_session.operator_id <> (select auth.uid()) then
    raise exception 'Turno aberto não encontrado para este operador' using errcode = '42501';
  end if;
  if p_movement_type not in ('supply','withdrawal') or p_amount_cents <= 0 then
    raise exception 'Movimentação inválida' using errcode = '22023';
  end if;
  insert into public.cash_movements (store_id, cash_session_id, movement_type, amount_cents, description, created_by)
  values (current_session.store_id, current_session.id, p_movement_type, p_amount_cents, left(trim(p_description),240), (select auth.uid()))
  returning id into created_movement_id;
  return created_movement_id;
end;
$$;

create function public.register_cash_movement(p_cash_session_id uuid, p_movement_type text, p_amount_cents integer, p_description text)
returns uuid language sql security invoker set search_path = pg_catalog, public, private
as $$ select private.register_cash_movement(p_cash_session_id, p_movement_type, p_amount_cents, p_description); $$;

create function private.close_cash_session(p_cash_session_id uuid, p_closing_amount_cents integer, p_notes text)
returns integer language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare current_session public.cash_sessions; expected_total bigint;
begin
  select * into current_session from public.cash_sessions where id = p_cash_session_id for update;
  if not found or current_session.status <> 'open' or current_session.operator_id <> (select auth.uid()) then
    raise exception 'Turno aberto não encontrado para este operador' using errcode = '42501';
  end if;
  if p_closing_amount_cents < 0 then raise exception 'Valor contado inválido' using errcode = '22023'; end if;
  select current_session.opening_amount_cents + coalesce(sum(case when movement_type in ('sale','supply') then amount_cents else -amount_cents end),0)
  into expected_total from public.cash_movements where cash_session_id = current_session.id;
  if expected_total < 0 or expected_total > 2147483647 then raise exception 'Saldo esperado fora do limite' using errcode = '22003'; end if;
  update public.cash_sessions set status='closed', expected_amount_cents=expected_total::integer,
    closing_amount_cents=p_closing_amount_cents, difference_cents=p_closing_amount_cents-expected_total::integer,
    notes=left(trim(coalesce(p_notes,'')),500), closed_at=now() where id=current_session.id;
  return p_closing_amount_cents-expected_total::integer;
end;
$$;

create function public.close_cash_session(p_cash_session_id uuid, p_closing_amount_cents integer, p_notes text)
returns integer language sql security invoker set search_path = pg_catalog, public, private
as $$ select private.close_cash_session(p_cash_session_id, p_closing_amount_cents, p_notes); $$;

create function private.complete_sale_v3(p_store_id uuid, p_cash_session_id uuid, p_payment_method text, p_customer_id uuid, p_items jsonb)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare created_sale_id uuid; selected_customer public.customers; current_session public.cash_sessions;
  item jsonb; current_product public.products; item_quantity integer; running_total bigint := 0;
begin
  if not private.has_store_role(p_store_id, array['owner','admin','manager','operator']) then raise exception 'Acesso negado' using errcode='42501'; end if;
  select * into current_session from public.cash_sessions where id=p_cash_session_id and store_id=p_store_id for update;
  if not found or current_session.status<>'open' or current_session.operator_id<>(select auth.uid()) then raise exception 'Abra seu turno de caixa antes da venda' using errcode='42501'; end if;
  if p_payment_method not in ('Pix','Crédito','Débito','Dinheiro') then raise exception 'Forma de pagamento inválida' using errcode='22023'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>100 then raise exception 'A venda deve ter entre 1 e 100 itens' using errcode='22023'; end if;
  if p_customer_id is not null then
    select * into selected_customer from public.customers where id=p_customer_id and store_id=p_store_id and active;
    if not found then raise exception 'Cliente não encontrado' using errcode='P0002'; end if;
  end if;
  insert into public.sales (store_id,payment_method,total_cents,customer_id,customer_name,sold_by,cash_session_id)
  values (p_store_id,p_payment_method,0,p_customer_id,coalesce(selected_customer.name,'Consumidor final'),(select auth.uid()),current_session.id)
  returning id into created_sale_id;
  for item in select value from jsonb_array_elements(p_items) loop
    item_quantity := (item->>'quantity')::integer;
    if item_quantity<1 then raise exception 'Quantidade vendida inválida' using errcode='22023'; end if;
    select * into current_product from public.products where id=(item->>'product_id')::uuid and store_id=p_store_id and active for update;
    if not found then raise exception 'Produto da venda não encontrado' using errcode='P0002'; end if;
    if current_product.stock_quantity<item_quantity then raise exception 'Estoque insuficiente para %',current_product.name using errcode='22023'; end if;
    update public.products set stock_quantity=stock_quantity-item_quantity where id=current_product.id;
    insert into public.sale_items (store_id,sale_id,product_id,product_name,quantity,unit_price_cents,subtotal_cents)
    values (p_store_id,created_sale_id,current_product.id,current_product.name,item_quantity,current_product.price_cents,current_product.price_cents*item_quantity);
    insert into public.inventory_movements (store_id,product_id,movement_type,quantity_delta,reason,sale_id,created_by)
    values (p_store_id,current_product.id,'sale',-item_quantity,'Venda concluída',created_sale_id,(select auth.uid()));
    running_total := running_total + current_product.price_cents::bigint*item_quantity;
  end loop;
  if running_total<1 or running_total>2147483647 then raise exception 'Valor total fora do limite' using errcode='22003'; end if;
  update public.sales set total_cents=running_total::integer where id=created_sale_id;
  insert into public.financial_entries (store_id,entry_type,category,description,amount_cents,payment_method,due_date,status,paid_at,sale_id,created_by)
  values (p_store_id,'income','Vendas','Venda '||left(created_sale_id::text,6),running_total::integer,p_payment_method,current_date,'paid',now(),created_sale_id,(select auth.uid()));
  if p_payment_method='Dinheiro' then
    insert into public.cash_movements (store_id,cash_session_id,movement_type,amount_cents,description,sale_id,created_by)
    values (p_store_id,current_session.id,'sale',running_total::integer,'Venda em dinheiro',created_sale_id,(select auth.uid()));
  end if;
  return created_sale_id;
end;
$$;

create function public.complete_sale_v3(p_store_id uuid, p_cash_session_id uuid, p_payment_method text, p_customer_id uuid, p_items jsonb)
returns uuid language sql security invoker set search_path = pg_catalog, public, private
as $$ select private.complete_sale_v3(p_store_id,p_cash_session_id,p_payment_method,p_customer_id,p_items); $$;

create function private.receive_purchase_v2(p_store_id uuid,p_supplier_id uuid,p_document_number text,p_notes text,p_payment_status text,p_payment_method text,p_due_date date,p_items jsonb)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare created_purchase_id uuid; current_supplier public.suppliers; current_product public.products;
  item jsonb; item_quantity integer; item_cost integer; running_total bigint:=0;
begin
  if not private.has_store_role(p_store_id,array['owner','admin','manager']) then raise exception 'Acesso negado' using errcode='42501'; end if;
  if p_payment_status not in ('open','paid') then raise exception 'Situação financeira inválida' using errcode='22023'; end if;
  if p_payment_status='paid' and p_payment_method not in ('Pix','Crédito','Débito','Dinheiro','Boleto','Transferência') then raise exception 'Forma de pagamento inválida' using errcode='22023'; end if;
  if p_payment_status='open' and p_due_date is null then raise exception 'Informe o vencimento' using errcode='22023'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>100 then raise exception 'A compra deve ter entre 1 e 100 itens' using errcode='22023'; end if;
  select * into current_supplier from public.suppliers where id=p_supplier_id and store_id=p_store_id and active;
  if not found then raise exception 'Fornecedor não encontrado' using errcode='P0002'; end if;
  insert into public.purchases (store_id,supplier_id,supplier_name,document_number,total_cents,notes,received_by)
  values (p_store_id,current_supplier.id,current_supplier.name,left(trim(coalesce(p_document_number,'')),80),0,left(trim(coalesce(p_notes,'')),500),(select auth.uid())) returning id into created_purchase_id;
  for item in select value from jsonb_array_elements(p_items) loop
    item_quantity:=(item->>'quantity')::integer; item_cost:=(item->>'unit_cost_cents')::integer;
    if item_quantity<1 or item_cost<0 then raise exception 'Quantidade ou custo inválido' using errcode='22023'; end if;
    select * into current_product from public.products where id=(item->>'product_id')::uuid and store_id=p_store_id and active for update;
    if not found then raise exception 'Produto da compra não encontrado' using errcode='P0002'; end if;
    update public.products set stock_quantity=stock_quantity+item_quantity,cost_cents=item_cost where id=current_product.id;
    insert into public.purchase_items (store_id,purchase_id,product_id,product_name,quantity,unit_cost_cents,subtotal_cents)
    values (p_store_id,created_purchase_id,current_product.id,current_product.name,item_quantity,item_cost,item_quantity*item_cost);
    insert into public.inventory_movements (store_id,product_id,movement_type,quantity_delta,reason,purchase_id,created_by)
    values (p_store_id,current_product.id,'purchase',item_quantity,'Entrada por compra',created_purchase_id,(select auth.uid()));
    running_total:=running_total+item_quantity::bigint*item_cost;
  end loop;
  if running_total<1 or running_total>2147483647 then raise exception 'Valor total fora do limite' using errcode='22003'; end if;
  update public.purchases set total_cents=running_total::integer where id=created_purchase_id;
  insert into public.financial_entries (store_id,entry_type,category,description,amount_cents,payment_method,due_date,status,paid_at,purchase_id,created_by)
  values (p_store_id,'expense','Compras','Compra de '||current_supplier.name,running_total::integer,case when p_payment_status='paid' then p_payment_method else null end,
    case when p_payment_status='paid' then current_date else p_due_date end,p_payment_status,case when p_payment_status='paid' then now() else null end,created_purchase_id,(select auth.uid()));
  return created_purchase_id;
end;
$$;

create function public.receive_purchase_v2(p_store_id uuid,p_supplier_id uuid,p_document_number text,p_notes text,p_payment_status text,p_payment_method text,p_due_date date,p_items jsonb)
returns uuid language sql security invoker set search_path = pg_catalog, public, private
as $$ select private.receive_purchase_v2(p_store_id,p_supplier_id,p_document_number,p_notes,p_payment_status,p_payment_method,p_due_date,p_items); $$;

revoke all on function private.open_cash_session(uuid,integer), private.register_cash_movement(uuid,text,integer,text), private.close_cash_session(uuid,integer,text), private.complete_sale_v3(uuid,uuid,text,uuid,jsonb), private.receive_purchase_v2(uuid,uuid,text,text,text,text,date,jsonb) from public, anon;
grant execute on function private.open_cash_session(uuid,integer), private.register_cash_movement(uuid,text,integer,text), private.close_cash_session(uuid,integer,text), private.complete_sale_v3(uuid,uuid,text,uuid,jsonb), private.receive_purchase_v2(uuid,uuid,text,text,text,text,date,jsonb) to authenticated;
revoke all on function public.open_cash_session(uuid,integer), public.register_cash_movement(uuid,text,integer,text), public.close_cash_session(uuid,integer,text), public.complete_sale_v3(uuid,uuid,text,uuid,jsonb), public.receive_purchase_v2(uuid,uuid,text,text,text,text,date,jsonb) from public, anon;
grant execute on function public.open_cash_session(uuid,integer), public.register_cash_movement(uuid,text,integer,text), public.close_cash_session(uuid,integer,text), public.complete_sale_v3(uuid,uuid,text,uuid,jsonb), public.receive_purchase_v2(uuid,uuid,text,text,text,text,date,jsonb) to authenticated;

insert into public.financial_entries (store_id,entry_type,category,description,amount_cents,payment_method,due_date,status,paid_at,sale_id,created_by)
select store_id,'income','Vendas','Venda '||left(id::text,6),total_cents,payment_method,sold_at::date,'paid',sold_at,id,sold_by from public.sales on conflict do nothing;
insert into public.financial_entries (store_id,entry_type,category,description,amount_cents,due_date,status,purchase_id,created_by)
select store_id,'expense','Compras','Compra de '||supplier_name,total_cents,received_at::date,'open',id,received_by from public.purchases on conflict do nothing;

commit;
