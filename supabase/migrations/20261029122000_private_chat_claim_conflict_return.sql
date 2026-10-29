-- Return a typed conflict for stale claim attempts instead of raising a database exception.
-- The row lock and authorization guard remain in place; callers can refresh stale inbox state.
CREATE OR REPLACE FUNCTION public.private_chat_admin_claim(p_conversation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.private_chat_conversations%rowtype;
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users au WHERE au.user_id = v_uid
  ) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'admin_only';
  END IF;

  SELECT c.* INTO v_row
  FROM public.private_chat_conversations c
  WHERE c.id = p_conversation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0002', message = 'conversation_not_found';
  END IF;

  IF v_row.status = 'advisor_active' AND v_row.claimed_by = v_uid THEN
    RETURN jsonb_build_object('ok', true, 'status', 'advisor_active', 'claimed_by', v_uid);
  END IF;

  IF v_row.status <> 'pending_advisor' OR v_row.claimed_by IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'conversation_already_claimed_or_not_pending'
    );
  END IF;

  UPDATE public.private_chat_conversations
  SET status = 'advisor_active',
      claimed_by = v_uid,
      claimed_at = now(),
      updated_at = now()
  WHERE id = p_conversation_id;

  INSERT INTO public.private_chat_messages (conversation_id, sender_type, content)
  VALUES (
    p_conversation_id,
    'assistant',
    'Un asesor tomó la conversación. Ya podés responder en este chat.'
  );

  RETURN jsonb_build_object('ok', true, 'status', 'advisor_active', 'claimed_by', v_uid);
END;
$function$;
