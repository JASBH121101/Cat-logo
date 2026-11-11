-- Fiverr demo only: owner-managed granular permissions for the demo account.
-- Apply only to Neon branch fiverr-demo.
BEGIN;

ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS is_owner boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{}'::jsonb;

-- The isolated demo branch currently contains one pre-existing administrator
-- record. Preserve it and designate that record as the owner for the later
-- JaredBH auth-identity link.
UPDATE public.admin_users
SET is_owner = true
WHERE role = 'admin'
  AND NOT EXISTS (SELECT 1 FROM public.admin_users WHERE is_owner IS TRUE)
  AND (SELECT count(*) FROM public.admin_users WHERE role = 'admin') = 1;

CREATE OR REPLACE FUNCTION public.is_catalog_owner_user()
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
      AND au.is_owner IS TRUE
  )
$function$;

REVOKE ALL ON FUNCTION public.is_catalog_owner_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_catalog_owner_user() FROM anonymous;
GRANT EXECUTE ON FUNCTION public.is_catalog_owner_user() TO authenticated;

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
        au.role = 'admin'
        OR (
          jsonb_typeof(au.permissions) = 'object'
          AND au.permissions ->> permission_key = 'true'
        )
      )
  )
$function$;

REVOKE ALL ON FUNCTION public.catalog_has_permission(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.catalog_has_permission(text) FROM anonymous;
GRANT EXECUTE ON FUNCTION public.catalog_has_permission(text) TO authenticated;

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
    'username', (
      SELECT au.username FROM public.admin_users AS au
      WHERE au.neon_auth_user_id = public.current_neon_auth_user_id()
      LIMIT 1
    ),
    'is_owner', EXISTS (
      SELECT 1 FROM public.admin_users AS au
      WHERE au.neon_auth_user_id = public.current_neon_auth_user_id()
        AND au.role = 'admin'
        AND au.is_owner IS TRUE
    ),
    'permissions', coalesce((
      SELECT au.permissions FROM public.admin_users AS au
      WHERE au.neon_auth_user_id = public.current_neon_auth_user_id()
      LIMIT 1
    ), '{}'::jsonb),
    'is_demo_viewer', EXISTS (
      SELECT 1 FROM public.admin_users AS au
      WHERE au.neon_auth_user_id = public.current_neon_auth_user_id()
        AND au.role = 'demo_viewer'
    )
  )
$function$;

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
  demo_user public.admin_users%ROWTYPE;
  suggested_username text;
BEGIN
  IF current_auth_id IS NULL OR length(btrim(current_auth_id)) = 0 THEN
    RAISE EXCEPTION 'Se requiere una sesión válida.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('jb-collections-fiverr-demo-identity'));

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

  -- The owner account is provisioned privately in Neon Auth; it is never
  -- self-registered from the public demo login screen.
  IF current_email = 'jaredbh@jb-collections.invalid' THEN
    UPDATE public.admin_users
    SET neon_auth_user_id = current_auth_id,
        username = 'JaredBH',
        is_owner = true
    WHERE role = 'admin'
      AND is_owner IS TRUE
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

    RAISE EXCEPTION 'No se encontró el registro de propietario reservado para JaredBH.';
  END IF;

  IF current_email !~ '^[a-z0-9][a-z0-9._-]{2,29}@jb-collections[.]invalid$' THEN
    RAISE EXCEPTION 'La cuenta no usa un identificador interno válido para JB Collections.';
  END IF;

  SELECT * INTO demo_user
  FROM public.admin_users
  WHERE role = 'demo_viewer'
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'La cuenta de demostración ya está asignada. El propietario debe administrar ese acceso.';
  END IF;

  suggested_username := split_part(current_email, '@', 1);

  INSERT INTO public.admin_users (user_id, neon_auth_user_id, role, username, is_owner, permissions)
  VALUES (gen_random_uuid(), current_auth_id, 'demo_viewer', suggested_username, false, '{}'::jsonb)
  RETURNING * INTO demo_user;

  RETURN jsonb_build_object(
    'user_id', demo_user.user_id,
    'role', demo_user.role,
    'username', demo_user.username,
    'is_owner', false,
    'permissions', demo_user.permissions
  );
END
$function$;

REVOKE ALL ON FUNCTION public.register_fiverr_demo_identity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_fiverr_demo_identity() FROM anonymous;
GRANT EXECUTE ON FUNCTION public.register_fiverr_demo_identity() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_fiverr_demo_team()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE result jsonb;
BEGIN
  IF NOT public.is_catalog_owner_user() THEN
    RAISE EXCEPTION 'Solo el propietario puede administrar los permisos del equipo.';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'user_id', au.user_id,
    'username', coalesce(au.username, 'Usuario'),
    'role', au.role,
    'is_owner', au.is_owner,
    'permissions', au.permissions,
    'created_at', au.created_at
  ) ORDER BY au.created_at), '[]'::jsonb)
  INTO result
  FROM public.admin_users AS au
  WHERE au.role = 'demo_viewer' OR au.is_owner IS TRUE;

  RETURN result;
END
$function$;

REVOKE ALL ON FUNCTION public.list_fiverr_demo_team() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_fiverr_demo_team() FROM anonymous;
GRANT EXECUTE ON FUNCTION public.list_fiverr_demo_team() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_fiverr_demo_user_permissions(
  target_user_id uuid,
  requested_permissions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  saved_user public.admin_users%ROWTYPE;
  allowed_keys text[] := ARRAY[
    'catalog.view_all',
    'products.create',
    'products.edit',
    'products.delete',
    'products.publish'
  ];
  normalized_permissions jsonb;
BEGIN
  IF NOT public.is_catalog_owner_user() THEN
    RAISE EXCEPTION 'Solo el propietario puede modificar permisos.';
  END IF;

  IF requested_permissions IS NULL OR jsonb_typeof(requested_permissions) <> 'object' THEN
    RAISE EXCEPTION 'Los permisos deben enviarse como un objeto JSON.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_each(requested_permissions) AS permission(key, value)
    WHERE NOT (permission.key = ANY(allowed_keys))
       OR jsonb_typeof(permission.value) <> 'boolean'
  ) THEN
    RAISE EXCEPTION 'La solicitud contiene permisos desconocidos o valores no booleanos.';
  END IF;

  SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  INTO normalized_permissions
  FROM jsonb_each(requested_permissions);

  UPDATE public.admin_users
  SET permissions = normalized_permissions
  WHERE user_id = target_user_id
    AND role = 'demo_viewer'
    AND is_owner IS FALSE
  RETURNING * INTO saved_user;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró una cuenta demo_viewer administrable.';
  END IF;

  RETURN jsonb_build_object(
    'user_id', saved_user.user_id,
    'username', saved_user.username,
    'permissions', saved_user.permissions
  );
END
$function$;

REVOKE ALL ON FUNCTION public.set_fiverr_demo_user_permissions(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_fiverr_demo_user_permissions(uuid, jsonb) FROM anonymous;
GRANT EXECUTE ON FUNCTION public.set_fiverr_demo_user_permissions(uuid, jsonb) TO authenticated;

-- A demo user sees published catalog rows by default (existing public policy).
-- This additional policy unlocks the rest of the inventory only when granted.
CREATE POLICY products_permission_view_all
  ON public.products FOR SELECT TO authenticated
  USING (public.catalog_has_permission('catalog.view_all'));

CREATE POLICY products_permission_insert
  ON public.products FOR INSERT TO authenticated
  WITH CHECK (public.catalog_has_permission('products.create'));

CREATE POLICY products_permission_update
  ON public.products FOR UPDATE TO authenticated
  USING (public.catalog_has_permission('products.edit'))
  WITH CHECK (public.catalog_has_permission('products.edit'));

CREATE POLICY products_permission_delete
  ON public.products FOR DELETE TO authenticated
  USING (public.catalog_has_permission('products.delete'));

CREATE POLICY perfume_details_permission_view_all
  ON public.perfume_details FOR SELECT TO authenticated
  USING (
    public.catalog_has_permission('catalog.view_all')
    AND EXISTS (
      SELECT 1 FROM public.products AS p
      WHERE p.id = perfume_details.product_id
    )
  );

CREATE POLICY perfume_details_permission_insert
  ON public.perfume_details FOR INSERT TO authenticated
  WITH CHECK (
    public.catalog_has_permission('products.create')
    AND EXISTS (
      SELECT 1 FROM public.products AS p
      WHERE p.id = perfume_details.product_id
    )
  );

CREATE POLICY perfume_details_permission_update
  ON public.perfume_details FOR UPDATE TO authenticated
  USING (
    public.catalog_has_permission('products.edit')
    AND EXISTS (
      SELECT 1 FROM public.products AS p
      WHERE p.id = perfume_details.product_id
    )
  )
  WITH CHECK (
    public.catalog_has_permission('products.edit')
    AND EXISTS (
      SELECT 1 FROM public.products AS p
      WHERE p.id = perfume_details.product_id
    )
  );

CREATE POLICY perfume_details_permission_delete
  ON public.perfume_details FOR DELETE TO authenticated
  USING (
    public.catalog_has_permission('products.delete')
    AND EXISTS (
      SELECT 1 FROM public.products AS p
      WHERE p.id = perfume_details.product_id
    )
  );

CREATE OR REPLACE FUNCTION public.enforce_catalog_publish_permission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (NEW.is_published IS TRUE OR NEW.workflow_status = 'published')
       AND NOT public.catalog_has_permission('products.publish') THEN
      RAISE EXCEPTION 'No tenés permiso para publicar productos.';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF (
      OLD.is_published IS DISTINCT FROM NEW.is_published
      OR OLD.workflow_status IS DISTINCT FROM NEW.workflow_status
    ) AND NOT public.catalog_has_permission('products.publish') THEN
      RAISE EXCEPTION 'No tenés permiso para cambiar el estado de publicación.';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER products_enforce_publish_permission
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_catalog_publish_permission();

INSERT INTO public.schema_migrations(version, name)
VALUES ('0011', 'fiverr_demo_granular_permissions')
ON CONFLICT (version) DO NOTHING;

COMMIT;