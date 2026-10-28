create table public.private_chat_conversations (
  id uuid primary key default gen_random_uuid(),
  catalog_type text not null check (catalog_type in ('technology','perfumery','collections')),
  product_id uuid null references public.products(id) on delete set null,
  product_name text not null default 'Consulta general' check (char_length(product_name) <= 160),
  product_url text not null default 'https://jb-collections.pages.dev/' check (char_length(product_url) <= 500),
  payment_topic text not null default 'product' check (payment_topic in ('product','financing','credit_card','other')),
  status text not null default 'pending_consent' check (status in ('pending_consent','pending_advisor','advisor_active','declined_pending_delete','closed')),
  invite_token_hash text null,
  invite_expires_at timestamptz null,
  invite_redeemed_at timestamptz null,
  session_token_hash text null,
  session_expires_at timestamptz null,
  consent_choice text null check (consent_choice is null or consent_choice in ('yes','no')),
  consent_notice_version text null,
  consent_at timestamptz null,
  declined_at timestamptz null,
  delete_after timestamptz null,
  claimed_by uuid null references auth.users(id) on delete set null,
  claimed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create table public.private_chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.private_chat_conversations(id) on delete cascade,
  sender_type text not null check (sender_type in ('customer','assistant','advisor')),
  content text not null check (char_length(content) between 1 and 1200),
  created_at timestamptz not null default now()
);

create index private_chat_conversations_status_last_message_idx
  on public.private_chat_conversations(status, last_message_at desc);
create index private_chat_conversations_delete_after_idx
  on public.private_chat_conversations(delete_after) where delete_after is not null;
create index private_chat_messages_conversation_created_idx
  on public.private_chat_messages(conversation_id, created_at asc);

alter table public.private_chat_conversations enable row level security;
alter table public.private_chat_messages enable row level security;

revoke all on table public.private_chat_conversations from public, anon, authenticated;
revoke all on table public.private_chat_messages from public, anon, authenticated;
grant all on table public.private_chat_conversations to service_role;
grant all on table public.private_chat_messages to service_role;

comment on table public.private_chat_conversations is
  'Private, token-scoped customer support conversations. No customer identity, phone, email, or national-ID fields are stored.';
comment on table public.private_chat_messages is
  'Private customer/advisor support transcript. Content is screened before persistence and retained no longer than seven days.';
comment on column public.private_chat_conversations.invite_token_hash is
  'SHA-256 hash of a single-use invitation token; the raw token is never stored.';
comment on column public.private_chat_conversations.session_token_hash is
  'SHA-256 hash of the temporary conversation session token; the raw token is only held by the customer browser session.';
comment on column public.private_chat_conversations.delete_after is
  'A declined conversation is deleted ten minutes after the customer declines unless they change their mind before then.';

create or replace function public.cleanup_private_chats()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
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
do $$
begin
  if exists (select 1 from cron.job where jobname = 'jb-collections-private-chat-cleanup') then
    perform cron.unschedule((select jobid from cron.job where jobname = 'jb-collections-private-chat-cleanup' limit 1));
  end if;
  perform cron.schedule(
    'jb-collections-private-chat-cleanup',
    '* * * * *',
    'select public.cleanup_private_chats();'
  );
end
$$;
