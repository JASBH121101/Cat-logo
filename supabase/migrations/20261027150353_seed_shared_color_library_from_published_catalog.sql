-- Seed the shared AI color memory from existing published catalog variants.
-- Only names that resolve to one consistent HEX across the catalog are imported.
-- Manufacturer codes are not inferred here; product-name/color aliases are search aids.
with source_rows as (
  select
    btrim(v->>'color') as color_name,
    upper(btrim(coalesce(v->>'color_hex', v->>'hex'))) as hex,
    lower(regexp_replace(btrim(v->>'color'), '\s+', ' ', 'g')) as name_key,
    btrim(concat_ws(' ',
      nullif(btrim(p.brand), ''),
      nullif(btrim(p.name), ''),
      btrim(v->>'color')
    )) as alias
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
seed_colors as (
  select
    min(s.color_name) as name,
    s.name_key,
    min(s.hex) as hex,
    array_agg(distinct s.alias order by s.alias)
      filter (where nullif(s.alias, '') is not null and lower(s.alias) <> s.name_key) as aliases
  from source_rows s
  join name_hex_counts c using (name_key)
  where c.hex_count = 1
  group by s.name_key
),
admin_actor as (
  select user_id
  from public.admin_users
  order by created_at
  limit 1
)
insert into public.color_library
  (name, name_key, hex, aliases, is_favorite, updated_by, updated_at)
select
  s.name,
  s.name_key,
  s.hex,
  coalesce((
    select array_agg(x.alias order by x.alias)
    from (
      select distinct alias
      from unnest(coalesce(s.aliases, '{}'::text[])) as alias
      order by alias
      limit 20
    ) x
  ), '{}'::text[]),
  false,
  a.user_id,
  now()
from seed_colors s
cross join admin_actor a
on conflict (name_key) do nothing;
