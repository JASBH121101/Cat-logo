-- Public customer-chat RPCs are authenticated by a one-time invite or session token.
-- The proxy calls them with the publishable key; admin sessions must not gain extra RPC access.
BEGIN;
REVOKE EXECUTE ON FUNCTION public.private_chat_choose_route(text, text) FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.private_chat_create(text, uuid, text, text, text, text) FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.private_chat_public_messages(text) FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.private_chat_public_send(text, text) FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.private_chat_public_status(text) FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.private_chat_record_consent(text, text, text) FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.private_chat_redeem(text, text) FROM PUBLIC, authenticated;

GRANT EXECUTE ON FUNCTION public.private_chat_choose_route(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.private_chat_create(text, uuid, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.private_chat_public_messages(text) TO anon;
GRANT EXECUTE ON FUNCTION public.private_chat_public_send(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.private_chat_public_status(text) TO anon;
GRANT EXECUTE ON FUNCTION public.private_chat_record_consent(text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.private_chat_redeem(text, text) TO anon;
COMMIT;
