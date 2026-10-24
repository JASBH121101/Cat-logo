-- Enable the scheduler and async HTTP extension used by the trash cleanup job.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
