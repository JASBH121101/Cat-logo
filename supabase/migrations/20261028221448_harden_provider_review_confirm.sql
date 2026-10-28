BEGIN;

-- The confirmation routine needs no SECURITY DEFINER bypass: admin RLS policies
-- already authorize the authenticated catalog administrator to update these rows.
ALTER FUNCTION public.confirm_provider_product_review(uuid, jsonb, boolean) SECURITY INVOKER;
REVOKE ALL ON FUNCTION public.confirm_provider_product_review(uuid, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_provider_product_review(uuid, jsonb, boolean) TO authenticated;

COMMIT;
