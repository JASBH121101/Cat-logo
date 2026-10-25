-- Harden the trigger function against search_path shadowing.
ALTER FUNCTION public.set_updated_at() SET search_path TO 'pg_catalog', 'public';
