-- Admin-only RPCs should not be callable by the anonymous PostgREST role.
-- Authenticated execution remains gated by auth.uid() and public.admin_users checks.
BEGIN;
REVOKE EXECUTE ON FUNCTION public.private_chat_admin_claim(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.private_chat_admin_close(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.private_chat_admin_extend_after_purchase(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.private_chat_admin_send(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.private_chat_admin_claim(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.private_chat_admin_close(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.private_chat_admin_extend_after_purchase(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.private_chat_admin_send(uuid, text) TO authenticated;
COMMIT;
