-- Harden public chat creation to prevent PII in context metadata and preserve the full decline window.
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
    or coalesce(p_content, '') ~* '(c[eé]dula|pasaporte)[[:space:]:#-]+[A-Z0-9-]{0,15}[0-9][A-Z0-9-]{4,}([^A-Z0-9-]|$)'
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
  if public.private_chat_contains_sensitive(v_name) then
    raise exception using errcode='22023', message='personal_data_not_allowed';
  end if;
  if v_url !~ '^https://(jb-collections\.pages\.dev|jasbh121101\.github\.io)(/|$)' then
    v_url := 'https://jb-collections.pages.dev/';
  end if;
  if public.private_chat_contains_sensitive(v_url) then
    raise exception using errcode='22023', message='personal_data_not_allowed';
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
           session_expires_at=v_delete_after,
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
revoke all on function public.private_chat_contains_sensitive(text) from public, anon, authenticated;
revoke all on function public.private_chat_create(text,uuid,text,text,text,text) from public;
revoke all on function public.private_chat_record_consent(text,text,text) from public;
grant execute on function public.private_chat_create(text,uuid,text,text,text,text) to anon, authenticated;
grant execute on function public.private_chat_record_consent(text,text,text) to anon, authenticated;
