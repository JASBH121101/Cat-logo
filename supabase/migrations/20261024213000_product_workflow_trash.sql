-- Cat-logo: independent product workflow states and a recoverable 15-day trash.
-- Additive migration: preserves existing products and public catalog compatibility.
-- Apply this migration to the Catálogo Supabase project before enabling the new admin actions.

begin;

alter table public.products
  add column if not exists workflow_status text,
  add column if not exists is_exclusive boolean not null default false,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_from_status text;

update public.products
set workflow_status = case when is_published then 'published' else 'unpublished' end
where workflow_status is null
   or workflow_status not in ('draft', 'unpublished', 'published', 'trash', 'deleting');

alter table public.products
  alter column workflow_status set default 'unpublished',
  alter column workflow_status set not null,
  alter column name drop not null,
  alter column category drop not null,
  alter column availability drop not null;

alter table public.products drop constraint if exists products_workflow_status_check;
alter table public.products
  add constraint products_workflow_status_check
  check (workflow_status in ('draft', 'unpublished', 'published', 'trash', 'deleting'));

alter table public.products drop constraint if exists products_deleted_from_status_check;
alter table public.products
  add constraint products_deleted_from_status_check
  check (deleted_from_status is null or deleted_from_status in ('draft', 'unpublished', 'published'));

alter table public.products drop constraint if exists products_workflow_required_fields_check;
alter table public.products
  add constraint products_workflow_required_fields_check
  check (
    workflow_status in ('draft', 'trash', 'deleting')
    or (
      name is not null and length(btrim(name)) > 0
      and category is not null and length(btrim(category)) > 0
      and availability is not null and length(btrim(availability)) > 0
    )
  );

create index if not exists products_workflow_status_catalog_idx
  on public.products (catalog_type, workflow_status, updated_at desc);

create index if not exists products_trash_expiry_idx
  on public.products (deleted_at)
  where workflow_status in ('trash', 'deleting') and deleted_at is not null;

create or replace function public.sync_catalog_product_workflow()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  restore_status text;
begin
  if tg_op = 'INSERT' then
    if new.deleted_at is not null then
      if new.workflow_status not in ('trash', 'deleting') then
        new.deleted_from_status := coalesce(
          new.deleted_from_status,
          case when new.is_published then 'published' else new.workflow_status end,
          'unpublished'
        );
        new.workflow_status := 'trash';
      end if;
      new.is_published := false;
    elsif new.workflow_status in ('draft', 'unpublished', 'published') then
      new.is_published := (new.workflow_status = 'published');
    elsif new.is_published then
      new.workflow_status := 'published';
    else
      new.workflow_status := 'unpublished';
    end if;
  else
    if old.deleted_at is null and new.deleted_at is not null then
      new.deleted_from_status := coalesce(
        old.workflow_status,
        case when old.is_published then 'published' else 'unpublished' end
      );
      if new.deleted_from_status not in ('draft', 'unpublished', 'published') then
        new.deleted_from_status := case when old.is_published then 'published' else 'unpublished' end;
      end if;
      new.workflow_status := 'trash';
      new.is_published := false;

    elsif old.deleted_at is not null and new.deleted_at is null then
      restore_status := coalesce(
        case when new.workflow_status in ('draft', 'unpublished', 'published') then new.workflow_status end,
        new.deleted_from_status,
        old.deleted_from_status,
        'unpublished'
      );
      if restore_status not in ('draft', 'unpublished', 'published') then
        restore_status := 'unpublished';
      end if;
      new.workflow_status := restore_status;
      new.deleted_from_status := null;
      new.is_published := (restore_status = 'published');

    elsif new.workflow_status is distinct from old.workflow_status then
      if new.workflow_status = 'trash' then
        if old.deleted_at is null then
          new.deleted_from_status := coalesce(
            case when old.workflow_status in ('draft', 'unpublished', 'published') then old.workflow_status end,
            case when old.is_published then 'published' else 'unpublished' end
          );
          new.deleted_at := coalesce(new.deleted_at, now());
        end if;
        new.is_published := false;
      elsif new.workflow_status = 'deleting' then
        new.deleted_at := coalesce(new.deleted_at, old.deleted_at, now());
        new.is_published := false;
      elsif new.workflow_status in ('draft', 'unpublished', 'published') and new.deleted_at is null then
        new.deleted_from_status := null;
        new.is_published := (new.workflow_status = 'published');
      end if;

    elsif new.is_published is distinct from old.is_published and new.deleted_at is null then
      new.workflow_status := case when new.is_published then 'published' else 'unpublished' end;
    end if;
  end if;

  if new.workflow_status in ('trash', 'deleting') then
    new.is_published := false;
  end if;
  return new;
end;
$function$;

drop trigger if exists products_sync_workflow_state on public.products;
create trigger products_sync_workflow_state
before insert or update of workflow_status, is_published, deleted_at, deleted_from_status
on public.products
for each row execute function public.sync_catalog_product_workflow();

comment on column public.products.workflow_status is
  'Admin workflow: draft, unpublished, published, trash or deleting.';
comment on column public.products.is_exclusive is
  'Independent exclusive-catalog flag; does not control public publication.';
comment on column public.products.deleted_at is
  'Soft-delete timestamp. Trash is retained for 15 days before permanent cleanup.';
comment on column public.products.deleted_from_status is
  'Workflow status to restore when a trashed product is recovered.';

notify pgrst, 'reload schema';

commit;
