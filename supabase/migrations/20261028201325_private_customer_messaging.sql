-- Reconstructed source for the already-applied private customer messaging baseline.
-- The original migration file was absent from main; this recreates the deployed base schema
-- so a fresh environment can apply the following chat workflow migrations in order.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

CREATE TABLE IF NOT EXISTS public.private_chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_type text NOT NULL CHECK (catalog_type IN ('technology','perfumery','collections')),
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text NOT NULL DEFAULT 'Consulta general',
  product_url text NOT NULL DEFAULT 'https://jb-collections.pages.dev/',
  payment_topic text NOT NULL DEFAULT 'product'
    CHECK (payment_topic IN ('product','financing','credit_card','other')),
  status text NOT NULL DEFAULT 'pending_consent'
    CHECK (status IN ('pending_consent','pending_advisor','advisor_active','declined_pending_delete','closed')),
  invite_token_hash text,
  invite_expires_at timestamptz,
  invite_redeemed_at timestamptz,
  session_token_hash text,
  session_expires_at timestamptz,
  consent_choice text CHECK (consent_choice IS NULL OR consent_choice IN ('yes','no')),
  consent_notice_version text,
  consent_at timestamptz,
  declined_at timestamptz,
  delete_after timestamptz,
  claimed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT private_chat_conversations_product_name_check CHECK (char_length(product_name) <= 160),
  CONSTRAINT private_chat_conversations_product_url_check CHECK (char_length(product_url) <= 500)
);

CREATE TABLE IF NOT EXISTS public.private_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.private_chat_conversations(id) ON DELETE CASCADE,
  sender_type text NOT NULL CHECK (sender_type IN ('customer','assistant','advisor')),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 1200),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS private_chat_conversations_status_last_message_idx
  ON public.private_chat_conversations (status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS private_chat_conversations_delete_after_idx
  ON public.private_chat_conversations (delete_after) WHERE delete_after IS NOT NULL;
CREATE INDEX IF NOT EXISTS private_chat_messages_conversation_created_idx
  ON public.private_chat_messages (conversation_id, created_at);

ALTER TABLE public.private_chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.private_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read private chat conversations" ON public.private_chat_conversations;
CREATE POLICY "Admins can read private chat conversations"
  ON public.private_chat_conversations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = auth.uid()));

DROP POLICY IF EXISTS "Admins can read private chat messages" ON public.private_chat_messages;
CREATE POLICY "Admins can read private chat messages"
  ON public.private_chat_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = auth.uid()));

GRANT SELECT ON public.private_chat_conversations, public.private_chat_messages TO authenticated;
REVOKE ALL ON public.private_chat_conversations, public.private_chat_messages FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.private_chat_conversations, public.private_chat_messages FROM authenticated;

CREATE OR REPLACE FUNCTION public.cleanup_private_chats()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.private_chat_conversations
  WHERE (status = 'declined_pending_delete' AND delete_after IS NOT NULL AND delete_after <= now())
     OR created_at <= now() - interval '7 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.cleanup_private_chats() FROM PUBLIC, anon, authenticated;

DO $block$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'jb-collections-private-chat-cleanup'
  ) THEN
    PERFORM cron.schedule(
      'jb-collections-private-chat-cleanup',
      '* * * * *',
      'select public.cleanup_private_chats();'
    );
  END IF;
END;
$block$;

COMMIT;
