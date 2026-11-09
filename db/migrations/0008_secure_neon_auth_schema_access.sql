-- JB Collections: isolate Neon-managed auth schema access behind controlled helpers.
-- Applies only to the migration-neon-r2 branch.
-- The auth schema is owned by Neon cloud_admin, so app roles cannot receive USAGE.
-- neondb_owner can execute auth.user_id(); SECURITY DEFINER keeps that access server-side.

BEGIN;

CREATE OR REPLACE FUNCTION public.current_neon_auth_user_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT auth.user_id()
$function$;

REVOKE ALL ON FUNCTION public.current_neon_auth_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_neon_auth_user_id() FROM anonymous;
GRANT EXECUTE ON FUNCTION public.current_neon_auth_user_id() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_catalog_admin_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_users AS au
    WHERE au.neon_auth_user_id = public.current_neon_auth_user_id()
  );
$function$;

REVOKE ALL ON FUNCTION public.is_catalog_admin_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_catalog_admin_user() FROM anonymous;
GRANT EXECUTE ON FUNCTION public.is_catalog_admin_user() TO authenticated;


-- Keep the legacy-UUID resolver invoker-scoped, but route identity lookup
-- through the controlled SECURITY DEFINER helper above.
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
  LIMIT 1
$function$;

REVOKE ALL ON FUNCTION public.current_catalog_admin_legacy_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_catalog_admin_legacy_id() FROM anonymous;
GRANT EXECUTE ON FUNCTION public.current_catalog_admin_legacy_id() TO authenticated;

DROP POLICY IF EXISTS admin_users_select_self ON public.admin_users;
CREATE POLICY admin_users_select_self ON public.admin_users
  FOR SELECT TO authenticated
  USING (neon_auth_user_id = public.current_neon_auth_user_id());

DROP POLICY IF EXISTS color_library_admin_insert ON public.color_library;
CREATE POLICY color_library_admin_insert ON public.color_library
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_catalog_admin_user()
    AND updated_by = (
      SELECT au.user_id
      FROM public.admin_users AS au
      WHERE au.neon_auth_user_id = public.current_neon_auth_user_id()
      LIMIT 1
    )
  );

DROP POLICY IF EXISTS color_library_admin_update ON public.color_library;
CREATE POLICY color_library_admin_update ON public.color_library
  FOR UPDATE TO authenticated
  USING (public.is_catalog_admin_user())
  WITH CHECK (
    public.is_catalog_admin_user()
    AND updated_by = (
      SELECT au.user_id
      FROM public.admin_users AS au
      WHERE au.neon_auth_user_id = public.current_neon_auth_user_id()
      LIMIT 1
    )
  );

DROP POLICY IF EXISTS commission_records_admin_insert ON public.commission_records;
CREATE POLICY commission_records_admin_insert ON public.commission_records
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_catalog_admin_user()
    AND created_by = (
      SELECT au.user_id
      FROM public.admin_users AS au
      WHERE au.neon_auth_user_id = public.current_neon_auth_user_id()
      LIMIT 1
    )
  );

DROP POLICY IF EXISTS admin_push_subscriptions_admin_manage ON public.admin_push_subscriptions;
CREATE POLICY admin_push_subscriptions_admin_manage ON public.admin_push_subscriptions
  FOR ALL TO authenticated
  USING (
    public.is_catalog_admin_user()
    AND user_id = (
      SELECT au.user_id
      FROM public.admin_users AS au
      WHERE au.neon_auth_user_id = public.current_neon_auth_user_id()
      LIMIT 1
    )
  )
  WITH CHECK (
    public.is_catalog_admin_user()
    AND user_id = (
      SELECT au.user_id
      FROM public.admin_users AS au
      WHERE au.neon_auth_user_id = public.current_neon_auth_user_id()
      LIMIT 1
    )
  );

INSERT INTO public.schema_migrations(version, name)
VALUES ('0008', 'secure_neon_auth_schema_access')
ON CONFLICT (version) DO NOTHING;

COMMIT;
