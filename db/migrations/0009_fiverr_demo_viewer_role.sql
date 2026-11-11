-- Fiverr demo branch only. Adds a read-only demo role without granting
-- administrative permissions. Apply only to the isolated fiverr-demo branch.
BEGIN;

ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'admin';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.admin_users'::regclass
      AND conname = 'admin_users_role_check'
  ) THEN
    ALTER TABLE public.admin_users
      ADD CONSTRAINT admin_users_role_check
      CHECK (role IN ('admin', 'demo_viewer'));
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.is_catalog_admin_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_users AS au
    WHERE au.neon_auth_user_id = public.current_neon_auth_user_id()
      AND au.role = 'admin'
  )
$function$;

REVOKE ALL ON FUNCTION public.is_catalog_admin_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_catalog_admin_user() FROM anonymous;
GRANT EXECUTE ON FUNCTION public.is_catalog_admin_user() TO authenticated;

CREATE OR REPLACE FUNCTION public.catalog_admin_context()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT jsonb_build_object(
    'is_admin', EXISTS (
      SELECT 1 FROM public.admin_users AS au
      WHERE au.neon_auth_user_id = public.current_neon_auth_user_id()
        AND au.role = 'admin'
    ),
    'admin_id', (
      SELECT au.user_id FROM public.admin_users AS au
      WHERE au.neon_auth_user_id = public.current_neon_auth_user_id()
        AND au.role = 'admin'
      LIMIT 1
    ),
    'role', (
      SELECT au.role FROM public.admin_users AS au
      WHERE au.neon_auth_user_id = public.current_neon_auth_user_id()
      LIMIT 1
    ),
    'is_demo_viewer', EXISTS (
      SELECT 1 FROM public.admin_users AS au
      WHERE au.neon_auth_user_id = public.current_neon_auth_user_id()
        AND au.role = 'demo_viewer'
    )
  )
$function$;

REVOKE ALL ON FUNCTION public.catalog_admin_context() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.catalog_admin_context() FROM anonymous;
GRANT EXECUTE ON FUNCTION public.catalog_admin_context() TO authenticated;

CREATE OR REPLACE FUNCTION public.current_catalog_admin_legacy_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
  SELECT au.user_id
  FROM public.admin_users AS au
  WHERE au.neon_auth_user_id = public.current_neon_auth_user_id()
    AND au.role = 'admin'
  LIMIT 1
$function$;

INSERT INTO public.schema_migrations(version, name)
VALUES ('0009', 'fiverr_demo_viewer_role')
ON CONFLICT (version) DO NOTHING;

COMMIT;
