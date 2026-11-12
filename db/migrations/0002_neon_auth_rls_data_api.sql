
-- JB Collections: Neon Data API / Managed Auth authorization model.
-- Execute only on Neon branch migration-neon-r2.
-- The source Supabase UUID stays in admin_users.user_id; new Neon Auth UUID
-- is recorded separately in neon_auth_user_id. This avoids assuming identities match.
BEGIN;

CREATE OR REPLACE FUNCTION public.is_catalog_admin_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, auth
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.neon_auth_user_id = auth.user_id()
  );
$function$;

REVOKE ALL ON FUNCTION public.is_catalog_admin_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_catalog_admin_user() TO authenticated;

GRANT USAGE ON SCHEMA public TO anonymous, authenticated;
GRANT SELECT ON public.products, public.perfume_details TO anonymous, authenticated;
GRANT INSERT ON public.catalog_events TO anonymous, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.admin_users,
  public.products,
  public.perfume_details,
  public.catalog_events,
  public.color_library,
  public.commission_records,
  public.product_provider_status,
  public.product_provider_review_history,
  public.private_chat_conversations,
  public.private_chat_messages,
  public.admin_push_subscriptions
TO authenticated;

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perfume_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.color_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_provider_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_provider_review_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.private_chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.private_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_users_select_self ON public.admin_users
  FOR SELECT TO authenticated
  USING (neon_auth_user_id = auth.user_id());

CREATE POLICY products_public_read ON public.products
  FOR SELECT TO anonymous, authenticated
  USING (is_published IS TRUE AND workflow_status = 'published' AND deleted_at IS NULL);
CREATE POLICY products_admin_manage ON public.products
  FOR ALL TO authenticated
  USING (public.is_catalog_admin_user())
  WITH CHECK (public.is_catalog_admin_user());

CREATE POLICY perfume_details_public_read ON public.perfume_details
  FOR SELECT TO anonymous, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = perfume_details.product_id
      AND p.catalog_type = 'perfumery'
      AND p.is_published IS TRUE
      AND p.workflow_status = 'published'
      AND p.deleted_at IS NULL
  ));
CREATE POLICY perfume_details_admin_manage ON public.perfume_details
  FOR ALL TO authenticated
  USING (public.is_catalog_admin_user())
  WITH CHECK (public.is_catalog_admin_user());

CREATE POLICY catalog_events_public_insert ON public.catalog_events
  FOR INSERT TO anonymous, authenticated
  WITH CHECK (
    (
      event_type IN ('view','whatsapp_click')
      AND EXISTS (SELECT 1 FROM public.products p WHERE p.id = catalog_events.product_id AND p.is_published IS TRUE)
    )
    OR
    (
      event_type = 'catalog_view'
      AND product_id IS NULL
      AND catalog_type IN ('technology','perfumery')
    )
  );
CREATE POLICY catalog_events_admin_select ON public.catalog_events
  FOR SELECT TO authenticated USING (public.is_catalog_admin_user());
CREATE POLICY catalog_events_admin_delete ON public.catalog_events
  FOR DELETE TO authenticated USING (public.is_catalog_admin_user());
CREATE POLICY catalog_events_no_admin_insert ON public.catalog_events
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_catalog_admin_user());

CREATE POLICY color_library_admin_select ON public.color_library
  FOR SELECT TO authenticated USING (public.is_catalog_admin_user());
CREATE POLICY color_library_admin_insert ON public.color_library
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_catalog_admin_user()
    AND updated_by = (SELECT au.user_id FROM public.admin_users au WHERE au.neon_auth_user_id = auth.user_id() LIMIT 1)
  );
CREATE POLICY color_library_admin_update ON public.color_library
  FOR UPDATE TO authenticated
  USING (public.is_catalog_admin_user())
  WITH CHECK (
    public.is_catalog_admin_user()
    AND updated_by = (SELECT au.user_id FROM public.admin_users au WHERE au.neon_auth_user_id = auth.user_id() LIMIT 1)
  );
CREATE POLICY color_library_admin_delete ON public.color_library
  FOR DELETE TO authenticated USING (public.is_catalog_admin_user());

CREATE POLICY commission_records_admin_select ON public.commission_records
  FOR SELECT TO authenticated USING (public.is_catalog_admin_user());
CREATE POLICY commission_records_admin_insert ON public.commission_records
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_catalog_admin_user()
    AND created_by = (SELECT au.user_id FROM public.admin_users au WHERE au.neon_auth_user_id = auth.user_id() LIMIT 1)
  );
CREATE POLICY commission_records_admin_update ON public.commission_records
  FOR UPDATE TO authenticated
  USING (public.is_catalog_admin_user())
  WITH CHECK (public.is_catalog_admin_user());
CREATE POLICY commission_records_admin_delete ON public.commission_records
  FOR DELETE TO authenticated USING (public.is_catalog_admin_user());

CREATE POLICY product_provider_status_admin_select ON public.product_provider_status
  FOR SELECT TO authenticated USING (public.is_catalog_admin_user());
CREATE POLICY product_provider_status_admin_insert ON public.product_provider_status
  FOR INSERT TO authenticated WITH CHECK (public.is_catalog_admin_user());
CREATE POLICY product_provider_status_admin_update ON public.product_provider_status
  FOR UPDATE TO authenticated
  USING (public.is_catalog_admin_user())
  WITH CHECK (public.is_catalog_admin_user());

CREATE POLICY product_provider_history_admin_select ON public.product_provider_review_history
  FOR SELECT TO authenticated USING (public.is_catalog_admin_user());
CREATE POLICY product_provider_history_admin_insert ON public.product_provider_review_history
  FOR INSERT TO authenticated WITH CHECK (public.is_catalog_admin_user());

CREATE POLICY private_chat_conversations_admin_read ON public.private_chat_conversations
  FOR SELECT TO authenticated USING (public.is_catalog_admin_user());
CREATE POLICY private_chat_messages_admin_read ON public.private_chat_messages
  FOR SELECT TO authenticated USING (public.is_catalog_admin_user());

CREATE POLICY admin_push_subscriptions_admin_manage ON public.admin_push_subscriptions
  FOR ALL TO authenticated
  USING (
    public.is_catalog_admin_user()
    AND user_id = (SELECT au.user_id FROM public.admin_users au WHERE au.neon_auth_user_id = auth.user_id() LIMIT 1)
  )
  WITH CHECK (
    public.is_catalog_admin_user()
    AND user_id = (SELECT au.user_id FROM public.admin_users au WHERE au.neon_auth_user_id = auth.user_id() LIMIT 1)
  );

INSERT INTO public.schema_migrations(version,name)
VALUES ('0002','neon_auth_rls_data_api')
ON CONFLICT (version) DO NOTHING;

COMMIT;
