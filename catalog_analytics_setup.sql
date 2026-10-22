-- Cat-logo: configuración manual de analítica para una instalación nueva.
-- Alineado con las migraciones de supabase/migrations/.
-- No ejecutar sobre una instalación existente sin revisar antes el esquema.
-- El refresco de caché por sí solo puede hacerse con:
-- NOTIFY pgrst, 'reload schema';

BEGIN;

CREATE TABLE IF NOT EXISTS public.catalog_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NULL REFERENCES public.products(id) ON DELETE SET NULL,
  event_type text NOT NULL
    CONSTRAINT catalog_events_event_type_check
    CHECK (event_type IN ('view', 'whatsapp_click')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.catalog_events
  ADD COLUMN IF NOT EXISTS variant_color text,
  ADD COLUMN IF NOT EXISTS variant_ram text,
  ADD COLUMN IF NOT EXISTS variant_storage text;

CREATE INDEX IF NOT EXISTS catalog_events_created_at_idx
  ON public.catalog_events (created_at DESC);

CREATE INDEX IF NOT EXISTS catalog_events_product_type_created_idx
  ON public.catalog_events (product_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS catalog_events_variant_interest_idx
  ON public.catalog_events (
    event_type, variant_storage, variant_ram, variant_color, created_at DESC
  )
  WHERE event_type = 'whatsapp_click';

ALTER TABLE public.catalog_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_catalog_admin_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_users AS admin
    WHERE admin.user_id = auth.uid()
  );
$function$;

REVOKE ALL ON FUNCTION public.is_catalog_admin_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_catalog_admin_user() TO authenticated;

-- This is a dedicated analytics table: remove outdated policies so the only
-- active permissions are public event insertion for published products and
-- read access for authenticated catalog admins.
DO $block$
DECLARE
  existing_policy record;
BEGIN
  FOR existing_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'catalog_events'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.catalog_events',
      existing_policy.policyname
    );
  END LOOP;
END;
$block$;

CREATE POLICY catalog_events_insert_public_published
ON public.catalog_events
FOR INSERT
TO anon, authenticated
WITH CHECK (
  event_type IN ('view', 'whatsapp_click')
  AND EXISTS (
    SELECT 1
    FROM public.products AS product
    WHERE product.id = catalog_events.product_id
      AND product.is_published IS TRUE
  )
);

CREATE POLICY catalog_events_select_admin_only
ON public.catalog_events
FOR SELECT
TO authenticated
USING (public.is_catalog_admin_user());

REVOKE ALL ON TABLE public.catalog_events FROM anon, authenticated;
GRANT INSERT ON TABLE public.catalog_events TO anon, authenticated;
GRANT SELECT ON TABLE public.catalog_events TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
