-- Fiverr demo only: disable any self-registration path.
-- New invited accounts must be provisioned by the authenticated owner endpoint.
BEGIN;

CREATE OR REPLACE FUNCTION public.register_fiverr_demo_identity()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  current_auth_id text := public.current_neon_auth_user_id();
  current_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  existing_user public.admin_users%ROWTYPE;
  linked_owner public.admin_users%ROWTYPE;
BEGIN
  IF current_auth_id IS NULL OR length(btrim(current_auth_id)) = 0 THEN
    RAISE EXCEPTION 'Se requiere una sesión válida.';
  END IF;

  SELECT * INTO existing_user
  FROM public.admin_users
  WHERE neon_auth_user_id = current_auth_id
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'user_id', existing_user.user_id,
      'role', existing_user.role,
      'username', existing_user.username,
      'is_owner', existing_user.is_owner,
      'permissions', existing_user.permissions
    );
  END IF;

  -- Preserve the owner recovery path, but never self-register guest identities.
  IF current_email = 'jaredblancoh19@gmail.com' THEN
    UPDATE public.admin_users
    SET neon_auth_user_id = current_auth_id,
        username = 'JaredBH',
        is_owner = true
    WHERE role = 'admin'
      AND is_owner IS TRUE
      AND (neon_auth_user_id IS NULL OR neon_auth_user_id = current_auth_id)
    RETURNING * INTO linked_owner;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'user_id', linked_owner.user_id,
        'role', linked_owner.role,
        'username', linked_owner.username,
        'is_owner', true,
        'permissions', linked_owner.permissions
      );
    END IF;
  END IF;

  RAISE EXCEPTION 'Cuenta no autorizada. El propietario debe crear y vincular las cuentas invitadas desde el panel.';
END
$function$;

REVOKE ALL ON FUNCTION public.register_fiverr_demo_identity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_fiverr_demo_identity() FROM anonymous;
GRANT EXECUTE ON FUNCTION public.register_fiverr_demo_identity() TO authenticated;

INSERT INTO public.schema_migrations(version, name)
VALUES ('0013', 'fiverr_demo_disable_guest_self_registration')
ON CONFLICT (version) DO NOTHING;

COMMIT;
