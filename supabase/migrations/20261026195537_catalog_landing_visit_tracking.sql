-- Track public catalog page loads by catalog and approximate department.
-- Product-detail views and WhatsApp clicks keep their existing meanings.
BEGIN;

ALTER TABLE public.catalog_events
  ADD COLUMN IF NOT EXISTS catalog_type text;

ALTER TABLE public.catalog_events
  DROP CONSTRAINT IF EXISTS catalog_events_event_type_check;

ALTER TABLE public.catalog_events
  ADD CONSTRAINT catalog_events_event_type_check
  CHECK (event_type IN ('view', 'whatsapp_click', 'catalog_view'));

CREATE INDEX IF NOT EXISTS catalog_events_catalog_visit_created_idx
  ON public.catalog_events (catalog_type, event_type, created_at DESC);

DROP POLICY IF EXISTS catalog_events_insert_public_published ON public.catalog_events;

CREATE POLICY catalog_events_insert_public_published
  ON public.catalog_events
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    (
      event_type IN ('view', 'whatsapp_click')
      AND EXISTS (
        SELECT 1
        FROM public.products AS product
        WHERE product.id = catalog_events.product_id
          AND product.is_published IS TRUE
      )
    )
    OR
    (
      event_type = 'catalog_view'
      AND product_id IS NULL
      AND catalog_type IN ('technology', 'perfumery')
    )
  );

NOTIFY pgrst, 'reload schema';
COMMIT;
