begin;

alter table public.sales
  add column if not exists request_id uuid not null default gen_random_uuid();

comment on column public.sales.request_id is
  'Chave idempotente da tentativa de venda; impede repetição de estoque, caixa e financeiro.';

create unique index if not exists sales_store_operator_request_uidx
  on public.sales (store_id, sold_by, request_id);

create or replace function private.complete_sale_v5(
  p_store_id uuid,
  p_cash_session_id uuid,
  p_request_id uuid,
  p_payments jsonb,
  p_customer_id uuid,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  created_sale_id uuid;
  selected_customer public.customers;
  current_session public.cash_sessions;
  item jsonb;
  payment jsonb;
  current_product public.products;
  item_quantity integer;
  payment_amount integer;
  payment_method text;
  payment_count integer;
  distinct_payment_count integer;
  payment_sum bigint := 0;
  cash_amount bigint := 0;
  running_total bigint := 0;
  payment_summary text;
begin
  if not private.has_store_role(p_store_id, array['owner','admin','manager','operator']) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  if p_request_id is null then
    raise exception 'Identificação da tentativa de venda é obrigatória' using errcode = '22023';
  end if;

  select id into created_sale_id
  from public.sales
  where store_id = p_store_id
    and sold_by = (select auth.uid())
    and request_id = p_request_id;

  if found then
    return created_sale_id;
  end if;

  select * into current_session
  from public.cash_sessions
  where id = p_cash_session_id
    and store_id = p_store_id
  for update;

  if not found
    or current_session.status <> 'open'
    or current_session.operator_id <> (select auth.uid()) then
    raise exception 'Abra seu turno de caixa antes da venda' using errcode = '42501';
  end if;

  if jsonb_typeof(p_payments) <> 'array'
    or jsonb_array_length(p_payments) < 1
    or jsonb_array_length(p_payments) > 4 then
    raise exception 'Informe entre 1 e 4 pagamentos' using errcode = '22023';
  end if;

  if jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) < 1
    or jsonb_array_length(p_items) > 100 then
    raise exception 'A venda deve ter entre 1 e 100 itens' using errcode = '22023';
  end if;

  select count(*), count(distinct value->>'method')
  into payment_count, distinct_payment_count
  from jsonb_array_elements(p_payments);

  if payment_count <> distinct_payment_count then
    raise exception 'Não repita a mesma forma de pagamento' using errcode = '22023';
  end if;

  if p_customer_id is not null then
    select * into selected_customer
    from public.customers
    where id = p_customer_id
      and store_id = p_store_id
      and active;

    if not found then
      raise exception 'Cliente não encontrado' using errcode = 'P0002';
    end if;
  end if;

  payment_summary := case
    when payment_count > 1 then 'Misto'
    else p_payments->0->>'method'
  end;

  if payment_summary not in ('Pix','Crédito','Débito','Dinheiro','Misto') then
    raise exception 'Forma de pagamento inválida' using errcode = '22023';
  end if;

  insert into public.sales (
    store_id, payment_method, total_cents, customer_id, customer_name,
    sold_by, cash_session_id, request_id
  )
  values (
    p_store_id, payment_summary, 0, p_customer_id,
    coalesce(selected_customer.name, 'Consumidor final'),
    (select auth.uid()), current_session.id, p_request_id
  )
  on conflict (store_id, sold_by, request_id) do nothing
  returning id into created_sale_id;

  if created_sale_id is null then
    select id into created_sale_id
    from public.sales
    where store_id = p_store_id
      and sold_by = (select auth.uid())
      and request_id = p_request_id;

    return created_sale_id;
  end if;

  for item in select value from jsonb_array_elements(p_items) loop
    item_quantity := (item->>'quantity')::integer;

    if item_quantity < 1 then
      raise exception 'Quantidade vendida inválida' using errcode = '22023';
    end if;

    select * into current_product
    from public.products
    where id = (item->>'product_id')::uuid
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
      store_id, sale_id, product_id, product_name,
      quantity, unit_price_cents, subtotal_cents
    )
    values (
      p_store_id, created_sale_id, current_product.id, current_product.name,
      item_quantity, current_product.price_cents,
      current_product.price_cents * item_quantity
    );

    insert into public.inventory_movements (
      store_id, product_id, movement_type, quantity_delta,
      reason, sale_id, created_by
    )
    values (
      p_store_id, current_product.id, 'sale', -item_quantity,
      'Venda concluída', created_sale_id, (select auth.uid())
    );

    running_total := running_total + current_product.price_cents::bigint * item_quantity;
  end loop;

  if running_total < 1 or running_total > 2147483647 then
    raise exception 'Valor total fora do limite' using errcode = '22003';
  end if;

  for payment in select value from jsonb_array_elements(p_payments) loop
    payment_method := payment->>'method';
    payment_amount := (payment->>'amount_cents')::integer;

    if payment_method not in ('Pix','Crédito','Débito','Dinheiro')
      or payment_amount < 1 then
      raise exception 'Pagamento inválido' using errcode = '22023';
    end if;

    payment_sum := payment_sum + payment_amount;
    if payment_method = 'Dinheiro' then
      cash_amount := payment_amount;
    end if;

    insert into public.sale_payments (
      store_id, sale_id, payment_method, amount_cents
    )
    values (
      p_store_id, created_sale_id, payment_method, payment_amount
    );
  end loop;

  if payment_sum <> running_total then
    raise exception 'A soma dos pagamentos deve ser igual ao total da venda' using errcode = '22023';
  end if;

  update public.sales
  set total_cents = running_total::integer
  where id = created_sale_id;

  insert into public.financial_entries (
    store_id, entry_type, category, description, amount_cents,
    payment_method, due_date, status, paid_at, sale_id, created_by
  )
  values (
    p_store_id, 'income', 'Vendas', 'Venda ' || left(created_sale_id::text, 6),
    running_total::integer, payment_summary, current_date, 'paid', now(),
    created_sale_id, (select auth.uid())
  );

  if cash_amount > 0 then
    insert into public.cash_movements (
      store_id, cash_session_id, movement_type, amount_cents,
      description, sale_id, created_by
    )
    values (
      p_store_id, current_session.id, 'sale', cash_amount::integer,
      case
        when payment_count > 1 then 'Parcela em dinheiro de pagamento dividido'
        else 'Venda em dinheiro'
      end,
      created_sale_id, (select auth.uid())
    );
  end if;

  return created_sale_id;
end;
$$;

create or replace function public.complete_sale_v5(
  p_store_id uuid,
  p_cash_session_id uuid,
  p_request_id uuid,
  p_payments jsonb,
  p_customer_id uuid,
  p_items jsonb
)
returns uuid
language sql
security invoker
set search_path = pg_catalog, public, private
as $$
  select private.complete_sale_v5(
    p_store_id,
    p_cash_session_id,
    p_request_id,
    p_payments,
    p_customer_id,
    p_items
  );
$$;

revoke all on function private.complete_sale_v5(uuid,uuid,uuid,jsonb,uuid,jsonb)
  from public, anon;
grant execute on function private.complete_sale_v5(uuid,uuid,uuid,jsonb,uuid,jsonb)
  to authenticated;

revoke all on function public.complete_sale_v5(uuid,uuid,uuid,jsonb,uuid,jsonb)
  from public, anon;
grant execute on function public.complete_sale_v5(uuid,uuid,uuid,jsonb,uuid,jsonb)
  to authenticated;

commit;
