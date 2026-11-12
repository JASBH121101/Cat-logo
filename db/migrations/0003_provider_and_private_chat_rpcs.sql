-- JB Collections only. RPCs ported from the verified Supabase source definitions.
-- Auth identity is resolved through admin_users.neon_auth_user_id; legacy UUIDs
-- remain the owner IDs for historical rows and foreign keys.
BEGIN;

CREATE OR REPLACE FUNCTION public.current_catalog_admin_legacy_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, auth
AS $function$
  SELECT au.user_id
  FROM public.admin_users au
  WHERE au.neon_auth_user_id = auth.user_id()
  LIMIT 1;
$function$;

create or replace function public.private_chat_contains_sensitive(p_content text)
returns boolean
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $function$
  select
    coalesce(p_content, '') ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}'
    or coalesce(p_content, '') ~ '(?:\+?505[[:space:].()\-]?)?([0-9][[:space:].()\-]?){8,}'
    or coalesce(p_content, '') ~* '(c[eé]dula|n[uú]mero de identidad|pasaporte)[^[:alnum:]]{0,12}(n[uú]mero|no\.?|#|:|=|es)[^[:alnum:]]{0,5}[A-Z0-9-]{5,}'
    or coalesce(p_content, '') ~* '(c[eé]dula|pasaporte)[[:space:]:#-]+[A-Z0-9-]{6,}'
    or coalesce(p_content, '') ~* '(mi tarjeta( bancaria)?|n[uú]mero de tarjeta|tarjeta bancaria)[^0-9]{0,20}([0-9][ -]?){12,19}'
    or coalesce(p_content, '') ~* '(mi cuenta bancaria|n[uú]mero de cuenta)[^[:alnum:]]{0,12}[A-Z0-9-]{8,}'
    or coalesce(p_content, '') ~* '(mi direcci[oó]n|mi domicilio|vivo en|mi casa queda)[[:space:]]*(es|:)?[[:space:]]*[^,.!?[:space:]]+([[:space:]]+[^,.!?[:space:]]+)+';
$function$;

create or replace function public.private_chat_create(
  p_catalog_type text,
  p_product_id uuid,
  p_product_name text,
  p_product_url text,
  p_payment_topic text,
  p_invite_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
declare
  v_id uuid;
  v_expiry timestamptz := now() + interval '30 minutes';
  v_catalog text := lower(coalesce(p_catalog_type, ''));
  v_name text := left(trim(regexp_replace(coalesce(p_product_name, 'Consulta general'), '[[:cntrl:]]', ' ', 'g')), 160);
  v_url text := trim(coalesce(p_product_url, 'https://jb-collections.pages.dev/'));
  v_topic text := lower(coalesce(p_payment_topic, 'product'));
begin
  if v_catalog not in ('technology','perfumery','collections') then
    raise exception using errcode='22023', message='invalid_catalog_type';
  end if;
  if v_topic not in ('product','financing','credit_card','other') then
    raise exception using errcode='22023', message='invalid_payment_topic';
  end if;
  if coalesce(p_invite_token_hash,'') !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='22023', message='invalid_invite_token';
  end if;
  if v_name = '' then v_name := 'Consulta general'; end if;
  if v_url !~ '^https://(jb-collections\.pages\.dev|jasbh121101\.github\.io)(/|$)' then
    v_url := 'https://jb-collections.pages.dev/';
  end if;
  if p_product_id is not null then
    if v_catalog = 'collections' or not exists (
      select 1 from public.products p
      where p.id = p_product_id
        and p.is_published = true
        and p.workflow_status = 'published'
        and p.deleted_at is null
        and p.catalog_type = v_catalog
    ) then
      raise exception using errcode='22023', message='product_not_available_for_chat';
    end if;
  end if;

  insert into public.private_chat_conversations
    (catalog_type, product_id, product_name, product_url, payment_topic, status,
     invite_token_hash, invite_expires_at, contact_route)
  values
    (v_catalog, p_product_id, v_name, v_url, v_topic, 'pending_consent',
     p_invite_token_hash, v_expiry, null)
  returning id into v_id;

  insert into public.private_chat_messages (conversation_id, sender_type, content)
  values (v_id, 'assistant',
    '¡Hola! Este es el canal privado de JB Collections. Elegí si necesitás atención personal o querés iniciar una compra. No compartás aquí cédula, teléfono, correo ni datos de pago. El enlace inicial es temporal y el historial se conserva hasta 7 días.');

  return jsonb_build_object('ok', true, 'conversation_id', v_id, 'invite_expires_at', v_expiry);
end;
$function$;

create or replace function public.private_chat_redeem(
  p_invite_token_hash text,
  p_session_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
declare
  v_row public.private_chat_conversations%rowtype;
  v_expiry timestamptz := now() + interval '30 minutes';
begin
  if coalesce(p_invite_token_hash,'') !~ '^[a-f0-9]{64}$'
     or coalesce(p_session_token_hash,'') !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='28000', message='invalid_or_expired_invite';
  end if;

  update public.private_chat_conversations c
     set invite_redeemed_at = now(),
         invite_token_hash = null,
         session_token_hash = p_session_token_hash,
         session_expires_at = v_expiry,
         updated_at = now()
   where c.invite_token_hash = p_invite_token_hash
     and c.invite_redeemed_at is null
     and c.invite_expires_at > now()
     and c.status = 'pending_consent'
  returning c.* into v_row;

  if not found then
    raise exception using errcode='28000', message='invalid_or_expired_invite';
  end if;

  return jsonb_build_object(
    'ok', true,
    'conversation_id', v_row.id,
    'catalog_type', v_row.catalog_type,
    'product_name', v_row.product_name,
    'payment_topic', v_row.payment_topic,
    'status', v_row.status,
    'contact_route', v_row.contact_route,
    'session_expires_at', v_row.session_expires_at
  );
end;
$function$;

create or replace function public.private_chat_public_status(p_session_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
declare
  v_row public.private_chat_conversations%rowtype;
begin
  if coalesce(p_session_token_hash,'') !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='28000', message='chat_session_expired';
  end if;

  select c.* into v_row
  from public.private_chat_conversations c
  where c.session_token_hash = p_session_token_hash
    and c.session_expires_at > now()
    and c.status <> 'closed'
    and (c.delete_after is null or c.delete_after > now());

  if not found then
    raise exception using errcode='28000', message='chat_session_expired';
  end if;

  return jsonb_build_object(
    'ok', true,
    'conversation_id', v_row.id,
    'catalog_type', v_row.catalog_type,
    'product_name', v_row.product_name,
    'payment_topic', v_row.payment_topic,
    'status', v_row.status,
    'contact_route', v_row.contact_route,
    'consent_choice', v_row.consent_choice,
    'session_expires_at', v_row.session_expires_at,
    'delete_after', v_row.delete_after,
    'purchase_confirmed_at', v_row.purchase_confirmed_at
  );
end;
$function$;

create or replace function public.private_chat_public_messages(p_session_token_hash text)
returns table(id uuid, sender_type text, content text, created_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
begin
  if coalesce(p_session_token_hash,'') !~ '^[a-f0-9]{64}$'
     or not exists (
       select 1 from public.private_chat_conversations c
       where c.session_token_hash = p_session_token_hash
         and c.session_expires_at > now()
         and c.status <> 'closed'
         and (c.delete_after is null or c.delete_after > now())
     ) then
    raise exception using errcode='28000', message='chat_session_expired';
  end if;

  return query
    select m.id, m.sender_type, m.content, m.created_at
    from public.private_chat_messages m
    join public.private_chat_conversations c on c.id = m.conversation_id
    where c.session_token_hash = p_session_token_hash
      and c.created_at > now() - interval '7 days'
    order by m.created_at asc
    limit 100;
end;
$function$;

create or replace function public.private_chat_choose_route(p_session_token_hash text, p_route text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
declare
  v_row public.private_chat_conversations%rowtype;
  v_route text := lower(coalesce(p_route, ''));
  v_notice text;
begin
  select c.* into v_row
  from public.private_chat_conversations c
  where c.session_token_hash = p_session_token_hash
    and c.session_expires_at > now()
    and c.status = 'pending_consent'
    and c.contact_route is null
    and c.delete_after is null
  for update;

  if not found then
    raise exception using errcode='28000', message='chat_route_not_available';
  end if;
  if v_route not in ('support','buy') then
    raise exception using errcode='22023', message='invalid_chat_route';
  end if;

  if v_route = 'support' then
    update public.private_chat_conversations
      set contact_route='support', status='pending_advisor', updated_at=now(), last_message_at=now()
      where id=v_row.id;
    insert into public.private_chat_messages (conversation_id, sender_type, content)
    values (v_row.id, 'assistant',
      'Recibimos tu solicitud de atención. Un asesor de JB Collections te responderá personalmente por este chat en cuanto esté disponible.');
  else
    v_notice := 'Antes de continuar con una compra: Go Partners solicita nombre completo y número de celular, y también requiere la cédula para registrar al cliente según el procedimiento que nos describiste. Estos datos se utilizan para el registro y la gestión de la operación en Go Partners; este chat no necesita que los escribás aquí. Si decidís avanzar, te indicaremos el procedimiento autorizado para completar el registro. El historial de este chat se conserva hasta 7 días. Conversar no te obliga a comprar. ¿Deseás continuar?';
    update public.private_chat_conversations
      set contact_route='buy', consent_notice_version='2026-10-28-v1',
          updated_at=now(), last_message_at=now()
      where id=v_row.id;
    insert into public.private_chat_messages (conversation_id, sender_type, content)
    values (v_row.id, 'assistant', v_notice);
  end if;

  return jsonb_build_object('ok', true, 'status', case when v_route='support' then 'pending_advisor' else 'pending_consent' end, 'contact_route', v_route);
end;
$function$;

create or replace function public.private_chat_record_consent(
  p_session_token_hash text,
  p_choice text,
  p_notice_version text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
declare
  v_row public.private_chat_conversations%rowtype;
  v_choice text := lower(coalesce(p_choice, ''));
  v_notice text := left(coalesce(p_notice_version, '2026-10-28-v1'), 60);
  v_delete_after timestamptz;
begin
  select c.* into v_row
  from public.private_chat_conversations c
  where c.session_token_hash = p_session_token_hash
    and c.session_expires_at > now()
    and c.contact_route = 'buy'
    and (
      (c.status = 'pending_consent' and c.consent_choice is null)
      or (c.status = 'declined_pending_delete' and c.delete_after > now() and v_choice = 'yes')
    )
  for update;

  if not found then
    raise exception using errcode='28000', message='consent_decision_not_available';
  end if;
  if v_choice = 'yes' then
    update public.private_chat_conversations
       set consent_choice='yes', consent_notice_version=v_notice, consent_at=now(),
           declined_at=null, delete_after=null, status='pending_advisor',
           updated_at=now(), last_message_at=now()
     where id=v_row.id;
    insert into public.private_chat_messages (conversation_id, sender_type, content)
    values (v_row.id, 'assistant',
      'Gracias por confirmar. Ya avisamos al equipo de JB Collections y un asesor continuará contigo por este chat. Por tu seguridad, no enviés cédula, teléfono ni datos de pago aquí; el registro de compra se completa por el procedimiento correspondiente de Go Partners.');
    return jsonb_build_object('ok',true,'status','pending_advisor','choice','yes');
  elsif v_choice = 'no' and v_row.status = 'pending_consent' then
    v_delete_after := now() + interval '10 minutes';
    update public.private_chat_conversations
       set consent_choice='no', declined_at=now(), delete_after=v_delete_after,
           status='declined_pending_delete', updated_at=now(), last_message_at=now()
     where id=v_row.id;
    insert into public.private_chat_messages (conversation_id, sender_type, content)
    values (v_row.id, 'assistant',
      'Gracias por avisarnos. Este chat se cerrará y se eliminará en 10 minutos. Durante ese tiempo podés cambiar de opinión con el botón «Cambiar de opinión». No te enviaremos recordatorios comerciales.');
    return jsonb_build_object('ok',true,'status','declined_pending_delete','choice','no','delete_after',v_delete_after);
  end if;

  raise exception using errcode='22023', message='invalid_consent_choice';
end;
$function$;

create or replace function public.private_chat_public_send(p_session_token_hash text, p_content text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
declare
  v_row public.private_chat_conversations%rowtype;
  v_content text := trim(regexp_replace(coalesce(p_content, ''), '[[:cntrl:]]', ' ', 'g'));
begin
  if char_length(v_content) < 1 or char_length(v_content) > 1200 then
    raise exception using errcode='22023', message='invalid_message_length';
  end if;
  if public.private_chat_contains_sensitive(v_content) then
    raise exception using errcode='22023', message='personal_data_not_allowed';
  end if;

  select c.* into v_row
  from public.private_chat_conversations c
  where c.session_token_hash = p_session_token_hash
    and c.session_expires_at > now()
    and c.status in ('pending_advisor','advisor_active')
    and c.consent_choice is distinct from 'no'
    and (c.contact_route = 'support' or (c.contact_route = 'buy' and c.consent_choice = 'yes'))
  for update;

  if not found then
    raise exception using errcode='28000', message='chat_session_expired_or_not_ready';
  end if;

  insert into public.private_chat_messages (conversation_id, sender_type, content)
  values (v_row.id, 'customer', v_content);

  update public.private_chat_conversations
    set updated_at=now(), last_message_at=now()
    where id=v_row.id;

  return jsonb_build_object('ok',true);
end;
$function$;

create or replace function public.private_chat_admin_claim(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
declare
  v_uid uuid := public.current_catalog_admin_legacy_id();
  v_row public.private_chat_conversations%rowtype;
begin
  if v_uid is null or not exists (select 1 from public.admin_users au where au.user_id = v_uid) then
    raise exception using errcode='42501', message='admin_only';
  end if;

  select c.* into v_row from public.private_chat_conversations c
   where c.id=p_conversation_id for update;
  if not found then raise exception using errcode='P0002', message='conversation_not_found'; end if;

  if v_row.status='advisor_active' and v_row.claimed_by=v_uid then
    return jsonb_build_object('ok',true,'status','advisor_active','claimed_by',v_uid);
  end if;
  if v_row.status <> 'pending_advisor' or v_row.claimed_by is not null then
    raise exception using errcode='40001', message='conversation_already_claimed_or_not_pending';
  end if;

  update public.private_chat_conversations
    set status='advisor_active', claimed_by=v_uid, claimed_at=now(), updated_at=now()
    where id=p_conversation_id;
  insert into public.private_chat_messages (conversation_id,sender_type,content)
  values (p_conversation_id,'assistant','Un asesor tomó la conversación. Ya podés continuar por este chat.');
  return jsonb_build_object('ok',true,'status','advisor_active','claimed_by',v_uid);
end;
$function$;

create or replace function public.private_chat_admin_send(p_conversation_id uuid, p_content text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
declare
  v_uid uuid := public.current_catalog_admin_legacy_id();
  v_content text := trim(regexp_replace(coalesce(p_content,''), '[[:cntrl:]]', ' ', 'g'));
begin
  if v_uid is null or not exists (select 1 from public.admin_users au where au.user_id=v_uid) then
    raise exception using errcode='42501', message='admin_only';
  end if;
  if char_length(v_content) < 1 or char_length(v_content) > 1200 then
    raise exception using errcode='22023', message='invalid_message_length';
  end if;
  if public.private_chat_contains_sensitive(v_content) then
    raise exception using errcode='22023', message='personal_data_not_allowed';
  end if;
  if not exists (
    select 1 from public.private_chat_conversations c
    where c.id=p_conversation_id and c.status='advisor_active' and c.claimed_by=v_uid
  ) then
    raise exception using errcode='42501', message='claim_conversation_before_reply';
  end if;

  insert into public.private_chat_messages (conversation_id,sender_type,content)
  values (p_conversation_id,'advisor',v_content);
  update public.private_chat_conversations set updated_at=now(),last_message_at=now() where id=p_conversation_id;
  return jsonb_build_object('ok',true);
end;
$function$;

create or replace function public.private_chat_admin_extend_after_purchase(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
declare
  v_uid uuid := public.current_catalog_admin_legacy_id();
  v_expiry timestamptz := now() + interval '30 minutes';
begin
  if v_uid is null or not exists (select 1 from public.admin_users au where au.user_id=v_uid) then
    raise exception using errcode='42501', message='admin_only';
  end if;
  update public.private_chat_conversations
     set purchase_confirmed_at=now(), session_expires_at=v_expiry, updated_at=now(), last_message_at=now()
   where id=p_conversation_id and claimed_by=v_uid and status='advisor_active' and contact_route='buy';
  if not found then raise exception using errcode='42501', message='claim_buy_conversation_before_confirming_purchase'; end if;

  insert into public.private_chat_messages (conversation_id,sender_type,content)
  values (p_conversation_id,'assistant','¡Gracias por tu compra! Este chat seguirá disponible durante 30 minutos adicionales por si querés consultar algo más o adquirir otro producto. Después, el enlace dejará de funcionar.');
  return jsonb_build_object('ok',true,'session_expires_at',v_expiry);
end;
$function$;

create or replace function public.private_chat_admin_close(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
declare
  v_uid uuid := public.current_catalog_admin_legacy_id();
begin
  if v_uid is null or not exists (select 1 from public.admin_users au where au.user_id=v_uid) then
    raise exception using errcode='42501', message='admin_only';
  end if;
  update public.private_chat_conversations
     set status='closed', session_token_hash=null, session_expires_at=now(),
         invite_token_hash=null, delete_after=null, updated_at=now(), last_message_at=now()
   where id=p_conversation_id and (claimed_by is null or claimed_by=v_uid);
  if not found then raise exception using errcode='42501', message='conversation_claimed_by_another_advisor'; end if;
  return jsonb_build_object('ok',true,'status','closed');
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_provider_product_review(
  p_product_id uuid,
  p_review_payload jsonb,
  p_sync_catalog_availability boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := public.current_catalog_admin_legacy_id();
  v_product public.products%rowtype;
  v_snapshot jsonb;
  v_variant jsonb;
  v_group jsonb;
  v_color jsonb;
  v_config_key text;
  v_color_name text;
  v_config_status text;
  v_color_status text;
  v_updated_variants jsonb := '[]'::jsonb;
  v_variant_count integer := 0;
  v_color_count integer := 0;
  v_provider_availability text;
  v_provider_price_usd numeric(12,2);
  v_provider_price_nio numeric(14,2);
  v_sync boolean := coalesce(p_sync_catalog_availability, true);
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users au WHERE au.user_id = v_uid
  ) THEN
    RAISE EXCEPTION USING errcode='42501', message='admin_only';
  END IF;

  IF p_review_payload IS NULL OR jsonb_typeof(p_review_payload) <> 'object' THEN
    RAISE EXCEPTION USING errcode='22023', message='invalid_provider_review_payload';
  END IF;

  SELECT p.* INTO v_product
    FROM public.products p
   WHERE p.id = p_product_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode='P0002', message='product_not_found';
  END IF;

  v_provider_availability := p_review_payload->>'provider_availability';
  IF v_provider_availability IS NULL OR v_provider_availability NOT IN ('available', 'on_order', 'out_of_stock') THEN
    RAISE EXCEPTION USING errcode='22023', message='provider_availability_must_be_confirmed';
  END IF;

  v_provider_price_usd := NULLIF(p_review_payload->>'provider_price_usd', '')::numeric;
  v_provider_price_nio := NULLIF(p_review_payload->>'provider_price_nio', '')::numeric;
  IF v_provider_price_usd IS NOT NULL AND v_provider_price_usd < 0 THEN
    RAISE EXCEPTION USING errcode='22023', message='invalid_provider_price_usd';
  END IF;
  IF v_provider_price_nio IS NOT NULL AND v_provider_price_nio < 0 THEN
    RAISE EXCEPTION USING errcode='22023', message='invalid_provider_price_nio';
  END IF;

  v_snapshot := p_review_payload->'provider_variant_snapshot';
  IF v_snapshot IS NULL OR jsonb_typeof(v_snapshot) <> 'array' THEN
    RAISE EXCEPTION USING errcode='22023', message='provider_variant_snapshot_must_be_array';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(v_snapshot) AS g(element)
     WHERE nullif(g.element->>'config_key', '') IS NULL
        OR coalesce(g.element->>'provider_availability', 'unknown')
          NOT IN ('available', 'on_order', 'out_of_stock')
  ) THEN
    RAISE EXCEPTION USING errcode='22023', message='provider_configuration_availability_must_be_confirmed';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(v_snapshot) AS g(element)
     WHERE g.element ? 'colors'
       AND jsonb_typeof(g.element->'colors') <> 'array'
  ) THEN
    RAISE EXCEPTION USING errcode='22023', message='provider_configuration_colors_must_be_array';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(v_snapshot) AS g(element)
      CROSS JOIN LATERAL jsonb_array_elements(coalesce(g.element->'colors', '[]'::jsonb)) AS c(element)
     WHERE coalesce(c.element->>'provider_availability', 'unknown')
       NOT IN ('available', 'on_order', 'out_of_stock')
        OR nullif(c.element->>'color', '') IS NULL
  ) THEN
    RAISE EXCEPTION USING errcode='22023', message='provider_color_availability_must_be_confirmed';
  END IF;

  -- Record the review and its immutable snapshot in one transaction.
  INSERT INTO public.product_provider_status (
    product_id, provider_name, provider_product_id, provider_url,
    provider_price_usd, provider_price_nio, provider_availability,
    review_notes, provider_variant_snapshot, last_reviewed_at, reviewed_by,
    created_at, updated_at
  ) VALUES (
    p_product_id,
    coalesce(nullif(trim(p_review_payload->>'provider_name'), ''), 'GoPartner'),
    nullif(trim(p_review_payload->>'provider_product_id'), ''),
    nullif(trim(p_review_payload->>'provider_url'), ''),
    v_provider_price_usd,
    v_provider_price_nio,
    v_provider_availability,
    nullif(trim(p_review_payload->>'review_notes'), ''),
    v_snapshot,
    now(),
    v_uid,
    now(),
    now()
  )
  ON CONFLICT (product_id) DO UPDATE SET
    provider_name = EXCLUDED.provider_name,
    provider_product_id = EXCLUDED.provider_product_id,
    provider_url = EXCLUDED.provider_url,
    provider_price_usd = EXCLUDED.provider_price_usd,
    provider_price_nio = EXCLUDED.provider_price_nio,
    provider_availability = EXCLUDED.provider_availability,
    review_notes = EXCLUDED.review_notes,
    provider_variant_snapshot = EXCLUDED.provider_variant_snapshot,
    last_reviewed_at = now(),
    reviewed_by = v_uid,
    updated_at = now();

  IF v_sync THEN
    IF jsonb_typeof(coalesce(v_product.variants, '[]'::jsonb)) <> 'array' THEN
      RAISE EXCEPTION USING errcode='22023', message='catalog_variants_must_be_array';
    END IF;

    FOR v_variant IN
      SELECT value FROM jsonb_array_elements(coalesce(v_product.variants, '[]'::jsonb))
    LOOP
      IF jsonb_typeof(v_variant) <> 'object' THEN
        RAISE EXCEPTION USING errcode='22023', message='catalog_variant_is_invalid';
      END IF;

      v_config_key :=
        regexp_replace(lower(coalesce(v_variant->>'ram', '')), '[^a-z0-9]+', '', 'g')
        || '|' ||
        regexp_replace(lower(coalesce(v_variant->>'storage', v_variant->>'capacity',
          CASE WHEN v_variant ? 'storage_value'
            THEN coalesce(v_variant->>'storage_value', '') || ' ' || coalesce(v_variant->>'storage_unit', 'GB')
            ELSE '' END, '')), '[^a-z0-9]+', '', 'g');

      SELECT element INTO v_group
        FROM jsonb_array_elements(v_snapshot) AS g(element)
       WHERE g.element->>'config_key' = v_config_key
       LIMIT 1;

      IF v_group IS NULL THEN
        RAISE EXCEPTION USING errcode='22023',
          message='provider_review_missing_configuration:' || v_config_key;
      END IF;

      v_config_status := v_group->>'provider_availability';
      v_variant := v_variant || jsonb_build_object(
        'configuration_availability',
        CASE WHEN v_config_status = 'on_order' THEN 'order' ELSE v_config_status END
      );

      v_color_name := trim(coalesce(v_variant->>'color', ''));
      IF v_color_name <> '' THEN
        SELECT element INTO v_color
          FROM jsonb_array_elements(coalesce(v_group->'colors', '[]'::jsonb)) AS c(element)
         WHERE lower(trim(coalesce(c.element->>'color', ''))) = lower(v_color_name)
         LIMIT 1;

        IF v_color IS NULL THEN
          RAISE EXCEPTION USING errcode='22023',
            message='provider_review_missing_color:' || v_config_key || ':' || v_color_name;
        END IF;

        v_color_status := v_color->>'provider_availability';
        v_variant := v_variant || jsonb_build_object(
          'availability',
          CASE WHEN v_color_status = 'on_order' THEN 'order' ELSE v_color_status END
        );
        v_color_count := v_color_count + 1;
      END IF;

      v_updated_variants := v_updated_variants || jsonb_build_array(v_variant);
      v_variant_count := v_variant_count + 1;
      v_group := NULL;
      v_color := NULL;
    END LOOP;

    UPDATE public.products
       SET availability = v_provider_availability,
           variants = v_updated_variants,
           updated_at = now(),
           updated_by = v_uid
     WHERE id = p_product_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'review_saved', true,
    'catalog_availability_synced', v_sync,
    'product_availability', v_provider_availability,
    'variant_count', v_variant_count,
    'color_count', v_color_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.current_catalog_admin_legacy_id() FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.private_chat_contains_sensitive(text) FROM PUBLIC, anonymous, authenticated;
GRANT EXECUTE ON FUNCTION public.private_chat_create(text,uuid,text,text,text,text) TO anonymous;
GRANT EXECUTE ON FUNCTION public.private_chat_redeem(text,text) TO anonymous;
GRANT EXECUTE ON FUNCTION public.private_chat_public_status(text) TO anonymous;
GRANT EXECUTE ON FUNCTION public.private_chat_public_messages(text) TO anonymous;
GRANT EXECUTE ON FUNCTION public.private_chat_choose_route(text,text) TO anonymous;
GRANT EXECUTE ON FUNCTION public.private_chat_record_consent(text,text,text) TO anonymous;
GRANT EXECUTE ON FUNCTION public.private_chat_public_send(text,text) TO anonymous;
REVOKE ALL ON FUNCTION public.private_chat_create(text,uuid,text,text,text,text) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.private_chat_redeem(text,text) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.private_chat_public_status(text) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.private_chat_public_messages(text) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.private_chat_choose_route(text,text) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.private_chat_record_consent(text,text,text) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.private_chat_public_send(text,text) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.private_chat_admin_claim(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.private_chat_admin_send(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.private_chat_admin_extend_after_purchase(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.private_chat_admin_close(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.private_chat_admin_claim(uuid) FROM PUBLIC, anonymous;
REVOKE ALL ON FUNCTION public.private_chat_admin_send(uuid,text) FROM PUBLIC, anonymous;
REVOKE ALL ON FUNCTION public.private_chat_admin_extend_after_purchase(uuid) FROM PUBLIC, anonymous;
REVOKE ALL ON FUNCTION public.private_chat_admin_close(uuid) FROM PUBLIC, anonymous;
REVOKE ALL ON FUNCTION public.confirm_provider_product_review(uuid,jsonb,boolean) FROM PUBLIC, anonymous;
GRANT EXECUTE ON FUNCTION public.confirm_provider_product_review(uuid,jsonb,boolean) TO authenticated;

INSERT INTO public.schema_migrations(version,name)
VALUES ('0003','provider_and_private_chat_rpcs')
ON CONFLICT (version) DO NOTHING;

COMMIT;
