begin;

alter table public.products
  add column supplier_id uuid references public.suppliers(id) on delete set null,
  add column supplier_name text not null default '',
  add column size text not null default '' check (char_length(size) <= 40);

create index products_supplier_idx on public.products (supplier_id) where supplier_id is not null;
create index products_store_category_idx on public.products (store_id, category) where active;

create or replace function private.create_product_v2(
  p_store_id uuid,
  p_supplier_id uuid,
  p_sku text,
  p_name text,
  p_category text,
  p_size text,
  p_cost_cents integer,
  p_price_cents integer,
  p_stock_quantity integer,
  p_min_stock integer,
  p_color text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  selected_supplier public.suppliers;
  created_product_id uuid;
begin
  if not private.has_store_role(p_store_id, array['owner','admin','manager']) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  select * into selected_supplier
  from public.suppliers
  where id = p_supplier_id and store_id = p_store_id and active;
  if not found then
    raise exception 'Fornecedor não encontrado' using errcode = 'P0002';
  end if;

  if char_length(trim(coalesce(p_sku, ''))) not between 1 and 60
    or char_length(trim(coalesce(p_name, ''))) not between 2 and 160
    or char_length(trim(coalesce(p_category, ''))) not between 1 and 80
    or char_length(trim(coalesce(p_size, ''))) > 40
    or p_cost_cents < 0 or p_price_cents < 0
    or p_stock_quantity < 0 or p_min_stock < 0
    or p_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'Dados do produto inválidos' using errcode = '22023';
  end if;

  insert into public.products (
    store_id, supplier_id, supplier_name, sku, name, category, size,
    cost_cents, price_cents, stock_quantity, min_stock, color
  ) values (
    p_store_id, selected_supplier.id, selected_supplier.name, trim(p_sku), trim(p_name),
    trim(p_category), trim(coalesce(p_size, '')), p_cost_cents, p_price_cents,
    p_stock_quantity, p_min_stock, p_color
  ) returning id into created_product_id;

  if p_stock_quantity > 0 then
    insert into public.inventory_movements (
      store_id, product_id, movement_type, quantity_delta, reason, created_by
    ) values (
      p_store_id, created_product_id, 'opening', p_stock_quantity,
      'Estoque inicial do cadastro', (select auth.uid())
    );
  end if;

  return created_product_id;
end;
$$;

create or replace function private.update_product_v2(
  p_product_id uuid,
  p_supplier_id uuid,
  p_sku text,
  p_name text,
  p_category text,
  p_size text,
  p_cost_cents integer,
  p_price_cents integer,
  p_min_stock integer,
  p_color text,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  selected_product public.products;
  selected_supplier public.suppliers;
begin
  select * into selected_product from public.products where id = p_product_id for update;
  if not found then raise exception 'Produto não encontrado' using errcode = 'P0002'; end if;
  if not private.has_store_role(selected_product.store_id, array['owner','admin','manager']) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  select * into selected_supplier from public.suppliers
  where id = p_supplier_id and store_id = selected_product.store_id and active;
  if not found then raise exception 'Fornecedor não encontrado' using errcode = 'P0002'; end if;

  if char_length(trim(coalesce(p_sku, ''))) not between 1 and 60
    or char_length(trim(coalesce(p_name, ''))) not between 2 and 160
    or char_length(trim(coalesce(p_category, ''))) not between 1 and 80
    or char_length(trim(coalesce(p_size, ''))) > 40
    or p_cost_cents < 0 or p_price_cents < 0 or p_min_stock < 0
    or p_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'Dados do produto inválidos' using errcode = '22023';
  end if;

  update public.products set
    supplier_id = selected_supplier.id,
    supplier_name = selected_supplier.name,
    sku = trim(p_sku),
    name = trim(p_name),
    category = trim(p_category),
    size = trim(coalesce(p_size, '')),
    cost_cents = p_cost_cents,
    price_cents = p_price_cents,
    min_stock = p_min_stock,
    color = p_color,
    active = p_active
  where id = p_product_id;
end;
$$;

create or replace function private.list_store_products_v2(p_store_id uuid)
returns table (
  id uuid, store_id uuid, supplier_id uuid, supplier_name text, sku text, name text,
  category text, size text, cost_cents integer, price_cents integer,
  stock_quantity integer, min_stock integer, color text, active boolean,
  created_at timestamptz, updated_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select product.id, product.store_id, product.supplier_id, product.supplier_name,
    product.sku, product.name, product.category, product.size,
    case when private.has_store_role(p_store_id, array['owner','admin','manager'])
      then product.cost_cents else null end,
    product.price_cents, product.stock_quantity, product.min_stock, product.color,
    product.active, product.created_at, product.updated_at
  from public.products product
  where product.store_id = p_store_id
    and private.is_store_member(p_store_id)
    and (product.active or private.has_store_role(p_store_id, array['owner','admin','manager']))
  order by product.active desc, product.name, product.size, product.sku;
$$;

create function public.create_product_v2(
  p_store_id uuid, p_supplier_id uuid, p_sku text, p_name text, p_category text,
  p_size text, p_cost_cents integer, p_price_cents integer, p_stock_quantity integer,
  p_min_stock integer, p_color text
)
returns uuid language sql security invoker set search_path = pg_catalog, public, private
as $$ select private.create_product_v2(p_store_id, p_supplier_id, p_sku, p_name, p_category,
  p_size, p_cost_cents, p_price_cents, p_stock_quantity, p_min_stock, p_color); $$;

create function public.update_product_v2(
  p_product_id uuid, p_supplier_id uuid, p_sku text, p_name text, p_category text,
  p_size text, p_cost_cents integer, p_price_cents integer, p_min_stock integer,
  p_color text, p_active boolean
)
returns void language sql security invoker set search_path = pg_catalog, public, private
as $$ select private.update_product_v2(p_product_id, p_supplier_id, p_sku, p_name, p_category,
  p_size, p_cost_cents, p_price_cents, p_min_stock, p_color, p_active); $$;

create function public.list_store_products_v2(p_store_id uuid)
returns table (
  id uuid, store_id uuid, supplier_id uuid, supplier_name text, sku text, name text,
  category text, size text, cost_cents integer, price_cents integer,
  stock_quantity integer, min_stock integer, color text, active boolean,
  created_at timestamptz, updated_at timestamptz
)
language sql stable security invoker set search_path = pg_catalog, public, private
as $$ select * from private.list_store_products_v2(p_store_id); $$;

revoke all on function private.create_product_v2(uuid,uuid,text,text,text,text,integer,integer,integer,integer,text),
  private.update_product_v2(uuid,uuid,text,text,text,text,integer,integer,integer,text,boolean),
  private.list_store_products_v2(uuid) from public, anon;
grant execute on function private.create_product_v2(uuid,uuid,text,text,text,text,integer,integer,integer,integer,text),
  private.update_product_v2(uuid,uuid,text,text,text,text,integer,integer,integer,text,boolean),
  private.list_store_products_v2(uuid) to authenticated;

revoke all on function public.create_product_v2(uuid,uuid,text,text,text,text,integer,integer,integer,integer,text),
  public.update_product_v2(uuid,uuid,text,text,text,text,integer,integer,integer,text,boolean),
  public.list_store_products_v2(uuid) from public, anon;
grant execute on function public.create_product_v2(uuid,uuid,text,text,text,text,integer,integer,integer,integer,text),
  public.update_product_v2(uuid,uuid,text,text,text,text,integer,integer,integer,text,boolean),
  public.list_store_products_v2(uuid) to authenticated;

commit;
