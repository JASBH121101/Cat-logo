-- Exclude authenticated catalog-admin activity and permit only admins to reset analytics rows.
-- Resetting these rows does not modify products, variants, prices, or images.
BEGIN;
DROP POLICY IF EXISTS catalog_events_exclude_admin_activity ON public.catalog_events;
CREATE POLICY catalog_events_exclude_admin_activity
  ON public.catalog_events
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (NOT public.is_catalog_admin_user());
DROP POLICY IF EXISTS catalog_events_delete_admin_only ON public.catalog_events;
CREATE POLICY catalog_events_delete_admin_only
  ON public.catalog_events
  FOR DELETE
  TO authenticated
  USING (public.is_catalog_admin_user());
GRANT DELETE ON TABLE public.catalog_events TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
