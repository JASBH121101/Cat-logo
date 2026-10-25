-- The admin check only needs to see the caller's own admin_users row.
-- Using invoker privileges keeps the function subject to normal RLS policies.
ALTER FUNCTION public.is_catalog_admin_user() SECURITY INVOKER;
