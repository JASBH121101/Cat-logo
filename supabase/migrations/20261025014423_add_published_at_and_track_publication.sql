-- Track publication time separately from record creation time.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

-- Existing published records use created_at as the best available historical proxy.
UPDATE public.products
SET published_at = COALESCE(created_at, updated_at, pg_catalog.now())
WHERE is_published IS TRUE
  AND workflow_status = 'published'
  AND deleted_at IS NULL
  AND published_at IS NULL;

CREATE OR REPLACE FUNCTION public.sync_catalog_product_workflow()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
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
          new.deleted_at := coalesce(new.deleted_at, pg_catalog.now());
        end if;
        new.is_published := false;
      elsif new.workflow_status = 'deleting' then
        new.deleted_at := coalesce(new.deleted_at, old.deleted_at, pg_catalog.now());
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

  if tg_op = 'INSERT' then
    if new.workflow_status = 'published' and new.is_published IS TRUE then
      new.published_at := coalesce(new.published_at, pg_catalog.now());
    else
      new.published_at := null;
    end if;
  elsif new.workflow_status = 'published' and new.is_published IS TRUE then
    if old.workflow_status is distinct from 'published' or old.is_published is distinct from true then
      new.published_at := pg_catalog.now();
    else
      new.published_at := coalesce(new.published_at, old.published_at, new.created_at, pg_catalog.now());
    end if;
  end if;

  return new;
end;
$function$;
