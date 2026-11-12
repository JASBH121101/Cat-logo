-- Fiverr demo only. Do not apply to main/production.
-- The auth proxy for this Preview authenticates against the separate Neon Auth
-- database "fiverr_auth". Its verified owner identity is therefore the ID below.
-- Migration 0016 accidentally linked admin_users to an older user row from the
-- application database "neondb", which caused the actual owner token to fail
-- confirmAdmin() while guest users continued to work.

BEGIN;

DO $migration$
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

  IF NOT EXISTS (
    SELECT 1
    FROM public.admin_users
    WHERE username = 'JaredBH'
      AND role = 'admin'
      AND is_owner IS TRUE
      AND neon_auth_user_id = '8b8977fd-9e4a-4d41-a738-87805fe39eb0'
  ) THEN
    RAISE EXCEPTION 'Fiverr demo owner Neon Auth identity link was not repaired.';
  END IF;
END
$migration$;

INSERT INTO public.schema_migrations(version, name)
VALUES ('0017', 'fiverr_demo_owner_auth_identity')
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
