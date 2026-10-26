-- Private provider-review state for JB Collections dropshipping.
-- Provider prices, URLs and notes must never be exposed by the public products API.
BEGIN;

CREATE TABLE IF NOT EXISTS public.product_provider_status (
  product_id uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  provider_name text NOT NULL DEFAULT 'GoPartner',
  provider_product_id text,
  provider_url text,
  provider_price_usd numeric(12,2) CHECK (provider_price_usd IS NULL OR provider_price_usd >= 0),
  provider_price_nio numeric(14,2) CHECK (provider_price_nio IS NULL OR provider_price_nio >= 0),
  provider_availability text NOT NULL DEFAULT 'unknown'
    CHECK (provider_availability IN ('unknown', 'available', 'on_order', 'out_of_stock')),
  review_notes text,
  last_reviewed_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_provider_status_reviewed_idx
  ON public.product_provider_status (last_reviewed_at DESC);

CREATE TABLE IF NOT EXISTS public.product_provider_review_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name_snapshot text NOT NULL,
  catalog_type_snapshot text NOT NULL
    CHECK (catalog_type_snapshot IN ('technology', 'perfumery')),
  provider_name text NOT NULL,
  provider_product_id text,
  provider_url text,
  provider_price_usd numeric(12,2),
  provider_price_nio numeric(14,2),
  provider_availability text NOT NULL
    CHECK (provider_availability IN ('unknown', 'available', 'on_order', 'out_of_stock')),
  review_notes text,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS product_provider_review_history_product_idx
  ON public.product_provider_review_history (product_id, reviewed_at DESC);

ALTER TABLE public.product_provider_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_provider_review_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_provider_status_admin_select ON public.product_provider_status;
CREATE POLICY product_provider_status_admin_select
  ON public.product_provider_status FOR SELECT TO authenticated
  USING (public.is_catalog_admin_user());

DROP POLICY IF EXISTS product_provider_status_admin_insert ON public.product_provider_status;
CREATE POLICY product_provider_status_admin_insert
  ON public.product_provider_status FOR INSERT TO authenticated
  WITH CHECK (public.is_catalog_admin_user());

DROP POLICY IF EXISTS product_provider_status_admin_update ON public.product_provider_status;
CREATE POLICY product_provider_status_admin_update
  ON public.product_provider_status FOR UPDATE TO authenticated
  USING (public.is_catalog_admin_user())
  WITH CHECK (public.is_catalog_admin_user());

DROP POLICY IF EXISTS product_provider_history_admin_select ON public.product_provider_review_history;
CREATE POLICY product_provider_history_admin_select
  ON public.product_provider_review_history FOR SELECT TO authenticated
  USING (public.is_catalog_admin_user());

-- History rows are written only when an authorized administrator changes provider status.
DROP POLICY IF EXISTS product_provider_history_admin_insert ON public.product_provider_review_history;
CREATE POLICY product_provider_history_admin_insert
  ON public.product_provider_review_history FOR INSERT TO authenticated
  WITH CHECK (public.is_catalog_admin_user());

REVOKE ALL ON TABLE public.product_provider_status FROM anon, authenticated;
REVOKE ALL ON TABLE public.product_provider_review_history FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.product_provider_status TO authenticated;
GRANT SELECT, INSERT ON TABLE public.product_provider_review_history TO authenticated;

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
    review_notes, reviewed_at, reviewed_by
  ) VALUES (
    NEW.product_id, COALESCE(product_record.name, 'Producto sin nombre'),
    CASE WHEN product_record.catalog_type = 'perfumery' THEN 'perfumery' ELSE 'technology' END,
    NEW.provider_name, NEW.provider_product_id, NEW.provider_url,
    NEW.provider_price_usd, NEW.provider_price_nio, NEW.provider_availability,
    NEW.review_notes, NEW.last_reviewed_at, NEW.reviewed_by
  );

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS product_provider_status_history_trigger ON public.product_provider_status;
CREATE TRIGGER product_provider_status_history_trigger
  BEFORE INSERT OR UPDATE ON public.product_provider_status
  FOR EACH ROW EXECUTE FUNCTION public.log_product_provider_review();

COMMENT ON TABLE public.product_provider_status IS
  'Private, latest known provider data and last manual review for dropshipping catalog products.';
COMMENT ON TABLE public.product_provider_review_history IS
  'Private append-only snapshots of product provider checks for audit and price/availability comparisons.';

NOTIFY pgrst, 'reload schema';
COMMIT;
