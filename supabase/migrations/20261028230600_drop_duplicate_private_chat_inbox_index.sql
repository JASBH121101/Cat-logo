-- Keep one composite index for the admin inbox; the remaining index has identical keys.
BEGIN;
DROP INDEX IF EXISTS public.private_chat_conversations_status_last_message_idx;
COMMIT;
