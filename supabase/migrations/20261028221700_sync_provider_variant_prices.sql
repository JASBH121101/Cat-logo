BEGIN;

-- Atomically record the private supplier review and, when explicitly requested,
-- synchronize confirmed availability statuses to the public catalog.
CREATE OR REPLACE FUNCTION public.confirm_provider_product_review(
  p_product_id uuid,
  p_review_payload jsonb,
  p_sync_catalog_availability boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_product public.products%rowtype;
  v_snapshot jsonb;
  v_variant jsonb;
  v_group jsonb;
  v_color jsonb;
  v_config_key text;
  v_color_name text;
  v_config_status text;
  v_color_status text;
  v_updated_variants jsonb := '[]'::jsonb;
  v_variant_count integer := 0;
  v_color_count integer := 0;
  v_provider_availability text;
  v_provider_price_usd numeric(12,2);
  v_provider_price_nio numeric(14,2);
  v_config_price_usd numeric(12,2);
  v_config_price_nio numeric(14,2);
  v_public_min_price_usd numeric(12,2);
  v_public_min_price_nio numeric(14,2);
  v_sync boolean := coalesce(p_sync_catalog_availability, true);
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users au WHERE au.user_id = v_uid
  ) THEN
    RAISE EXCEPTION USING errcode='42501', message='admin_only';
  END IF;

  IF p_review_payload IS NULL OR jsonb_typeof(p_review_payload) <> 'object' THEN
    RAISE EXCEPTION USING errcode='22023', message='invalid_provider_review_payload';
  END IF;

  SELECT p.* INTO v_product
    FROM public.products p
   WHERE p.id = p_product_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode='P0002', message='product_not_found';
  END IF;

  v_provider_availability := p_review_payload->>'provider_availability';
  IF v_provider_availability IS NULL OR v_provider_availability NOT IN ('available', 'on_order', 'out_of_stock') THEN
    RAISE EXCEPTION USING errcode='22023', message='provider_availability_must_be_confirmed';
  END IF;

  v_provider_price_usd := NULLIF(p_review_payload->>'provider_price_usd', '')::numeric;
  v_provider_price_nio := NULLIF(p_review_payload->>'provider_price_nio', '')::numeric;
  IF v_provider_price_usd IS NOT NULL AND v_provider_price_usd < 0 THEN
    RAISE EXCEPTION USING errcode='22023', message='invalid_provider_price_usd';
  END IF;
  IF v_provider_price_nio IS NOT NULL AND v_provider_price_nio < 0 THEN
    RAISE EXCEPTION USING errcode='22023', message='invalid_provider_price_nio';
  END IF;

  v_snapshot := p_review_payload->'provider_variant_snapshot';
  IF v_snapshot IS NULL OR jsonb_typeof(v_snapshot) <> 'array' THEN
    RAISE EXCEPTION USING errcode='22023', message='provider_variant_snapshot_must_be_array';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(v_snapshot) AS g(element)
     WHERE nullif(g.element->>'config_key', '') IS NULL
        OR coalesce(g.element->>'provider_availability', 'unknown')
          NOT IN ('available', 'on_order', 'out_of_stock')
  ) THEN
    RAISE EXCEPTION USING errcode='22023', message='provider_configuration_availability_must_be_confirmed';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(v_snapshot) AS g(element)
     WHERE g.element ? 'colors'
       AND jsonb_typeof(g.element->'colors') <> 'array'
  ) THEN
    RAISE EXCEPTION USING errcode='22023', message='provider_configuration_colors_must_be_array';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(v_snapshot) AS g(element)
      CROSS JOIN LATERAL jsonb_array_elements(coalesce(g.element->'colors', '[]'::jsonb)) AS c(element)
     WHERE coalesce(c.element->>'provider_availability', 'unknown')
       NOT IN ('available', 'on_order', 'out_of_stock')
        OR nullif(c.element->>'color', '') IS NULL
  ) THEN
    RAISE EXCEPTION USING errcode='22023', message='provider_color_availability_must_be_confirmed';
  END IF;

  -- Record the review and its immutable snapshot in one transaction.
  INSERT INTO public.product_provider_status (
    product_id, provider_name, provider_product_id, provider_url,
    provider_price_usd, provider_price_nio, provider_availability,
    review_notes, provider_variant_snapshot, last_reviewed_at, reviewed_by,
    created_at, updated_at
  ) VALUES (
    p_product_id,
    coalesce(nullif(trim(p_review_payload->>'provider_name'), ''), 'GoPartner'),
    nullif(trim(p_review_payload->>'provider_product_id'), ''),
    nullif(trim(p_review_payload->>'provider_url'), ''),
    v_provider_price_usd,
    v_provider_price_nio,
    v_provider_availability,
    nullif(trim(p_review_payload->>'review_notes'), ''),
    v_snapshot,
    now(),
    v_uid,
    now(),
    now()
  )
  ON CONFLICT (product_id) DO UPDATE SET
    provider_name = EXCLUDED.provider_name,
    provider_product_id = EXCLUDED.provider_product_id,
    provider_url = EXCLUDED.provider_url,
    provider_price_usd = EXCLUDED.provider_price_usd,
    provider_price_nio = EXCLUDED.provider_price_nio,
    provider_availability = EXCLUDED.provider_availability,
    review_notes = EXCLUDED.review_notes,
    provider_variant_snapshot = EXCLUDED.provider_variant_snapshot,
    last_reviewed_at = now(),
    reviewed_by = v_uid,
    updated_at = now();

  IF v_sync THEN
    IF jsonb_typeof(coalesce(v_product.variants, '[]'::jsonb)) <> 'array' THEN
      RAISE EXCEPTION USING errcode='22023', message='catalog_variants_must_be_array';
    END IF;

    FOR v_variant IN
      SELECT value FROM jsonb_array_elements(coalesce(v_product.variants, '[]'::jsonb))
    LOOP
      IF jsonb_typeof(v_variant) <> 'object' THEN
        RAISE EXCEPTION USING errcode='22023', message='catalog_variant_is_invalid';
      END IF;

      v_config_key :=
        regexp_replace(lower(coalesce(v_variant->>'ram', '')), '[^a-z0-9]+', '', 'g')
        || '|' ||
        regexp_replace(lower(coalesce(v_variant->>'storage', v_variant->>'capacity',
          CASE WHEN v_variant ? 'storage_value'
            THEN coalesce(v_variant->>'storage_value', '') || ' ' || coalesce(v_variant->>'storage_unit', 'GB')
            ELSE '' END, '')), '[^a-z0-9]+', '', 'g');

      SELECT element INTO v_group
        FROM jsonb_array_elements(v_snapshot) AS g(element)
       WHERE g.element->>'config_key' = v_config_key
       LIMIT 1;

      IF v_group IS NULL THEN
        RAISE EXCEPTION USING errcode='22023',
          message='provider_review_missing_configuration:' || v_config_key;
      END IF;

      v_config_status := v_group->>'provider_availability';
      v_config_price_usd := NULLIF(v_group->>'provider_price_usd', '')::numeric;
      v_config_price_nio := NULLIF(v_group->>'provider_price_nio', '')::numeric;
      IF v_config_price_usd IS NOT NULL AND v_config_price_usd < 0 THEN
        RAISE EXCEPTION USING errcode='22023', message='invalid_configuration_provider_price_usd';
      END IF;
      IF v_config_price_nio IS NOT NULL AND v_config_price_nio < 0 THEN
        RAISE EXCEPTION USING errcode='22023', message='invalid_configuration_provider_price_nio';
      END IF;
      v_variant := v_variant || jsonb_build_object(
        'configuration_availability',
        CASE WHEN v_config_status = 'on_order' THEN 'order' ELSE v_config_status END
      );
      IF v_config_price_usd IS NOT NULL THEN
        v_variant := v_variant || jsonb_build_object('price_usd', v_config_price_usd);
      END IF;
      IF v_config_price_nio IS NOT NULL THEN
        v_variant := v_variant || jsonb_build_object('price_nio', v_config_price_nio);
      END IF;

      v_color_name := trim(coalesce(v_variant->>'color', ''));
      IF v_color_name <> '' THEN
        SELECT element INTO v_color
          FROM jsonb_array_elements(coalesce(v_group->'colors', '[]'::jsonb)) AS c(element)
         WHERE lower(trim(coalesce(c.element->>'color', ''))) = lower(v_color_name)
         LIMIT 1;

        IF v_color IS NULL THEN
          RAISE EXCEPTION USING errcode='22023',
            message='provider_review_missing_color:' || v_config_key || ':' || v_color_name;
        END IF;

        v_color_status := v_color->>'provider_availability';
        v_variant := v_variant || jsonb_build_object(
          'availability',
          CASE WHEN v_color_status = 'on_order' THEN 'order' ELSE v_color_status END
        );
        v_color_count := v_color_count + 1;
      END IF;

      v_updated_variants := v_updated_variants || jsonb_build_array(v_variant);
      v_variant_count := v_variant_count + 1;
      v_group := NULL;
      v_color := NULL;
    END LOOP;

    IF jsonb_array_length(v_updated_variants) > 0 THEN
      SELECT
        min(CASE
          WHEN coalesce(v.element->>'price_usd', '') ~ '^[0-9]+(\.[0-9]+)?
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'review_saved', true,
    'catalog_availability_synced', v_sync,
    'product_availability', v_provider_availability,
    'variant_count', v_variant_count,
    'color_count', v_color_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.confirm_provider_product_review(uuid, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_provider_product_review(uuid, jsonb, boolean) TO authenticated;

COMMENT ON FUNCTION public.confirm_provider_product_review(uuid, jsonb, boolean) IS
  'Stores a private GoPartner review snapshot and atomically synchronizes confirmed product/configuration/color availability when requested.';

NOTIFY pgrst, 'reload schema';
COMMIT;

          THEN (v.element->>'price_usd')::numeric
          ELSE NULL
        END),
        min(CASE
          WHEN coalesce(v.element->>'price_nio', '') ~ '^[0-9]+(\.[0-9]+)?
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'review_saved', true,
    'catalog_availability_synced', v_sync,
    'product_availability', v_provider_availability,
    'variant_count', v_variant_count,
    'color_count', v_color_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.confirm_provider_product_review(uuid, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_provider_product_review(uuid, jsonb, boolean) TO authenticated;

COMMENT ON FUNCTION public.confirm_provider_product_review(uuid, jsonb, boolean) IS
  'Stores a private GoPartner review snapshot and atomically synchronizes confirmed product/configuration/color availability when requested.';

NOTIFY pgrst, 'reload schema';
COMMIT;

          THEN (v.element->>'price_nio')::numeric
          ELSE NULL
        END)
      INTO v_public_min_price_usd, v_public_min_price_nio
      FROM jsonb_array_elements(v_updated_variants) AS v(element);
    END IF;

    UPDATE public.products
       SET availability = v_provider_availability,
           variants = v_updated_variants,
           price_usd = CASE
             WHEN jsonb_array_length(v_updated_variants) > 0
               THEN coalesce(v_public_min_price_usd, v_provider_price_usd, v_product.price_usd)
             ELSE coalesce(v_provider_price_usd, v_product.price_usd)
           END,
           price_nio = CASE
             WHEN jsonb_array_length(v_updated_variants) > 0
               THEN coalesce(v_public_min_price_nio, v_provider_price_nio, v_product.price_nio)
             ELSE coalesce(v_provider_price_nio, v_product.price_nio)
           END,
           updated_at = now(),
           updated_by = v_uid
     WHERE id = p_product_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'review_saved', true,
    'catalog_availability_synced', v_sync,
    'product_availability', v_provider_availability,
    'variant_count', v_variant_count,
    'color_count', v_color_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.confirm_provider_product_review(uuid, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_provider_product_review(uuid, jsonb, boolean) TO authenticated;

COMMENT ON FUNCTION public.confirm_provider_product_review(uuid, jsonb, boolean) IS
  'Stores a private GoPartner review snapshot and atomically synchronizes confirmed product/configuration/color availability when requested.';

NOTIFY pgrst, 'reload schema';
COMMIT;
