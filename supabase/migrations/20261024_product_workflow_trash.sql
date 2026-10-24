-- Cat-logo: estados persistentes de producto, papelera y limpieza segura.
-- Ejecutar solamente en el proyecto Supabase de Cat-logo (ref. uwqnoadelnnplcvqqlyz).

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS workflow_status text,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS trash_previous_status text,
  ADD COLUMN IF NOT EXISTS draft_payload jsonb;

-- Los registros existentes se conservan: los publicados siguen publicados y los
-- registros privados existentes pasan a "unpublished" hasta que el administrador
-- los clasifique explícitamente como borradores.
UPDATE public.products
SET workflow_status = CASE
  WHEN deleted_at IS NOT NULL THEN 'trash'
  WHEN COALESCE(is_published, false) THEN 'published'
  ELSE 'unpublished'
END
WHERE workflow_status IS NULL
   OR workflow_status NOT IN ('draft', 'unpublished', 'published', 'trash');

UPDATE public.products
SET is_published = false
WHERE workflow_status = 'trash' AND COALESCE(is_published, false);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'products_workflow_status_check'
      AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_workflow_status_check
      CHECK (workflow_status IS NULL OR workflow_status IN ('draft', 'unpublished', 'published', 'trash'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS products_workflow_status_idx
  ON public.products (workflow_status);

CREATE INDEX IF NOT EXISTS products_trash_expiry_idx
  ON public.products (deleted_at)
  WHERE workflow_status = 'trash';

-- Mantiene la compatibilidad con importaciones o clientes antiguos que solo
-- escriban is_published, y conserva el significado de los nuevos estados.
CREATE OR REPLACE FUNCTION public.sync_product_workflow_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.workflow_status IS NULL THEN
      NEW.workflow_status := CASE WHEN COALESCE(NEW.is_published, false) THEN 'published' ELSE 'unpublished' END;
    ELSE
      NEW.is_published := (NEW.workflow_status = 'published');
    END IF;
  ELSIF NEW.workflow_status IS DISTINCT FROM OLD.workflow_status THEN
    NEW.is_published := (NEW.workflow_status = 'published');
  ELSIF NEW.is_published IS DISTINCT FROM OLD.is_published THEN
    NEW.workflow_status := CASE WHEN COALESCE(NEW.is_published, false) THEN 'published' ELSE 'unpublished' END;
  END IF;

  IF NEW.workflow_status = 'trash' THEN
    NEW.is_published := false;
  ELSE
    NEW.deleted_at := NULL;
    NEW.trash_previous_status := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_sync_workflow_status ON public.products;
CREATE TRIGGER products_sync_workflow_status
BEFORE INSERT OR UPDATE OF workflow_status, is_published, deleted_at, trash_previous_status
ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.sync_product_workflow_status();

-- Archivo sin FK al producto: los datos agregados de interés pueden conservarse
-- cuando el producto y sus eventos operativos se eliminen de forma definitiva.
DO $$
BEGIN
  IF to_regclass('public.catalog_events') IS NOT NULL THEN
    EXECUTE $archive$
      CREATE TABLE IF NOT EXISTS public.catalog_events_archive AS
      SELECT e.*, p.name AS archived_product_name,
                 p.catalog_type AS archived_catalog_type,
                 now() AS archived_at
      FROM public.catalog_events e
      CROSS JOIN public.products p
      WHERE false
    $archive$;
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.catalog_events_archive') IS NOT NULL THEN
    ALTER TABLE public.catalog_events_archive
      ADD COLUMN IF NOT EXISTS archived_product_name text,
      ADD COLUMN IF NOT EXISTS archived_catalog_type text,
      ADD COLUMN IF NOT EXISTS archived_at timestamptz;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'catalog_events_archive' AND column_name = 'id'
    ) THEN
      EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS catalog_events_archive_id_uidx ON public.catalog_events_archive (id)';
    END IF;
    ALTER TABLE public.catalog_events_archive ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS catalog_events_archive_admin_all ON public.catalog_events_archive;
    CREATE POLICY catalog_events_archive_admin_all
      ON public.catalog_events_archive
      FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()))
      WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()));
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_events_archive TO authenticated;
  END IF;
END
$$;

-- Cola de reintentos para fotografías que no se puedan borrar durante una
-- eliminación definitiva. Los errores no se pierden al eliminar el producto.
CREATE TABLE IF NOT EXISTS public.storage_cleanup_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket text NOT NULL DEFAULT 'product-images',
  object_path text NOT NULL,
  source_product_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  last_error text
);

CREATE UNIQUE INDEX IF NOT EXISTS storage_cleanup_queue_bucket_path_uidx
  ON public.storage_cleanup_queue (bucket, object_path);

ALTER TABLE public.storage_cleanup_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS storage_cleanup_queue_admin_all ON public.storage_cleanup_queue;
CREATE POLICY storage_cleanup_queue_admin_all
  ON public.storage_cleanup_queue
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.storage_cleanup_queue TO authenticated;
