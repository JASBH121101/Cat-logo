-- Support foreign-key lookups and avoid per-row auth.uid() re-evaluation in admin RLS.
BEGIN;
CREATE INDEX IF NOT EXISTS private_chat_conversations_product_id_idx
  ON public.private_chat_conversations (product_id);
CREATE INDEX IF NOT EXISTS private_chat_conversations_claimed_by_idx
  ON public.private_chat_conversations (claimed_by);

DROP POLICY IF EXISTS "Admins can read private chat conversations"
  ON public.private_chat_conversations;
CREATE POLICY "Admins can read private chat conversations"
  ON public.private_chat_conversations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Admins can read private chat messages"
  ON public.private_chat_messages;
CREATE POLICY "Admins can read private chat messages"
  ON public.private_chat_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.user_id = (SELECT auth.uid())
    )
  );
COMMIT;
