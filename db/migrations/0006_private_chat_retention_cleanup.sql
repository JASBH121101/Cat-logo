-- JB Collections only. Preserve source chat retention:
-- declined conversations are deleted after the 10-minute reconsideration window;
-- all conversations and messages are deleted after 7 days.
-- Deliberately no cron/scheduler is configured by this migration.
BEGIN;
CREATE OR REPLACE FUNCTION public.cleanup_private_chats()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.private_chat_conversations
  WHERE (status = 'declined_pending_delete'
         AND delete_after IS NOT NULL
         AND delete_after <= now())
     OR created_at <= now() - interval '7 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.cleanup_private_chats() FROM PUBLIC, anonymous, authenticated;
INSERT INTO public.schema_migrations(version,name)
VALUES ('0006','private_chat_retention_cleanup')
ON CONFLICT (version) DO NOTHING;
COMMIT;
