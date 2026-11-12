-- JB Collections only. Allow signed-in callers to resolve their own legacy admin UUID.
-- The helper is SECURITY INVOKER and filters by auth.user_id(); it returns at most the caller's own mapped UUID.
BEGIN;
GRANT EXECUTE ON FUNCTION public.current_catalog_admin_legacy_id() TO authenticated;
INSERT INTO public.schema_migrations(version,name)
VALUES ('0004','grant_admin_identity_helper')
ON CONFLICT (version) DO NOTHING;
COMMIT;
