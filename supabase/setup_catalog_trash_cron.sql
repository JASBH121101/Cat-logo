-- Cat-logo: schedule cleanup of products that have been in the trash for 15 days.
-- Run only after:
--   1) applying supabase/migrations/20261024213000_product_workflow_trash.sql
--   2) deploying supabase/functions/catalog-trash-cleanup/index.ts with JWT verification disabled
--   3) setting CATALOG_TRASH_CLEANUP_SECRET in Edge Function Secrets
--   4) creating Vault secrets named cat_logo_project_url and cat_logo_cleanup_secret
--      (cat_logo_cleanup_secret must exactly match CATALOG_TRASH_CLEANUP_SECRET)
--
-- Create the two Vault secrets in the Supabase Dashboard's Vault UI.
-- Do not commit the cleanup secret to Git.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $check$
begin
  if not exists (
    select 1 from vault.decrypted_secrets where name = 'cat_logo_project_url'
  ) then
    raise exception 'Missing Vault secret cat_logo_project_url. Add the Cat-logo project URL in Supabase Vault first.';
  end if;
  if not exists (
    select 1 from vault.decrypted_secrets where name = 'cat_logo_cleanup_secret'
  ) then
    raise exception 'Missing Vault secret cat_logo_cleanup_secret. Add the same secret configured on the Edge Function.';
  end if;
end;
$check$;

select cron.unschedule(jobid)
from cron.job
where jobname = 'cat-logo-trash-cleanup';

select cron.schedule(
  'cat-logo-trash-cleanup',
  '15 8 * * *',
  $job$
    select net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'cat_logo_project_url'
      ) || '/functions/v1/catalog-trash-cleanup',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'cat_logo_cleanup_secret'
        )
      ),
      body := '{"source":"pg_cron"}'::jsonb
    );
  $job$
);

-- The job runs daily at 08:15 UTC (02:15 in Nicaragua, UTC-6).
