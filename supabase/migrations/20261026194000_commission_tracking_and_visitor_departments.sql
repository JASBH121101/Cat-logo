-- Approximate visitor departments plus private commission tracking.
-- Commission records deliberately store no product prices or supplier costs.
BEGIN;
ALTER TABLE public.catalog_events
  ADD COLUMN IF NOT EXISTS visitor_country text,
  ADD COLUMN IF NOT EXISTS visitor_department text;
CREATE INDEX IF NOT EXISTS catalog_events_department_type_created_idx
  ON public.catalog_events(visitor_country, visitor_department, event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS public.commission_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_type text NOT NULL CHECK (catalog_type IN ('technology','perfumery')),
  product_id uuid NULL REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  department text NULL,
  channel text NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp','messenger','other')),
  commission_amount numeric(12,2) NULL CHECK (commission_amount IS NULL OR commission_amount >= 0),
  commission_currency text NOT NULL DEFAULT 'NIO' CHECK (commission_currency IN ('NIO','USD')),
  status text NOT NULL DEFAULT 'pending_confirmation'
    CHECK (status IN ('pending_confirmation','confirmed_pending_payment','received','cancelled')),
  operation_date date NOT NULL DEFAULT current_date,
  received_date date NULL,
  order_reference text NULL,
  notes text NULL,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commission_records_amount_required_when_confirmed
    CHECK (status IN ('pending_confirmation','cancelled') OR commission_amount IS NOT NULL),
  CONSTRAINT commission_records_received_date_consistency
    CHECK ((status = 'received' AND received_date IS NOT NULL) OR (status <> 'received' AND received_date IS NULL))
);
CREATE INDEX IF NOT EXISTS commission_records_created_at_idx ON public.commission_records(created_at DESC);
CREATE INDEX IF NOT EXISTS commission_records_catalog_status_date_idx
  ON public.commission_records(catalog_type,status,operation_date DESC);
ALTER TABLE public.commission_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY commission_records_admin_select
  ON public.commission_records FOR SELECT TO authenticated USING (public.is_catalog_admin_user());
CREATE POLICY commission_records_admin_insert
  ON public.commission_records FOR INSERT TO authenticated WITH CHECK (public.is_catalog_admin_user() AND created_by = auth.uid());
CREATE POLICY commission_records_admin_update
  ON public.commission_records FOR UPDATE TO authenticated USING (public.is_catalog_admin_user()) WITH CHECK (public.is_catalog_admin_user());
CREATE POLICY commission_records_admin_delete
  ON public.commission_records FOR DELETE TO authenticated USING (public.is_catalog_admin_user());
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.commission_records TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
