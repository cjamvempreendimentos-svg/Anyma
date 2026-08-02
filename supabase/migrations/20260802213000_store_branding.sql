alter table public.stores
  add column if not exists logo_url text;

comment on column public.stores.logo_url is
  'URL pública da identidade visual exibida no ambiente da loja.';

update public.stores
set logo_url = '/mimos-logo.png'
where lower(name) = 'mimos';
