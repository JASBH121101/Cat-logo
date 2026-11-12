-- Fiverr demo only: index commission ownership lookups.
-- Apply to the isolated fiverr-demo Neon branch; never production.
BEGIN;

CREATE INDEX IF NOT EXISTS commission_records_created_by_idx
  ON public.commission_records (created_by);

INSERT INTO public.schema_migrations(version, name)
VALUES ('0014', 'commission_records_created_by_idx')
ON CONFLICT (version) DO NOTHING;

COMMIT;
