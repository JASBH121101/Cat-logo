-- Final route-selection behavior after removing the duplicated purchase-consent notice.
-- The notice and Yes/No actions are presented once by the customer page; the RPC only records the route.
BEGIN;
CREATE OR REPLACE FUNCTION public.private_chat_choose_route(p_session_token_hash text, p_route text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $function$
DECLARE
  v_row public.private_chat_conversations%rowtype;
  v_route text := lower(coalesce(p_route, ''));
BEGIN
  SELECT c.* INTO v_row
  FROM public.private_chat_conversations c
  WHERE c.session_token_hash = p_session_token_hash
    AND c.session_expires_at > now()
    AND c.status = 'pending_consent'
    AND c.contact_route IS NULL
    AND c.delete_after IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode='28000', message='chat_route_not_available';
  END IF;
  IF v_route NOT IN ('support','buy') THEN
    RAISE EXCEPTION USING errcode='22023', message='invalid_chat_route';
  END IF;

  IF v_route = 'support' THEN
    UPDATE public.private_chat_conversations
      SET contact_route='support', status='pending_advisor',
          updated_at=now(), last_message_at=now()
      WHERE id=v_row.id;
    INSERT INTO public.private_chat_messages (conversation_id, sender_type, content)
    VALUES (v_row.id, 'assistant',
      'Recibimos tu solicitud de atención. Un asesor de JB Collections te responderá personalmente por este chat en cuanto esté disponible.');
  ELSE
    UPDATE public.private_chat_conversations
      SET contact_route='buy', consent_notice_version='2026-10-28-v1',
          updated_at=now(), last_message_at=now()
      WHERE id=v_row.id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', CASE WHEN v_route='support' THEN 'pending_advisor' ELSE 'pending_consent' END,
    'contact_route', v_route
  );
END;
$function$;
COMMIT;
