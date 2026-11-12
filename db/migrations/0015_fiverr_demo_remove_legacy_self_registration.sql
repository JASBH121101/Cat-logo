-- Fiverr demo only: permanently close the legacy self-registration RPC.
-- The owner must provision every invited identity through /api/admin/guests.
BEGIN;

REVOKE ALL ON FUNCTION public.register_fiverr_demo_viewer() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_fiverr_demo_viewer() FROM anonymous;
REVOKE ALL ON FUNCTION public.register_fiverr_demo_viewer() FROM authenticated;
DROP FUNCTION IF EXISTS public.register_fiverr_demo_viewer();

INSERT INTO public.schema_migrations(version, name)
VALUES ('0015', 'fiverr_demo_remove_legacy_self_registration')
ON CONFLICT (version) DO NOTHING;

COMMIT;
