create or replace function public.cleanup_private_chats()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  deleted_count integer;
begin
  delete from public.private_chat_conversations
  where (status = 'declined_pending_delete' and delete_after is not null and delete_after <= now())
     or created_at <= now() - interval '7 days';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.cleanup_private_chats() from public, anon, authenticated;
