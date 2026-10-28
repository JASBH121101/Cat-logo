-- Private JB Collections chat: scoped public tokens, explicit purchase consent, and admin-only message access.
-- The conversation tables already exist in the connected project; this migration adds the missing secure workflow.
alter table public.private_chat_conversations
  add column if not exists contact_route text,
  add column if not exists purchase_confirmed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.private_chat_conversations'::regclass
      and conname='private_chat_conversations_contact_route_check'
  ) then
    alter table public.private_chat_conversations
      add constraint private_chat_conversations_contact_route_check
      check (contact_route is null or contact_route = any(array['support'::text,'buy'::text]));
  end if;
end;
$$;

create index if not exists private_chat_conversations_admin_inbox_idx
  on public.private_chat_conversations (status, last_message_at desc);
create index if not exists private_chat_messages_conversation_created_idx
  on public.private_chat_messages (conversation_id, created_at);

alter table public.private_chat_conversations enable row level security;
alter table public.private_chat_messages enable row level security;

drop policy if exists "Admins can read private chat conversations" on public.private_chat_conversations;
create policy "Admins can read private chat conversations"
  on public.private_chat_conversations for select to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

drop policy if exists "Admins can read private chat messages" on public.private_chat_messages;
create policy "Admins can read private chat messages"
  on public.private_chat_messages for select to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

grant select on public.private_chat_conversations, public.private_chat_messages to authenticated;
revoke all on public.private_chat_conversations, public.private_chat_messages from anon;
revoke insert, update, delete on public.private_chat_conversations, public.private_chat_messages from authenticated;

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
revoke all on function public.private_chat_contains_sensitive(text) from public, anon, authenticated;

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
  v_uid uuid := auth.uid();
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
  v_uid uuid := auth.uid();
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
  v_uid uuid := auth.uid();
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
  v_uid uuid := auth.uid();
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

revoke all on function public.private_chat_create(text,uuid,text,text,text,text) from public;
revoke all on function public.private_chat_redeem(text,text) from public;
revoke all on function public.private_chat_public_status(text) from public;
revoke all on function public.private_chat_public_messages(text) from public;
revoke all on function public.private_chat_choose_route(text,text) from public;
revoke all on function public.private_chat_record_consent(text,text,text) from public;
revoke all on function public.private_chat_public_send(text,text) from public;
revoke all on function public.private_chat_admin_claim(uuid) from public;
revoke all on function public.private_chat_admin_send(uuid,text) from public;
revoke all on function public.private_chat_admin_extend_after_purchase(uuid) from public;
revoke all on function public.private_chat_admin_close(uuid) from public;

grant execute on function public.private_chat_create(text,uuid,text,text,text,text) to anon, authenticated;
grant execute on function public.private_chat_redeem(text,text) to anon, authenticated;
grant execute on function public.private_chat_public_status(text) to anon, authenticated;
grant execute on function public.private_chat_public_messages(text) to anon, authenticated;
grant execute on function public.private_chat_choose_route(text,text) to anon, authenticated;
grant execute on function public.private_chat_record_consent(text,text,text) to anon, authenticated;
grant execute on function public.private_chat_public_send(text,text) to anon, authenticated;
grant execute on function public.private_chat_admin_claim(uuid) to authenticated;
grant execute on function public.private_chat_admin_send(uuid,text) to authenticated;
grant execute on function public.private_chat_admin_extend_after_purchase(uuid) to authenticated;
grant execute on function public.private_chat_admin_close(uuid) to authenticated;
