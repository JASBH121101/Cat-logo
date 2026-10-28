BEGIN;

-- Store a private snapshot of each supplier-side configuration and color status.
-- Keep it separate from the public products.variants JSON and preserve every review in history.
ALTER TABLE public.product_provider_status
  ADD COLUMN IF NOT EXISTS provider_variant_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.product_provider_review_history
  ADD COLUMN IF NOT EXISTS provider_variant_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.log_product_provider_review()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  product_record record;
BEGIN
  SELECT p.name, p.catalog_type
    INTO product_record
    FROM public.products AS p
    WHERE p.id = NEW.product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe el producto asociado a la revisión del proveedor.';
  END IF;

  INSERT INTO public.product_provider_review_history (
    product_id, product_name_snapshot, catalog_type_snapshot,
    provider_name, provider_product_id, provider_url,
    provider_price_usd, provider_price_nio, provider_availability,
    review_notes, provider_variant_snapshot, reviewed_at, reviewed_by
  ) VALUES (
    NEW.product_id, COALESCE(product_record.name, 'Producto sin nombre'),
    CASE WHEN product_record.catalog_type = 'perfumery' THEN 'perfumery' ELSE 'technology' END,
    NEW.provider_name, NEW.provider_product_id, NEW.provider_url,
    NEW.provider_price_usd, NEW.provider_price_nio, NEW.provider_availability,
    NEW.review_notes, COALESCE(NEW.provider_variant_snapshot, '[]'::jsonb),
    NEW.last_reviewed_at, NEW.reviewed_by
  );

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

COMMENT ON COLUMN public.product_provider_status.provider_variant_snapshot IS
  'Private GoPartner review snapshot for each RAM/storage configuration and color availability.';
COMMENT ON COLUMN public.product_provider_review_history.provider_variant_snapshot IS
  'Immutable per-review snapshot of supplier-side configuration and color availability.';

NOTIFY pgrst, 'reload schema';
COMMIT;
