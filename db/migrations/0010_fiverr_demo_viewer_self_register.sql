-- Fiverr demo branch only. A verified, pre-created Neon Auth user may
-- claim the single demo_viewer slot after successful sign-in. Public sign-up
-- remains disabled in Neon Auth; users must be created by the owner.
BEGIN;

CREATE OR REPLACE FUNCTION public.register_fiverr_demo_viewer()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  current_auth_id text := public.current_neon_auth_user_id();
  existing_user public.admin_users%ROWTYPE;
  demo_owner public.admin_users%ROWTYPE;
BEGIN
  IF current_auth_id IS NULL OR length(btrim(current_auth_id)) = 0 THEN
    RAISE EXCEPTION 'Se requiere una sesión válida.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('jb-collections-fiverr-demo-viewer'));

  SELECT * INTO existing_user
  FROM public.admin_users
  WHERE neon_auth_user_id = current_auth_id
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object('user_id', existing_user.user_id, 'role', existing_user.role);
  END IF;

  SELECT * INTO demo_owner
  FROM public.admin_users
  WHERE role = 'demo_viewer'
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'La cuenta de demostración ya fue asignada. El propietario debe revocar el acceso anterior antes de crear otro.';
  END IF;

  INSERT INTO public.admin_users (user_id, neon_auth_user_id, role)
  VALUES (gen_random_uuid(), current_auth_id, 'demo_viewer')
  RETURNING * INTO existing_user;

  RETURN jsonb_build_object('user_id', existing_user.user_id, 'role', existing_user.role);
END
$function$;

REVOKE ALL ON FUNCTION public.register_fiverr_demo_viewer() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_fiverr_demo_viewer() FROM anonymous;
GRANT EXECUTE ON FUNCTION public.register_fiverr_demo_viewer() TO authenticated;

INSERT INTO public.schema_migrations(version, name)
VALUES ('0010', 'fiverr_demo_viewer_self_register')
ON CONFLICT (version) DO NOTHING;

COMMIT;
