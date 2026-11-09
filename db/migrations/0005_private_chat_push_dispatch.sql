-- JB Collections only. Server-to-server push dispatch gate.
-- Copy of the source SHA-256 digest only; the raw dispatch secret remains in Cloudflare Pages secrets.
BEGIN;
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anonymous, authenticated;
CREATE TABLE IF NOT EXISTS private.admin_push_dispatch_config (
  config_id text PRIMARY KEY CHECK (config_id='shared'),
  secret_hash text NOT NULL CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE private.admin_push_dispatch_config FROM PUBLIC, anonymous, authenticated;
INSERT INTO private.admin_push_dispatch_config(config_id,secret_hash)
VALUES ('shared','8be94308dcd95a48bf4dd912abe580cc8f8ebae0d8c83c4c96bc8a04b3987fc0')
ON CONFLICT (config_id) DO UPDATE SET secret_hash=EXCLUDED.secret_hash, updated_at=now();

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

REVOKE ALL ON FUNCTION public.private_chat_claim_push_delivery(text,text) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.private_chat_finish_push_delivery(text,uuid,boolean) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.private_chat_claim_push_delivery(text,text) TO anonymous;
GRANT EXECUTE ON FUNCTION public.private_chat_finish_push_delivery(text,uuid,boolean) TO anonymous;

INSERT INTO public.schema_migrations(version,name)
VALUES ('0005','private_chat_push_dispatch')
ON CONFLICT (version) DO NOTHING;
COMMIT;
