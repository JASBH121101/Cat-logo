-- Cat-logo: analytics events for product detail views and WhatsApp clicks.
-- Target Supabase project is the one configured in config.js for Cat-logo.
-- Review the existing catalog_events schema/policies before applying manually.
-- This file is committed to the Git branch only; it is NOT applied to Supabase automatically.

begin;

create table if not exists public.catalog_events (
  id uuid primary key default gen_random_uuid(),
  product_id uuid null references public.products(id) on delete set null,
  event_type text not null
    constraint catalog_events_event_type_check
    check (event_type in ('view', 'whatsapp_click')),
  created_at timestamptz not null default now()
);

create index if not exists catalog_events_created_at_idx
  on public.catalog_events (created_at desc);

create index if not exists catalog_events_product_type_created_idx
  on public.catalog_events (product_id, event_type, created_at desc);

alter table public.catalog_events enable row level security;

-- Only authenticated admins can read analytics. SECURITY DEFINER lets the
-- function check admin_users without granting broad access to that table.
create or replace function public.is_catalog_admin_user()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select exists (
    select 1
    from public.admin_users as admin
    where admin.user_id = auth.uid()
  );
$function$;

revoke all on function public.is_catalog_admin_user() from public, anon;
grant execute on function public.is_catalog_admin_user() to authenticated;

-- Reset policies on this dedicated analytics table, then apply only the
-- insert policy for published product events and the admin-only read policy.
do $block$
declare
  existing_policy record;
begin
  for existing_policy in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'catalog_events'
  loop
    execute format(
      'drop policy if exists %I on public.catalog_events',
      existing_policy.policyname
    );
  end loop;
end;
$block$;

create policy catalog_events_insert_public_published
on public.catalog_events
for insert
to anon, authenticated
with check (
  event_type in ('view', 'whatsapp_click')
  and exists (
    select 1
    from public.products as product
    where product.id = catalog_events.product_id
      and product.is_published is true
  )
);

create policy catalog_events_select_admin_only
on public.catalog_events
for select
to authenticated
using (public.is_catalog_admin_user());

-- Public visitors can submit allowed events but cannot read, update or delete them.
-- The authenticated role can read only through the admin-only RLS policy.
revoke all on table public.catalog_events from anon, authenticated;
grant insert on table public.catalog_events to anon, authenticated;
grant select on table public.catalog_events to authenticated;

commit;
