begin;

alter table public.financial_entries
  add column customer_id uuid references public.customers(id) on delete set null,
  add column supplier_id uuid references public.suppliers(id) on delete set null,
  add column counterparty_name text not null default '' check (char_length(counterparty_name) <= 160),
  add constraint financial_entries_single_counterparty check (num_nonnulls(customer_id, supplier_id) <= 1);

create index financial_entries_customer_idx on public.financial_entries (customer_id) where customer_id is not null;
create index financial_entries_supplier_idx on public.financial_entries (supplier_id) where supplier_id is not null;

commit;
