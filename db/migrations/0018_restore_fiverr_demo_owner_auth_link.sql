-- Fiverr demo only: restore the owner link to the identity in the separate fiverr_auth database.
-- Verified against fiverr_auth.neon_auth.user and fiverr_auth.neon_auth.account:
-- this identity is verified and has a credential password.
-- Apply only to the neondb database on Neon branch fiverr-demo.

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
    RAISE EXCEPTION 'The reserved Fiverr demo owner row is missing; refusing to relink.';
  END IF;

  UPDATE public.admin_users
  SET neon_auth_user_id = '8b8977fd-9e4a-4d41-a738-87805fe39eb0'
  WHERE username = 'JaredBH'
    AND role = 'admin'
    AND is_owner IS TRUE;

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one demo owner row; updated % rows.', affected_rows;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.admin_users
    WHERE username = 'JaredBH'
      AND role = 'admin'
      AND is_owner IS TRUE
      AND neon_auth_user_id = '8b8977fd-9e4a-4d41-a738-87805fe39eb0'
  ) THEN
    RAISE EXCEPTION 'Fiverr demo owner identity link verification failed.';
  END IF;
END
$migration$;

INSERT INTO public.schema_migrations(version, name)
VALUES ('0018', 'restore_fiverr_demo_owner_auth_link')
ON CONFLICT (version) DO NOTHING;

COMMIT;
