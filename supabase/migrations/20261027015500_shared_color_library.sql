-- Shared color names and aliases across browser and Android admin clients.
create table if not exists public.color_library (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  name_key text not null unique check (char_length(name_key) between 1 and 120),
  hex text not null check (hex ~ '^#[0-9A-Fa-f]{6}$'),
  aliases text[] not null default '{}'::text[],
  is_favorite boolean not null default false,
  updated_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.color_library enable row level security;
revoke all on table public.color_library from anon;
grant select, insert, update, delete on table public.color_library to authenticated;
drop policy if exists color_library_admin_select on public.color_library;
create policy color_library_admin_select on public.color_library for select to authenticated using (public.is_catalog_admin_user());
drop policy if exists color_library_admin_insert on public.color_library;
create policy color_library_admin_insert on public.color_library for insert to authenticated with check (public.is_catalog_admin_user() and updated_by = (select auth.uid()));
drop policy if exists color_library_admin_update on public.color_library;
create policy color_library_admin_update on public.color_library for update to authenticated using (public.is_catalog_admin_user()) with check (public.is_catalog_admin_user() and updated_by = (select auth.uid()));
drop policy if exists color_library_admin_delete on public.color_library;
create policy color_library_admin_delete on public.color_library for delete to authenticated using (public.is_catalog_admin_user());
comment on table public.color_library is 'Shared admin-only color library for JB TECH and JB Parfums; aliases and HEX persist across browser and Android admin clients.';
