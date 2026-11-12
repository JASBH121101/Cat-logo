-- Fiverr demo only: restore the owner row to the verified Neon Auth identity.
-- The admin_users row had drifted to an auth id that no longer exists.
-- Apply only to Neon branch fiverr-demo; never run against Production.

BEGIN;

DO $migration$
DECLARE
  affected_rows integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM neon_auth."user"
    WHERE id = '8889c812-8c63-4ce2-b9ee-fde676b85031'::uuid
      AND "emailVerified" IS TRUE
  ) THEN
    RAISE EXCEPTION 'The expected verified demo-owner Auth identity is missing; refusing to relink.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM neon_auth.account
    WHERE "userId" = '8889c812-8c63-4ce2-b9ee-fde676b85031'::uuid
      AND "providerId" = 'credential'
      AND password IS NOT NULL
      AND length(password) > 0
  ) THEN
    RAISE EXCEPTION 'The expected owner credential record is missing; refusing to relink.';
  END IF;

  UPDATE public.admin_users
  SET neon_auth_user_id = '8889c812-8c63-4ce2-b9ee-fde676b85031'
  WHERE username = 'JaredBH'
    AND role = 'admin'
    AND is_owner IS TRUE;

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RAISE EXCEPTION 'Expected to repair exactly one owner mapping; updated % rows.', affected_rows;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.admin_users au
    JOIN neon_auth."user" nu ON nu.id::text = au.neon_auth_user_id
    WHERE au.username = 'JaredBH'
      AND au.role = 'admin'
      AND au.is_owner IS TRUE
      AND nu.id = '8889c812-8c63-4ce2-b9ee-fde676b85031'::uuid
      AND nu."emailVerified" IS TRUE
  ) THEN
    RAISE EXCEPTION 'Owner auth identity link verification failed.';
  END IF;
END
$migration$;

INSERT INTO public.schema_migrations(version, name)
VALUES ('0017', 'restore_fiverr_demo_owner_auth_link')
ON CONFLICT (version) DO NOTHING;

COMMIT;
