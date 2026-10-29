-- Harden server-only push RPCs and resolve the current performance-advisor findings.
BEGIN;

-- Push dispatch returns encrypted push subscription material, so the browser's anon role
-- must not call these SECURITY DEFINER routines. Supabase Edge Function calls them using
-- the project's server credential after validating the shared dispatch secret.
REVOKE EXECUTE ON FUNCTION public.private_chat_claim_push_delivery(text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.private_chat_finish_push_delivery(text, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.private_chat_claim_push_delivery(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.private_chat_finish_push_delivery(text, uuid, boolean) TO service_role;

-- Cover each foreign key reported by the Supabase performance advisor.
CREATE INDEX IF NOT EXISTS admin_push_subscriptions_user_id_idx
  ON public.admin_push_subscriptions (user_id);
CREATE INDEX IF NOT EXISTS color_library_updated_by_idx
  ON public.color_library (updated_by);
CREATE INDEX IF NOT EXISTS commission_records_product_id_idx
  ON public.commission_records (product_id);
CREATE INDEX IF NOT EXISTS product_provider_review_history_reviewed_by_idx
  ON public.product_provider_review_history (reviewed_by);
CREATE INDEX IF NOT EXISTS product_provider_status_reviewed_by_idx
  ON public.product_provider_status (reviewed_by);
CREATE INDEX IF NOT EXISTS products_updated_by_idx
  ON public.products (updated_by);

-- Wrap stable auth/admin checks as initplans so Postgres can evaluate them once per statement.
DROP POLICY IF EXISTS commission_records_admin_insert ON public.commission_records;
CREATE POLICY commission_records_admin_insert
  ON public.commission_records
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_catalog_admin_user())
    AND created_by = (SELECT auth.uid())
  );

COMMIT;
