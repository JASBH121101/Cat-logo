-- JB Collections only. Source: Supabase project uwqnoadelnnplcvqqlyz.
-- Target: Neon project jb-collections-test / branch migration-neon-r2.
-- This baseline preserves source table shapes, JSONB product variants, constraints,
-- indexes and database workflow triggers. It intentionally does not create auth users,
-- credentials, secrets, scheduled jobs, or public grants.
-- Auth identities are mapped in admin_users.neon_auth_user_id; user_id retains the
-- original Supabase UUID so historical user references remain stable.

BEGIN;

CREATE TABLE public.admin_users (
  user_id uuid PRIMARY KEY,
  neon_auth_user_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  slug text UNIQUE,
  category text,
  brand text,
  description text,
  price_usd numeric,
  price_nio numeric,
  image_url text,
  images jsonb NOT NULL DEFAULT '[]'::jsonb,
  specifications jsonb NOT NULL DEFAULT '{}'::jsonb,
  warranty_months integer,
  availability text DEFAULT 'available',
  is_published boolean NOT NULL DEFAULT false,
  featured boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  model text,
  catalog_key text,
  financing_note text,
  shipping_note text,
  warranty_note text,
  price_note text,
  currency text DEFAULT 'USD',
  stock_quantity integer,
  updated_by uuid REFERENCES public.admin_users(user_id) ON DELETE SET NULL,
  colors jsonb NOT NULL DEFAULT '[]'::jsonb,
  variants jsonb NOT NULL DEFAULT '[]'::jsonb,
  catalog_type text NOT NULL DEFAULT 'technology',
  workflow_status text NOT NULL DEFAULT 'unpublished',
  is_exclusive boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  deleted_from_status text,
  product_type text NOT NULL DEFAULT 'standard',
  published_at timestamptz,
  subcategory text,
  tags text[] NOT NULL DEFAULT '{}'::text[],
  CONSTRAINT products_availability_check CHECK (availability = ANY(ARRAY['available','on_order','out_of_stock']::text[])),
  CONSTRAINT products_catalog_type_check CHECK (catalog_type = ANY(ARRAY['technology','perfumery']::text[])),
  CONSTRAINT products_deleted_from_status_check CHECK (deleted_from_status IS NULL OR deleted_from_status = ANY(ARRAY['draft','unpublished','published']::text[])),
  CONSTRAINT products_product_type_check CHECK (product_type = ANY(ARRAY['standard','perfume','set']::text[])),
  CONSTRAINT products_workflow_status_check CHECK (workflow_status = ANY(ARRAY['draft','unpublished','published','trash','deleting']::text[])),
  CONSTRAINT products_workflow_required_fields_check CHECK (
    workflow_status IN ('trash','deleting') OR (
      name IS NOT NULL AND length(btrim(name)) > 0 AND
      (workflow_status IN ('draft','unpublished') OR (
        category IS NOT NULL AND length(btrim(category)) > 0 AND
        availability IS NOT NULL AND length(btrim(availability)) > 0
      ))
    )
  )
);

CREATE UNIQUE INDEX products_catalog_key_unique ON public.products(catalog_key) WHERE catalog_key IS NOT NULL;

CREATE INDEX idx_products_catalog_type_published ON public.products(catalog_type,is_published,sort_order);

CREATE INDEX products_category_idx ON public.products(category);

CREATE INDEX products_created_at_idx ON public.products(created_at DESC);

CREATE INDEX products_published_idx ON public.products(is_published);

CREATE INDEX products_tags_gin_idx ON public.products USING gin(tags);

CREATE INDEX products_trash_expiry_idx ON public.products(deleted_at) WHERE workflow_status IN ('trash','deleting') AND deleted_at IS NOT NULL;

CREATE INDEX products_updated_by_idx ON public.products(updated_by);

CREATE INDEX products_workflow_status_catalog_idx ON public.products(catalog_type,workflow_status,updated_at DESC);

CREATE TABLE public.perfume_details (
  product_id uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  family text NOT NULL CHECK (family = ANY(ARRAY['arabes','nicho','disenador']::text[])),
  concentration text,
  volume_ml numeric CHECK (volume_ml IS NULL OR volume_ml > 0),
  audience text,
  scent_family text,
  top_notes text[] NOT NULL DEFAULT '{}'::text[],
  heart_notes text[] NOT NULL DEFAULT '{}'::text[],
  base_notes text[] NOT NULL DEFAULT '{}'::text[],
  is_original boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_perfume_details_family ON public.perfume_details(family);

CREATE TABLE public.catalog_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type = ANY(ARRAY['view','whatsapp_click','catalog_view']::text[])),
  created_at timestamptz NOT NULL DEFAULT now(),
  variant_color text,
  variant_ram text,
  variant_storage text,
  visitor_country text,
  visitor_department text,
  catalog_type text
);

CREATE INDEX catalog_events_catalog_visit_created_idx ON public.catalog_events(catalog_type,event_type,created_at DESC);

CREATE INDEX catalog_events_created_at_idx ON public.catalog_events(created_at DESC);

CREATE INDEX catalog_events_department_type_created_idx ON public.catalog_events(visitor_country,visitor_department,event_type,created_at DESC);

CREATE INDEX catalog_events_product_type_created_idx ON public.catalog_events(product_id,event_type,created_at DESC);

CREATE INDEX catalog_events_variant_interest_idx ON public.catalog_events(event_type,variant_storage,variant_ram,variant_color,created_at DESC) WHERE event_type='whatsapp_click';

CREATE TABLE public.color_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  name_key text NOT NULL UNIQUE CHECK (char_length(name_key) BETWEEN 1 AND 120),
  hex text NOT NULL CHECK (hex ~ '^#[0-9A-Fa-f]{6}$'),
  aliases text[] NOT NULL DEFAULT '{}'::text[],
  is_favorite boolean NOT NULL DEFAULT false,
  updated_by uuid NOT NULL REFERENCES public.admin_users(user_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX color_library_updated_by_idx ON public.color_library(updated_by);

CREATE TABLE public.product_provider_status (
  product_id uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  provider_name text NOT NULL DEFAULT 'GoPartner',
  provider_product_id text,
  provider_url text,
  provider_price_usd numeric CHECK (provider_price_usd IS NULL OR provider_price_usd >= 0),
  provider_price_nio numeric CHECK (provider_price_nio IS NULL OR provider_price_nio >= 0),
  provider_availability text NOT NULL DEFAULT 'unknown' CHECK (provider_availability = ANY(ARRAY['unknown','available','on_order','out_of_stock']::text[])),
  review_notes text,
  last_reviewed_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES public.admin_users(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  provider_variant_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX product_provider_status_reviewed_by_idx ON public.product_provider_status(reviewed_by);

CREATE INDEX product_provider_status_reviewed_idx ON public.product_provider_status(last_reviewed_at DESC);

CREATE TABLE public.product_provider_review_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name_snapshot text NOT NULL,
  catalog_type_snapshot text NOT NULL CHECK (catalog_type_snapshot = ANY(ARRAY['technology','perfumery']::text[])),
  provider_name text NOT NULL,
  provider_product_id text,
  provider_url text,
  provider_price_usd numeric,
  provider_price_nio numeric,
  provider_availability text NOT NULL CHECK (provider_availability = ANY(ARRAY['unknown','available','on_order','out_of_stock']::text[])),
  review_notes text,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES public.admin_users(user_id) ON DELETE SET NULL,
  provider_variant_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX product_provider_review_history_product_idx ON public.product_provider_review_history(product_id,reviewed_at DESC);

CREATE INDEX product_provider_review_history_reviewed_by_idx ON public.product_provider_review_history(reviewed_by);

CREATE TABLE public.commission_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_type text NOT NULL CHECK (catalog_type = ANY(ARRAY['technology','perfumery']::text[])),
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  department text,
  channel text NOT NULL DEFAULT 'whatsapp' CHECK (channel = ANY(ARRAY['whatsapp','messenger','other']::text[])),
  commission_amount numeric CHECK (commission_amount IS NULL OR commission_amount >= 0),
  commission_currency text NOT NULL DEFAULT 'NIO' CHECK (commission_currency = ANY(ARRAY['NIO','USD']::text[])),
  status text NOT NULL DEFAULT 'pending_confirmation' CHECK (status = ANY(ARRAY['pending_confirmation','confirmed_pending_payment','received','cancelled']::text[])),
  operation_date date NOT NULL DEFAULT CURRENT_DATE,
  received_date date,
  order_reference text,
  notes text,
  created_by uuid NOT NULL REFERENCES public.admin_users(user_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commission_records_amount_required_when_confirmed CHECK (status IN ('pending_confirmation','cancelled') OR commission_amount IS NOT NULL),
  CONSTRAINT commission_records_received_date_consistency CHECK ((status='received' AND received_date IS NOT NULL) OR (status<>'received' AND received_date IS NULL))
);

CREATE INDEX commission_records_catalog_status_date_idx ON public.commission_records(catalog_type,status,operation_date DESC);

CREATE INDEX commission_records_created_at_idx ON public.commission_records(created_at DESC);

CREATE INDEX commission_records_product_id_idx ON public.commission_records(product_id);

CREATE TABLE public.private_chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_type text NOT NULL CHECK (catalog_type = ANY(ARRAY['technology','perfumery','collections']::text[])),
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text NOT NULL DEFAULT 'Consulta general' CHECK (char_length(product_name) <= 160),
  product_url text NOT NULL DEFAULT 'https://jb-collections.pages.dev/' CHECK (char_length(product_url) <= 500),
  payment_topic text NOT NULL DEFAULT 'product' CHECK (payment_topic = ANY(ARRAY['product','financing','credit_card','other']::text[])),
  status text NOT NULL DEFAULT 'pending_consent' CHECK (status = ANY(ARRAY['pending_consent','pending_advisor','advisor_active','declined_pending_delete','closed']::text[])),
  invite_token_hash text,
  invite_expires_at timestamptz,
  invite_redeemed_at timestamptz,
  session_token_hash text,
  session_expires_at timestamptz,
  consent_choice text CHECK (consent_choice IS NULL OR consent_choice = ANY(ARRAY['yes','no']::text[])),
  consent_notice_version text,
  consent_at timestamptz,
  declined_at timestamptz,
  delete_after timestamptz,
  claimed_by uuid REFERENCES public.admin_users(user_id) ON DELETE SET NULL,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  contact_route text CHECK (contact_route IS NULL OR contact_route = ANY(ARRAY['support','buy']::text[])),
  purchase_confirmed_at timestamptz,
  admin_push_claimed_at timestamptz,
  admin_push_notified_at timestamptz
);

CREATE INDEX private_chat_conversations_admin_inbox_idx ON public.private_chat_conversations(status,last_message_at DESC);

CREATE INDEX private_chat_conversations_claimed_by_idx ON public.private_chat_conversations(claimed_by);

CREATE INDEX private_chat_conversations_delete_after_idx ON public.private_chat_conversations(delete_after) WHERE delete_after IS NOT NULL;

CREATE INDEX private_chat_conversations_product_id_idx ON public.private_chat_conversations(product_id);

CREATE TABLE public.private_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.private_chat_conversations(id) ON DELETE CASCADE,
  sender_type text NOT NULL CHECK (sender_type = ANY(ARRAY['customer','assistant','advisor']::text[])),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 1200),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX private_chat_messages_conversation_created_idx ON public.private_chat_messages(conversation_id,created_at);

CREATE TABLE public.admin_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.admin_users(user_id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE CHECK (endpoint ~ '^https://'),
  p256dh text NOT NULL,
  auth_secret text NOT NULL,
  expiration_time timestamptz,
  user_agent text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admin_push_subscriptions_user_id_idx ON public.admin_push_subscriptions(user_id);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $function$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_catalog_product_workflow()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $function$
DECLARE restore_status text;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.deleted_at IS NOT NULL THEN
      IF NEW.workflow_status NOT IN ('trash','deleting') THEN
        NEW.deleted_from_status := COALESCE(NEW.deleted_from_status,CASE WHEN NEW.is_published THEN 'published' ELSE NEW.workflow_status END,'unpublished');
        NEW.workflow_status := 'trash';
      END IF;
      NEW.is_published := false;
    ELSIF NEW.workflow_status IN ('draft','unpublished','published') THEN
      NEW.is_published := (NEW.workflow_status='published');
    ELSIF NEW.is_published THEN NEW.workflow_status := 'published';
    ELSE NEW.workflow_status := 'unpublished';
    END IF;
  ELSE
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      NEW.deleted_from_status := COALESCE(OLD.workflow_status,CASE WHEN OLD.is_published THEN 'published' ELSE 'unpublished' END);
      IF NEW.deleted_from_status NOT IN ('draft','unpublished','published') THEN NEW.deleted_from_status := CASE WHEN OLD.is_published THEN 'published' ELSE 'unpublished' END; END IF;
      NEW.workflow_status := 'trash'; NEW.is_published := false;
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      restore_status := COALESCE(CASE WHEN NEW.workflow_status IN ('draft','unpublished','published') THEN NEW.workflow_status END,NEW.deleted_from_status,OLD.deleted_from_status,'unpublished');
      IF restore_status NOT IN ('draft','unpublished','published') THEN restore_status := 'unpublished'; END IF;
      NEW.workflow_status := restore_status; NEW.deleted_from_status := NULL; NEW.is_published := (restore_status='published');
    ELSIF NEW.workflow_status IS DISTINCT FROM OLD.workflow_status THEN
      IF NEW.workflow_status='trash' THEN
        IF OLD.deleted_at IS NULL THEN
          NEW.deleted_from_status := COALESCE(CASE WHEN OLD.workflow_status IN ('draft','unpublished','published') THEN OLD.workflow_status END,CASE WHEN OLD.is_published THEN 'published' ELSE 'unpublished' END);
          NEW.deleted_at := COALESCE(NEW.deleted_at,now());
        END IF;
        NEW.is_published := false;
      ELSIF NEW.workflow_status='deleting' THEN NEW.deleted_at := COALESCE(NEW.deleted_at,OLD.deleted_at,now()); NEW.is_published := false;
      ELSIF NEW.workflow_status IN ('draft','unpublished','published') AND NEW.deleted_at IS NULL THEN NEW.deleted_from_status := NULL; NEW.is_published := (NEW.workflow_status='published');
      END IF;
    ELSIF NEW.is_published IS DISTINCT FROM OLD.is_published AND NEW.deleted_at IS NULL THEN
      NEW.workflow_status := CASE WHEN NEW.is_published THEN 'published' ELSE 'unpublished' END;
    END IF;
  END IF;
  IF NEW.workflow_status IN ('trash','deleting') THEN NEW.is_published := false; END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_product_featured_exclusive()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $function$
DECLARE merged boolean;
BEGIN
  IF TG_OP='INSERT' THEN merged := COALESCE(NEW.featured,false) OR COALESCE(NEW.is_exclusive,false); NEW.featured:=merged; NEW.is_exclusive:=merged;
  ELSIF NEW.featured IS DISTINCT FROM OLD.featured AND NEW.is_exclusive IS NOT DISTINCT FROM OLD.is_exclusive THEN NEW.is_exclusive:=COALESCE(NEW.featured,false);
  ELSIF NEW.is_exclusive IS DISTINCT FROM OLD.is_exclusive AND NEW.featured IS NOT DISTINCT FROM OLD.featured THEN NEW.featured:=COALESCE(NEW.is_exclusive,false);
  ELSE merged:=COALESCE(NEW.featured,false) OR COALESCE(NEW.is_exclusive,false); NEW.featured:=merged; NEW.is_exclusive:=merged;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.log_product_provider_review()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $function$
DECLARE product_record record;
BEGIN
  SELECT p.name,p.catalog_type INTO product_record FROM public.products p WHERE p.id=NEW.product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe el producto asociado a la revisión del proveedor.'; END IF;
  INSERT INTO public.product_provider_review_history (
    product_id,product_name_snapshot,catalog_type_snapshot,provider_name,provider_product_id,provider_url,
    provider_price_usd,provider_price_nio,provider_availability,review_notes,provider_variant_snapshot,reviewed_at,reviewed_by
  ) VALUES (
    NEW.product_id,COALESCE(product_record.name,'Producto sin nombre'),
    CASE WHEN product_record.catalog_type='perfumery' THEN 'perfumery' ELSE 'technology' END,
    NEW.provider_name,NEW.provider_product_id,NEW.provider_url,NEW.provider_price_usd,NEW.provider_price_nio,
    NEW.provider_availability,NEW.review_notes,COALESCE(NEW.provider_variant_snapshot,'[]'::jsonb),NEW.last_reviewed_at,NEW.reviewed_by
  );
  NEW.updated_at:=now(); RETURN NEW;
END;
$function$;

CREATE TRIGGER products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER products_sync_workflow_state BEFORE INSERT OR UPDATE OF workflow_status,is_published,deleted_at,deleted_from_status ON public.products FOR EACH ROW EXECUTE FUNCTION public.sync_catalog_product_workflow();

CREATE TRIGGER products_sync_featured_exclusive BEFORE INSERT OR UPDATE OF featured,is_exclusive ON public.products FOR EACH ROW EXECUTE FUNCTION public.sync_product_featured_exclusive();

CREATE TRIGGER product_provider_status_history_trigger BEFORE INSERT OR UPDATE ON public.product_provider_status FOR EACH ROW EXECUTE FUNCTION public.log_product_provider_review();

CREATE TABLE public.schema_migrations (
  version text PRIMARY KEY,
  name text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.schema_migrations(version,name) VALUES ('0001','initial_catalog_schema');

COMMIT;
