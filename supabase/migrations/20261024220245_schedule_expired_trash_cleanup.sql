-- Keep the published Edge Function JWT-protected; the anon JWT is public by design.
-- Vault contains the values so the recurring job does not hardcode them in cron.job.

do $block$
begin
  if not exists (select 1 from vault.secrets where name = 'catlogo_project_url') then
    perform vault.create_secret('https://uwqnoadelnnplcvqqlyz.supabase.co', 'catlogo_project_url');
  end if;
  if not exists (select 1 from vault.secrets where name = 'catlogo_cleanup_anon_jwt') then
    perform vault.create_secret('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV3cW5vYWRlbG5ucGxjdnFxbHl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1Nzk1MjEsImV4cCI6MjEwODE1NTUyMX0.7fcjrM_mgc18n3wo8fbDa0nTHzZKJJ4OxVcX6IPkJfM', 'catlogo_cleanup_anon_jwt');
  end if;
end;
$block$;

select cron.unschedule(jobid)
from cron.job
where jobname = 'catlogo-cleanup-expired-trash-daily';

select cron.schedule(
  'catlogo-cleanup-expired-trash-daily',
  '17 6 * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'catlogo_project_url') || '/functions/v1/cleanup-expired-trash',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'catlogo_cleanup_anon_jwt'),
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'catlogo_cleanup_anon_jwt')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $job$
);
