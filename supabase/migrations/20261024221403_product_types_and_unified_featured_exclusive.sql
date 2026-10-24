-- Cat-logo: distinguish technology vs perfume/set items and use one featured/exclusive flag.
-- Idempotent to preserve current products and match the changes already applied to Supabase.

begin;

alter table public.products
  add column if not exists product_type text not null default 'standard';

update public.products
set product_type = case when catalog_type = 'perfumery' then 'perfume' else 'standard' end
where product_type = 'standard' and catalog_type = 'perfumery';

alter table public.products drop constraint if exists products_product_type_check;
alter table public.products
  add constraint products_product_type_check
  check (product_type in ('standard', 'perfume', 'set'));

update public.products
set featured = (coalesce(featured, false) or coalesce(is_exclusive, false)),
    is_exclusive = (coalesce(featured, false) or coalesce(is_exclusive, false))
where featured is distinct from (coalesce(featured, false) or coalesce(is_exclusive, false))
   or is_exclusive is distinct from (coalesce(featured, false) or coalesce(is_exclusive, false));

create or replace function public.sync_product_featured_exclusive()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare merged boolean;
begin
  if tg_op = 'INSERT' then
    merged := coalesce(new.featured, false) or coalesce(new.is_exclusive, false);
    new.featured := merged;
    new.is_exclusive := merged;
  elsif new.featured is distinct from old.featured
        and new.is_exclusive is not distinct from old.is_exclusive then
    new.is_exclusive := coalesce(new.featured, false);
  elsif new.is_exclusive is distinct from old.is_exclusive
        and new.featured is not distinct from old.featured then
    new.featured := coalesce(new.is_exclusive, false);
  else
    merged := coalesce(new.featured, false) or coalesce(new.is_exclusive, false);
    new.featured := merged;
    new.is_exclusive := merged;
  end if;
  return new;
end;
$function$;

drop trigger if exists products_sync_featured_exclusive on public.products;
create trigger products_sync_featured_exclusive
before insert or update of featured, is_exclusive
on public.products
for each row execute function public.sync_product_featured_exclusive();

comment on column public.products.product_type is
  'Catalog item type: standard for technology, perfume or set for perfumery.';

notify pgrst, 'reload schema';

commit;
