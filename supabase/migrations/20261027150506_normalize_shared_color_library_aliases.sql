-- Normalize model-specific aliases imported from published product variants.
-- If a product name already starts with its brand, do not duplicate the brand.
-- Preserve any aliases that were not generated from catalog product/color pairs.
with source_rows as (
  select
    lower(regexp_replace(btrim(v->>'color'), '\s+', ' ', 'g')) as name_key,
    upper(btrim(coalesce(v->>'color_hex', v->>'hex'))) as hex,
    btrim(concat_ws(' ', nullif(btrim(p.brand), ''), nullif(btrim(p.name), ''), btrim(v->>'color'))) as old_alias,
    case
      when nullif(btrim(p.brand), '') is not null
       and lower(btrim(p.name)) like lower(btrim(p.brand)) || '%'
      then btrim(concat_ws(' ', nullif(btrim(p.name), ''), btrim(v->>'color')))
      else btrim(concat_ws(' ', nullif(btrim(p.brand), ''), nullif(btrim(p.name), ''), btrim(v->>'color')))
    end as clean_alias
  from public.products p
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(coalesce(p.variants, '[]'::jsonb)) = 'array'
      then coalesce(p.variants, '[]'::jsonb)
      else '[]'::jsonb
    end
  ) as v
  where p.workflow_status = 'published'
    and nullif(btrim(v->>'color'), '') is not null
    and coalesce(v->>'color_hex', v->>'hex') ~* '^#[0-9A-F]{6}$'
),
name_hex_counts as (
  select name_key, count(distinct hex) as hex_count
  from source_rows
  group by name_key
),
eligible_names as (
  select name_key from name_hex_counts where hex_count = 1
)
update public.color_library c
set aliases = coalesce((
  select array_agg(distinct merged.alias order by merged.alias)
  from (
    select old.alias
    from unnest(coalesce(c.aliases, '{}'::text[])) as old(alias)
    where not exists (
      select 1
      from source_rows s
      join eligible_names e using (name_key)
      where s.name_key = c.name_key
        and s.hex = upper(c.hex)
        and s.old_alias = old.alias
    )
    union
    select s.clean_alias
    from source_rows s
    join eligible_names e using (name_key)
    where s.name_key = c.name_key
      and s.hex = upper(c.hex)
      and nullif(s.clean_alias, '') is not null
  ) merged
), '{}'::text[])
where exists (
  select 1
  from source_rows s
  join eligible_names e using (name_key)
  where s.name_key = c.name_key
    and s.hex = upper(c.hex)
);
