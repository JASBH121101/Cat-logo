-- Add technology taxonomy fields without changing existing product records.
alter table public.products
  add column if not exists subcategory text,
  add column if not exists tags text[] not null default '{}'::text[];

update public.products set tags = '{}'::text[] where tags is null;

alter table public.products
  alter column tags set default '{}'::text[],
  alter column tags set not null;

create index if not exists products_tags_gin_idx on public.products using gin (tags);
comment on column public.products.subcategory is 'Optional manually assigned subcategory for catalog organization.';
comment on column public.products.tags is 'Manually assigned labels: top_gaming, best_seller, new_arrival, offer, recommended, exclusive.';
