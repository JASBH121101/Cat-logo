-- JB Collections isolated migration branch only.
-- Map the existing authorized catalog owner to the newly provisioned Neon Auth identity.
BEGIN;
UPDATE public.admin_users
SET neon_auth_user_id = '8889c812-8c63-4ce2-b9ee-fde676b85031'
WHERE user_id = '8812b069-89e8-412d-8a68-65539be97848'
  AND neon_auth_user_id IS NULL;
INSERT INTO public.schema_migrations(version,name)
VALUES ('0007','map_existing_admin_to_neon_auth')
ON CONFLICT (version) DO NOTHING;
COMMIT;
