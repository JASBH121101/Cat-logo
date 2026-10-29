create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.admin_push_dispatch_config (
  config_id text primary key check (config_id = 'shared'),
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now()
);
revoke all on table private.admin_push_dispatch_config from public, anon, authenticated;

create table if not exists public.admin_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://'),
  p256dh text not null,
  auth_secret text not null,
  expiration_time timestamptz,
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.admin_push_subscriptions enable row level security;
revoke all on public.admin_push_subscriptions from anon, public;
grant select, insert, update, delete on public.admin_push_subscriptions to authenticated;
drop policy if exists "Admins manage own push subscriptions" on public.admin_push_subscriptions;
create policy "Admins manage own push subscriptions"
  on public.admin_push_subscriptions
  for all to authenticated
  using (
    user_id = (select auth.uid())
    and exists (select 1 from public.admin_users au where au.user_id = (select auth.uid()))
  )
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.admin_users au where au.user_id = (select auth.uid()))
  );

alter table public.private_chat_conversations
  add column if not exists admin_push_claimed_at timestamptz,
  add column if not exists admin_push_notified_at timestamptz;

create or replace function public.private_chat_claim_push_delivery(
  p_dispatch_secret text,
  p_session_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, extensions, private, pg_temp
as $function$
declare
  v_expected_hash text;
  v_row record;
  v_subscriptions jsonb;
begin
  select c.secret_hash into v_expected_hash
  from private.admin_push_dispatch_config c
  where c.config_id = 'shared';

  if v_expected_hash is null
     or encode(extensions.digest(convert_to(coalesce(p_dispatch_secret, ''), 'UTF8'), 'sha256'), 'hex') <> v_expected_hash then
    raise exception using errcode = '42501', message = 'push_dispatch_not_authorized';
  end if;

  if coalesce(p_session_token_hash, '') !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'sent', false, 'reason', 'invalid_session');
  end if;

  select c.id, c.product_name, c.contact_route, c.consent_choice
    into v_row
  from public.private_chat_conversations c
  where c.session_token_hash = p_session_token_hash
    and c.status = 'pending_advisor'
    and c.admin_push_notified_at is null
    and (c.admin_push_claimed_at is null or c.admin_push_claimed_at < now() - interval '2 minutes')
    and (
      c.contact_route = 'support'
      or (c.contact_route = 'buy' and c.consent_choice = 'yes')
    )
  for update;

  if not found then
    return jsonb_build_object('ok', true, 'sent', false, 'reason', 'nothing_to_notify');
  end if;

  select jsonb_agg(jsonb_build_object(
    'id', s.id,
    'endpoint', s.endpoint,
    'p256dh', s.p256dh,
    'auth', s.auth_secret
  ))
  into v_subscriptions
  from public.admin_push_subscriptions s;

  if coalesce(jsonb_array_length(v_subscriptions), 0) = 0 then
    return jsonb_build_object('ok', true, 'sent', false, 'reason', 'no_subscriptions');
  end if;

  update public.private_chat_conversations
    set admin_push_claimed_at = now()
  where id = v_row.id;

  return jsonb_build_object(
    'ok', true,
    'sent', true,
    'conversation_id', v_row.id,
    'product_name', coalesce(v_row.product_name, 'Consulta general'),
    'contact_route', v_row.contact_route,
    'subscriptions', v_subscriptions
  );
end;
$function$;

create or replace function public.private_chat_finish_push_delivery(
  p_dispatch_secret text,
  p_conversation_id uuid,
  p_delivered boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, extensions, private, pg_temp
as $function$
declare
  v_expected_hash text;
begin
  select c.secret_hash into v_expected_hash
  from private.admin_push_dispatch_config c
  where c.config_id = 'shared';

  if v_expected_hash is null
     or encode(extensions.digest(convert_to(coalesce(p_dispatch_secret, ''), 'UTF8'), 'sha256'), 'hex') <> v_expected_hash then
    raise exception using errcode = '42501', message = 'push_dispatch_not_authorized';
  end if;

  update public.private_chat_conversations
    set admin_push_notified_at = case when coalesce(p_delivered, false) then now() else admin_push_notified_at end,
        admin_push_claimed_at = null
  where id = p_conversation_id
    and admin_push_notified_at is null;

  return jsonb_build_object('ok', true, 'delivered', coalesce(p_delivered, false));
end;
$function$;

revoke all on function public.private_chat_claim_push_delivery(text, text) from public, authenticated;
revoke all on function public.private_chat_finish_push_delivery(text, uuid, boolean) from public, authenticated;
grant execute on function public.private_chat_claim_push_delivery(text, text) to anon;
grant execute on function public.private_chat_finish_push_delivery(text, uuid, boolean) to anon;
