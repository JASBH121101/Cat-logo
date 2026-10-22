-- Catálogo de Tecnología: product analytics
-- Run once in Supabase > SQL Editor for the project used by config.js.
create table if not exists public.catalog_events (
  id bigint generated always as identity primary key,
  product_id uuid not null references public.products(id) on delete cascade,
  event_type text not null check (event_type in ('view', 'whatsapp_click')),
  created_at timestamptz not null default now()
);

create index if not exists catalog_events_product_created_idx
  on public.catalog_events (product_id, created_at desc);
create index if not exists catalog_events_type_created_idx
  on public.catalog_events (event_type, created_at desc);

alter table public.catalog_events enable row level security;

drop policy if exists "Public can record events for published products" on public.catalog_events;
create policy "Public can record events for published products"
  on public.catalog_events
  for insert
  to anon, authenticated
  with check (
    event_type in ('view', 'whatsapp_click')
    and exists (
      select 1 from public.products p
      where p.id = product_id and p.is_published = true
    )
  );

drop policy if exists "Catalog admins can read analytics" on public.catalog_events;
create policy "Catalog admins can read analytics"
  on public.catalog_events
  for select
  to authenticated
  using (public.is_catalog_admin());

-- No public SELECT, UPDATE, or DELETE policy is created for event rows.
