-- Restrict the SECURITY DEFINER cleanup function to a fixed search path.
BEGIN;
ALTER FUNCTION public.cleanup_private_chats()
  SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION public.cleanup_private_chats() FROM PUBLIC, anon, authenticated;
COMMIT;
