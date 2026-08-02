begin;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 160),
  phone text not null default '' check (char_length(phone) <= 30),
  email text not null default '' check (char_length(email) <= 180),
  notes text not null default '' check (char_length(notes) <= 500),
  active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index customers_store_active_name_idx on public.customers (store_id, active, name);
create index customers_created_by_idx on public.customers (created_by);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 160),
  contact_name text not null default '' check (char_length(contact_name) <= 120),
  phone text not null default '' check (char_length(phone) <= 30),
  email text not null default '' check (char_length(email) <= 180),
  active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index suppliers_store_active_name_idx on public.suppliers (store_id, active, name);
create index suppliers_created_by_idx on public.suppliers (created_by);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  supplier_name text not null,
  document_number text not null default '' check (char_length(document_number) <= 80),
  total_cents integer not null check (total_cents >= 0),
  status text not null default 'received' check (status in ('received')),
  notes text not null default '' check (char_length(notes) <= 500),
  received_by uuid not null references auth.users(id) on delete restrict,
  received_at timestamptz not null default now()
);

create index purchases_store_received_at_idx on public.purchases (store_id, received_at desc);
create index purchases_supplier_idx on public.purchases (supplier_id);
create index purchases_received_by_idx on public.purchases (received_by);

create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  purchase_id uuid not null references public.purchases(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_cost_cents integer not null check (unit_cost_cents >= 0),
  subtotal_cents integer not null check (subtotal_cents >= 0)
);

create index purchase_items_purchase_idx on public.purchase_items (purchase_id);
create index purchase_items_store_product_idx on public.purchase_items (store_id, product_id);
create index purchase_items_product_idx on public.purchase_items (product_id);

alter table public.inventory_movements
  add column purchase_id uuid references public.purchases(id) on delete restrict;
create index inventory_movements_purchase_idx
  on public.inventory_movements (purchase_id) where purchase_id is not null;

alter table public.sales add column customer_id uuid references public.customers(id) on delete set null;
create index sales_customer_idx on public.sales (customer_id) where customer_id is not null;

create trigger customers_set_updated_at before update on public.customers
for each row execute function private.set_updated_at();
create trigger suppliers_set_updated_at before update on public.suppliers
for each row execute function private.set_updated_at();

alter table public.customers enable row level security;
alter table public.suppliers enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;

create policy customers_select_member on public.customers for select to authenticated
using ((select private.is_store_member(store_id)));
create policy customers_insert_operator on public.customers for insert to authenticated
with check ((select private.has_store_role(store_id, array['owner','admin','manager','operator'])) and created_by = (select auth.uid()));
create policy customers_update_manager on public.customers for update to authenticated
using ((select private.has_store_role(store_id, array['owner','admin','manager'])))
with check ((select private.has_store_role(store_id, array['owner','admin','manager'])));

create policy suppliers_select_member on public.suppliers for select to authenticated
using ((select private.is_store_member(store_id)));
create policy suppliers_insert_manager on public.suppliers for insert to authenticated
with check ((select private.has_store_role(store_id, array['owner','admin','manager'])) and created_by = (select auth.uid()));
create policy suppliers_update_manager on public.suppliers for update to authenticated
using ((select private.has_store_role(store_id, array['owner','admin','manager'])))
with check ((select private.has_store_role(store_id, array['owner','admin','manager'])));

create policy purchases_select_member on public.purchases for select to authenticated
using ((select private.is_store_member(store_id)));
create policy purchase_items_select_member on public.purchase_items for select to authenticated
using ((select private.is_store_member(store_id)));

revoke all on public.customers, public.suppliers, public.purchases, public.purchase_items from anon, authenticated;
grant select, insert on public.customers, public.suppliers to authenticated;
grant update (name, phone, email, notes, active) on public.customers to authenticated;
grant update (name, contact_name, phone, email, active) on public.suppliers to authenticated;
grant select on public.purchases, public.purchase_items to authenticated;

create function private.receive_purchase(
  p_store_id uuid,
  p_supplier_id uuid,
  p_document_number text,
  p_notes text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  created_purchase_id uuid;
  current_supplier public.suppliers;
  current_product public.products;
  item jsonb;
  item_quantity integer;
  item_cost integer;
  running_total bigint := 0;
begin
  if not private.has_store_role(p_store_id, array['owner','admin','manager']) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100 then
    raise exception 'A compra deve ter entre 1 e 100 itens' using errcode = '22023';
  end if;

  select * into current_supplier from public.suppliers
  where id = p_supplier_id and store_id = p_store_id and active;
  if not found then raise exception 'Fornecedor não encontrado' using errcode = 'P0002'; end if;

  insert into public.purchases (store_id, supplier_id, supplier_name, document_number, total_cents, notes, received_by)
  values (p_store_id, current_supplier.id, current_supplier.name, left(trim(coalesce(p_document_number,'')),80), 0,
    left(trim(coalesce(p_notes,'')),500), (select auth.uid()))
  returning id into created_purchase_id;

  for item in select value from jsonb_array_elements(p_items)
  loop
    item_quantity := (item ->> 'quantity')::integer;
    item_cost := (item ->> 'unit_cost_cents')::integer;
    if item_quantity < 1 or item_cost < 0 then
      raise exception 'Quantidade ou custo inválido' using errcode = '22023';
    end if;

    select * into current_product from public.products
    where id = (item ->> 'product_id')::uuid and store_id = p_store_id and active for update;
    if not found then raise exception 'Produto da compra não encontrado' using errcode = 'P0002'; end if;

    update public.products set stock_quantity = stock_quantity + item_quantity, cost_cents = item_cost
    where id = current_product.id;

    insert into public.purchase_items (store_id, purchase_id, product_id, product_name, quantity, unit_cost_cents, subtotal_cents)
    values (p_store_id, created_purchase_id, current_product.id, current_product.name, item_quantity, item_cost, item_quantity * item_cost);

    insert into public.inventory_movements (store_id, product_id, movement_type, quantity_delta, reason, purchase_id, created_by)
    values (p_store_id, current_product.id, 'purchase', item_quantity, 'Entrada por compra', created_purchase_id, (select auth.uid()));

    running_total := running_total + item_quantity::bigint * item_cost;
  end loop;

  if running_total > 2147483647 then raise exception 'Valor total excede o limite permitido' using errcode = '22003'; end if;
  update public.purchases set total_cents = running_total::integer where id = created_purchase_id;
  return created_purchase_id;
end;
$$;

revoke all on function private.receive_purchase(uuid, uuid, text, text, jsonb) from public, anon;
grant execute on function private.receive_purchase(uuid, uuid, text, text, jsonb) to authenticated;

create function public.receive_purchase(p_store_id uuid, p_supplier_id uuid, p_document_number text, p_notes text, p_items jsonb)
returns uuid language sql security invoker set search_path = pg_catalog, public, private
as $$ select private.receive_purchase(p_store_id, p_supplier_id, p_document_number, p_notes, p_items); $$;
revoke all on function public.receive_purchase(uuid, uuid, text, text, jsonb) from public, anon;
grant execute on function public.receive_purchase(uuid, uuid, text, text, jsonb) to authenticated;

create function private.complete_sale_v2(p_store_id uuid, p_payment_method text, p_customer_id uuid, p_items jsonb)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare
  created_sale_id uuid;
  selected_customer public.customers;
  item jsonb;
  current_product public.products;
  item_quantity integer;
  running_total bigint := 0;
begin
  if not private.has_store_role(p_store_id, array['owner','admin','manager','operator']) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if p_payment_method not in ('Pix','Crédito','Débito','Dinheiro') then
    raise exception 'Forma de pagamento inválida' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100 then
    raise exception 'A venda deve ter entre 1 e 100 itens' using errcode = '22023';
  end if;
  if p_customer_id is not null then
    select * into selected_customer from public.customers where id = p_customer_id and store_id = p_store_id and active;
    if not found then raise exception 'Cliente não encontrado' using errcode = 'P0002'; end if;
  end if;

  insert into public.sales (store_id, payment_method, total_cents, customer_id, customer_name, sold_by)
  values (p_store_id, p_payment_method, 0, p_customer_id, coalesce(selected_customer.name,'Consumidor final'), (select auth.uid()))
  returning id into created_sale_id;

  for item in select value from jsonb_array_elements(p_items)
  loop
    item_quantity := (item ->> 'quantity')::integer;
    if item_quantity < 1 then raise exception 'Quantidade vendida inválida' using errcode = '22023'; end if;
    select * into current_product from public.products
    where id = (item ->> 'product_id')::uuid and store_id = p_store_id and active for update;
    if not found then raise exception 'Produto da venda não encontrado' using errcode = 'P0002'; end if;
    if current_product.stock_quantity < item_quantity then
      raise exception 'Estoque insuficiente para %', current_product.name using errcode = '22023';
    end if;
    update public.products set stock_quantity = stock_quantity - item_quantity where id = current_product.id;
    insert into public.sale_items (store_id, sale_id, product_id, product_name, quantity, unit_price_cents, subtotal_cents)
    values (p_store_id, created_sale_id, current_product.id, current_product.name, item_quantity, current_product.price_cents, current_product.price_cents * item_quantity);
    insert into public.inventory_movements (store_id, product_id, movement_type, quantity_delta, reason, sale_id, created_by)
    values (p_store_id, current_product.id, 'sale', -item_quantity, 'Venda concluída', created_sale_id, (select auth.uid()));
    running_total := running_total + current_product.price_cents::bigint * item_quantity;
  end loop;
  if running_total > 2147483647 then raise exception 'Valor total excede o limite permitido' using errcode = '22003'; end if;
  update public.sales set total_cents = running_total::integer where id = created_sale_id;
  return created_sale_id;
end;
$$;

revoke all on function private.complete_sale_v2(uuid, text, uuid, jsonb) from public, anon;
grant execute on function private.complete_sale_v2(uuid, text, uuid, jsonb) to authenticated;
create function public.complete_sale_v2(p_store_id uuid, p_payment_method text, p_customer_id uuid, p_items jsonb)
returns uuid language sql security invoker set search_path = pg_catalog, public, private
as $$ select private.complete_sale_v2(p_store_id, p_payment_method, p_customer_id, p_items); $$;
revoke all on function public.complete_sale_v2(uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.complete_sale_v2(uuid, text, uuid, jsonb) to authenticated;

commit;
