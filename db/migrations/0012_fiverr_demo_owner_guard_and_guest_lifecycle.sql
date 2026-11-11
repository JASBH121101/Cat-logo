-- Fiverr demo only: enforce owner-only admin context and safe guest lifecycle.
-- Apply only to Neon branch fiverr-demo (never production).
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS admin_users_username_lower_unique
  ON public.admin_users (lower(username))
  WHERE username IS NOT NULL;

CREATE OR REPLACE FUNCTION public.is_catalog_admin_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT public.is_catalog_owner_user()
$function$;

REVOKE ALL ON FUNCTION public.is_catalog_admin_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_catalog_admin_user() FROM anonymous;
GRANT EXECUTE ON FUNCTION public.is_catalog_admin_user() TO authenticated;

CREATE OR REPLACE FUNCTION public.catalog_has_permission(permission_key text)
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
      AND (
        (au.role = 'admin' AND au.is_owner IS TRUE)
        OR (
          au.role = 'demo_viewer'
          AND au.is_owner IS FALSE
          AND jsonb_typeof(au.permissions) = 'object'
          AND au.permissions ->> permission_key = 'true'
        )
      )
  )
$function$;

REVOKE ALL ON FUNCTION public.catalog_has_permission(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.catalog_has_permission(text) FROM anonymous;
GRANT EXECUTE ON FUNCTION public.catalog_has_permission(text) TO authenticated;

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
    AND au.is_owner IS TRUE
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.catalog_admin_context()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT jsonb_build_object(
    'is_admin', public.is_catalog_owner_user(),
    'admin_id', (
      SELECT au.user_id FROM public.admin_users AS au
      WHERE au.neon_auth_user_id = public.current_neon_auth_user_id()
        AND au.role = 'admin'
        AND au.is_owner IS TRUE
      LIMIT 1
    ),
    'role', (
      SELECT au.role FROM public.admin_users AS au
      WHERE au.neon_auth_user_id = public.current_neon_auth_user_id()
      LIMIT 1
    ),
    'username', (
      SELECT au.username FROM public.admin_users AS au
      WHERE au.neon_auth_user_id = public.current_neon_auth_user_id()
      LIMIT 1
    ),
    'is_owner', public.is_catalog_owner_user(),
    'permissions', coalesce((
      SELECT au.permissions FROM public.admin_users AS au
      WHERE au.neon_auth_user_id = public.current_neon_auth_user_id()
      LIMIT 1
    ), '{}'::jsonb),
    'is_demo_viewer', EXISTS (
      SELECT 1 FROM public.admin_users AS au
      WHERE au.neon_auth_user_id = public.current_neon_auth_user_id()
        AND au.role = 'demo_viewer'
        AND au.is_owner IS FALSE
    )
  )
$function$;

CREATE OR REPLACE FUNCTION public.link_fiverr_demo_guest(
  target_auth_user_id text,
  requested_username text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  normalized_username text := lower(btrim(coalesce(requested_username, '')));
  linked_user public.admin_users%ROWTYPE;
BEGIN
  IF NOT public.is_catalog_owner_user() THEN
    RAISE EXCEPTION 'Solo el propietario puede crear cuentas de demostración.';
  END IF;

  IF target_auth_user_id IS NULL OR length(btrim(target_auth_user_id)) < 8 OR length(btrim(target_auth_user_id)) > 128 THEN
    RAISE EXCEPTION 'La identidad de autenticación no es válida.';
  END IF;

  IF normalized_username !~ '^[a-z0-9][a-z0-9._-]{2,29}$' OR normalized_username = 'jaredbh' THEN
    RAISE EXCEPTION 'El usuario debe tener entre 3 y 30 caracteres válidos y no puede usar el usuario del propietario.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.admin_users WHERE lower(username) = normalized_username) THEN
    RAISE EXCEPTION 'Ese nombre de usuario ya está ocupado.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.admin_users WHERE neon_auth_user_id = target_auth_user_id) THEN
    RAISE EXCEPTION 'Esa identidad de Neon Auth ya está vinculada.';
  END IF;

  INSERT INTO public.admin_users (
    user_id, neon_auth_user_id, role, username, is_owner, permissions
  )
  VALUES (
    gen_random_uuid(), btrim(target_auth_user_id), 'demo_viewer',
    normalized_username, false, '{}'::jsonb
  )
  RETURNING * INTO linked_user;

  RETURN jsonb_build_object(
    'user_id', linked_user.user_id,
    'username', linked_user.username,
    'role', linked_user.role,
    'is_owner', linked_user.is_owner,
    'permissions', linked_user.permissions
  );
END
$function$;

REVOKE ALL ON FUNCTION public.link_fiverr_demo_guest(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.link_fiverr_demo_guest(text, text) FROM anonymous;
GRANT EXECUTE ON FUNCTION public.link_fiverr_demo_guest(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_fiverr_demo_guest(target_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  removed_user public.admin_users%ROWTYPE;
BEGIN
  IF NOT public.is_catalog_owner_user() THEN
    RAISE EXCEPTION 'Solo el propietario puede revocar cuentas de demostración.';
  END IF;

  DELETE FROM public.admin_users
  WHERE user_id = target_user_id
    AND role = 'demo_viewer'
    AND is_owner IS FALSE
  RETURNING * INTO removed_user;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró una cuenta invitada que se pueda revocar.';
  END IF;

  RETURN jsonb_build_object(
    'user_id', removed_user.user_id,
    'username', removed_user.username,
    'revoked', true
  );
END
$function$;

REVOKE ALL ON FUNCTION public.revoke_fiverr_demo_guest(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_fiverr_demo_guest(uuid) FROM anonymous;
GRANT EXECUTE ON FUNCTION public.revoke_fiverr_demo_guest(uuid) TO authenticated;

INSERT INTO public.schema_migrations(version, name)
VALUES ('0012', 'fiverr_demo_owner_guard_and_guest_lifecycle')
ON CONFLICT (version) DO NOTHING;

COMMIT;
