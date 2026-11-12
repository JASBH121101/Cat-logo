-- Fiverr demo only: repair the owner identity link and add a private access-help inbox.
-- Apply only to the isolated Neon branch fiverr-demo; never run against production.

BEGIN;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM neon_auth."user"
    WHERE id = '8889c812-8c63-4ce2-b9ee-fde676b85031'::uuid
      AND "emailVerified" IS TRUE
  ) THEN
    RAISE EXCEPTION 'The expected verified Fiverr demo owner identity is missing; refusing to relink admin_users.';
  END IF;

  UPDATE public.admin_users
  SET neon_auth_user_id = '8889c812-8c63-4ce2-b9ee-fde676b85031'
  WHERE username = 'JaredBH'
    AND role = 'admin'
    AND is_owner IS TRUE;

  IF NOT EXISTS (
    SELECT 1
    FROM public.admin_users
    WHERE username = 'JaredBH'
      AND role = 'admin'
      AND is_owner IS TRUE
      AND neon_auth_user_id = '8889c812-8c63-4ce2-b9ee-fde676b85031'
  ) THEN
    RAISE EXCEPTION 'The Fiverr demo owner identity link could not be repaired.';
  END IF;
END
$migration$;

CREATE TABLE IF NOT EXISTS private.admin_login_help_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reported_username text NOT NULL CHECK (char_length(reported_username) BETWEEN 1 AND 254),
  issue_type text NOT NULL CHECK (issue_type IN ('username','password','credentials','other')),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.admin_users(user_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS admin_login_help_requests_inbox_idx
  ON private.admin_login_help_requests (created_at DESC)
  WHERE status = 'new';

CREATE INDEX IF NOT EXISTS admin_login_help_requests_username_recent_idx
  ON private.admin_login_help_requests (lower(reported_username), created_at DESC);

REVOKE ALL ON TABLE private.admin_login_help_requests FROM PUBLIC, anonymous, authenticated;

CREATE OR REPLACE FUNCTION public.submit_admin_login_help_request(
  p_username text,
  p_issue_type text,
  p_honeypot text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $function$
DECLARE
  v_username text;
  v_issue_type text := lower(btrim(coalesce(p_issue_type, '')));
  v_request_id uuid;
  v_recent_for_user integer;
  v_recent_global integer;
BEGIN
  -- Quietly accept automated honeypot submissions without persisting them.
  IF nullif(btrim(coalesce(p_honeypot, '')), '') IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  v_username := left(
    btrim(regexp_replace(coalesce(p_username, ''), '[[:cntrl:]]', '', 'g')),
    254
  );
  IF v_username = '' THEN
    v_username := '(no recuerda el usuario)';
  END IF;

  IF v_issue_type NOT IN ('username','password','credentials','other') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_access_help_issue';
  END IF;

  SELECT count(*)::integer INTO v_recent_global
  FROM private.admin_login_help_requests
  WHERE created_at > now() - interval '10 minutes';

  IF v_recent_global >= 50 THEN
    RETURN jsonb_build_object('ok', true, 'rate_limited', true);
  END IF;

  SELECT count(*)::integer INTO v_recent_for_user
  FROM private.admin_login_help_requests
  WHERE lower(reported_username) = lower(v_username)
    AND created_at > now() - interval '15 minutes';

  IF v_recent_for_user >= 3 OR EXISTS (
    SELECT 1
    FROM private.admin_login_help_requests
    WHERE lower(reported_username) = lower(v_username)
      AND issue_type = v_issue_type
      AND status = 'new'
      AND created_at > now() - interval '3 minutes'
  ) THEN
    RETURN jsonb_build_object('ok', true, 'rate_limited', true);
  END IF;

  INSERT INTO private.admin_login_help_requests (reported_username, issue_type)
  VALUES (v_username, v_issue_type)
  RETURNING id INTO v_request_id;

  RETURN jsonb_build_object('ok', true, 'request_id', v_request_id);
END
$function$;

REVOKE ALL ON FUNCTION public.submit_admin_login_help_request(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_admin_login_help_request(text, text, text) TO anonymous, authenticated;

CREATE OR REPLACE FUNCTION public.list_admin_login_help_requests(
  p_include_resolved boolean DEFAULT false
)
RETURNS TABLE (
  request_id uuid,
  reported_username text,
  issue_type text,
  created_at timestamptz,
  status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth, pg_temp
AS $function$
BEGIN
  IF NOT public.is_catalog_owner_user() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'owner_access_required';
  END IF;

  RETURN QUERY
  SELECT r.id, r.reported_username, r.issue_type, r.created_at, r.status
  FROM private.admin_login_help_requests AS r
  WHERE p_include_resolved IS TRUE OR r.status = 'new'
  ORDER BY r.created_at DESC
  LIMIT 100;
END
$function$;

REVOKE ALL ON FUNCTION public.list_admin_login_help_requests(boolean) FROM PUBLIC, anonymous;
GRANT EXECUTE ON FUNCTION public.list_admin_login_help_requests(boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_admin_login_help_request(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth, pg_temp
AS $function$
DECLARE
  v_request_id uuid;
  v_admin_id uuid;
BEGIN
  IF NOT public.is_catalog_owner_user() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'owner_access_required';
  END IF;

  SELECT au.user_id INTO v_admin_id
  FROM public.admin_users AS au
  WHERE au.neon_auth_user_id = auth.user_id()
    AND au.role = 'admin'
    AND au.is_owner IS TRUE
  LIMIT 1;

  UPDATE private.admin_login_help_requests
  SET status = 'resolved',
      resolved_at = now(),
      resolved_by = v_admin_id
  WHERE id = p_request_id
    AND status = 'new'
  RETURNING id INTO v_request_id;

  IF v_request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found_or_already_resolved');
  END IF;

  RETURN jsonb_build_object('ok', true, 'request_id', v_request_id);
END
$function$;

REVOKE ALL ON FUNCTION public.resolve_admin_login_help_request(uuid) FROM PUBLIC, anonymous;
GRANT EXECUTE ON FUNCTION public.resolve_admin_login_help_request(uuid) TO authenticated;

INSERT INTO public.schema_migrations(version, name)
VALUES ('0016', 'admin_login_help_requests')
ON CONFLICT (version) DO NOTHING;

COMMIT;
