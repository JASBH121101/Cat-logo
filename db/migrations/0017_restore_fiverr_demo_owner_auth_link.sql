-- Fiverr demo only: link the owner to the identity used by this branch's
-- active Neon Auth integration. Never apply this migration to Production.
--
-- IMPORTANT: this Pages Preview authenticates against Neon Auth database
-- "fiverr_auth", not the older neon_auth.user mirror in "neondb".
-- The owner identity below was verified directly in fiverr_auth.neon_auth.user
-- and neon_auth.account (credential provider, verified email, active session).
-- Do not replace it with the similarly addressed user ID in neondb.

BEGIN;

DO $migration$
DECLARE
  affected_rows integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.admin_users
    WHERE username = 'JaredBH'
      AND role = 'admin'
      AND is_owner IS TRUE
  ) THEN
    RAISE EXCEPTION 'Fiverr demo owner admin_users record is missing; refusing to relink.';
  END IF;

  UPDATE public.admin_users
  SET neon_auth_user_id = '8b8977fd-9e4a-4d41-a738-87805fe39eb0'
  WHERE username = 'JaredBH'
    AND role = 'admin'
    AND is_owner IS TRUE;

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RAISE EXCEPTION 'Expected to repair exactly one owner mapping; updated % rows.', affected_rows;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.admin_users
    WHERE username = 'JaredBH'
      AND role = 'admin'
      AND is_owner IS TRUE
      AND neon_auth_user_id = '8b8977fd-9e4a-4d41-a738-87805fe39eb0'
  ) THEN
    RAISE EXCEPTION 'Fiverr demo owner auth identity link verification failed.';
  END IF;
END
$migration$;

INSERT INTO public.schema_migrations(version, name)
VALUES ('0017', 'restore_fiverr_demo_owner_auth_link')
ON CONFLICT (version) DO UPDATE
SET name = EXCLUDED.name;

NOTIFY pgrst, 'reload schema';

COMMIT;
