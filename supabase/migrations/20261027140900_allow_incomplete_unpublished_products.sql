-- Allow draft and unpublished product records to be saved with only a name.
-- Publication still requires a name, category, and availability.
begin;

alter table public.products
  drop constraint if exists products_workflow_required_fields_check;

alter table public.products
  add constraint products_workflow_required_fields_check
  check (
    workflow_status in ('trash', 'deleting')
    or (
      name is not null
      and length(btrim(name)) > 0
      and (
        workflow_status in ('draft', 'unpublished')
        or (
          category is not null
          and length(btrim(category)) > 0
          and availability is not null
          and length(btrim(availability)) > 0
        )
      )
    )
  );

notify pgrst, 'reload schema';
commit;
