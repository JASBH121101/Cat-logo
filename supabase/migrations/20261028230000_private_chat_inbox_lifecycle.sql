-- Align private-chat lifecycle transitions with the three admin inbox folders.
-- This migration is reviewed in code only; it must be applied to Supabase separately.

create or replace function public.private_chat_admin_claim(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
  v_row public.private_chat_conversations%rowtype;
  v_expiry timestamptz := now() + interval '30 minutes';
begin
  if v_uid is null or not exists (
    select 1 from public.admin_users au where au.user_id = v_uid
  ) then
    raise exception using errcode='42501', message='admin_only';
  end if;

  select c.* into v_row
  from public.private_chat_conversations c
  where c.id = p_conversation_id
  for update;

  if not found then
    raise exception using errcode='P0002', message='conversation_not_found';
  end if;

  if v_row.status = 'advisor_active' and v_row.claimed_by = v_uid then
    if v_row.session_expires_at is null or v_row.session_expires_at <= now() then
      raise exception using errcode='28000', message='conversation_session_expired';
    end if;
    return jsonb_build_object(
      'ok', true, 'status', 'advisor_active',
      'claimed_by', v_uid, 'session_expires_at', v_row.session_expires_at
    );
  end if;

  if v_row.status <> 'pending_advisor' or v_row.claimed_by is not null then
    raise exception using errcode='40001', message='conversation_already_claimed_or_not_pending';
  end if;

  if v_row.session_expires_at is null or v_row.session_expires_at <= now() then
    raise exception using errcode='28000', message='conversation_session_expired';
  end if;

  update public.private_chat_conversations
     set status = 'advisor_active',
         claimed_by = v_uid,
         claimed_at = now(),
         session_expires_at = v_expiry,
         updated_at = now(),
         last_message_at = now()
   where id = p_conversation_id;

  insert into public.private_chat_messages (conversation_id, sender_type, content)
  values (
    p_conversation_id,
    'assistant',
    'Un asesor tomó la conversación. Ya podés continuar por este chat.'
  );

  return jsonb_build_object(
    'ok', true, 'status', 'advisor_active',
    'claimed_by', v_uid, 'session_expires_at', v_expiry
  );
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
  v_content text := trim(regexp_replace(coalesce(p_content, ''), '[[:cntrl:]]', ' ', 'g'));
begin
  if v_uid is null or not exists (
    select 1 from public.admin_users au where au.user_id = v_uid
  ) then
    raise exception using errcode='42501', message='admin_only';
  end if;

  if char_length(v_content) < 1 or char_length(v_content) > 1200 then
    raise exception using errcode='22023', message='invalid_message_length';
  end if;

  if public.private_chat_contains_sensitive(v_content) then
    raise exception using errcode='22023', message='personal_data_not_allowed';
  end if;

  if not exists (
    select 1
    from public.private_chat_conversations c
    where c.id = p_conversation_id
      and c.status = 'advisor_active'
      and c.claimed_by = v_uid
      and c.session_expires_at > now()
      and (c.contact_route = 'support' or (c.contact_route = 'buy' and c.consent_choice = 'yes'))
  ) then
    raise exception using errcode='42501', message='claim_conversation_before_reply_or_session_expired';
  end if;

  insert into public.private_chat_messages (conversation_id, sender_type, content)
  values (p_conversation_id, 'advisor', v_content);

  update public.private_chat_conversations
     set updated_at = now(), last_message_at = now()
   where id = p_conversation_id;

  return jsonb_build_object('ok', true);
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
  if v_uid is null or not exists (
    select 1 from public.admin_users au where au.user_id = v_uid
  ) then
    raise exception using errcode='42501', message='admin_only';
  end if;

  update public.private_chat_conversations
     set purchase_confirmed_at = now(),
         session_expires_at = v_expiry,
         updated_at = now(),
         last_message_at = now()
   where id = p_conversation_id
     and claimed_by = v_uid
     and status = 'advisor_active'
     and contact_route = 'buy'
     and consent_choice = 'yes'
     and purchase_confirmed_at is null
     and session_expires_at > now();

  if not found then
    raise exception using errcode='42501', message='claim_active_buy_conversation_before_confirming_purchase';
  end if;

  insert into public.private_chat_messages (conversation_id, sender_type, content)
  values (
    p_conversation_id,
    'assistant',
    '¡Gracias por tu compra! Este chat seguirá disponible durante 30 minutos adicionales por si querés consultar algo más o adquirir otro producto. Después, el enlace dejará de funcionar.'
  );

  return jsonb_build_object('ok', true, 'session_expires_at', v_expiry);
end;
$function$;

create or replace function public.private_chat_admin_finalize_expired()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
  v_finalized integer := 0;
begin
  if v_uid is null or not exists (
    select 1 from public.admin_users au where au.user_id = v_uid
  ) then
    raise exception using errcode='42501', message='admin_only';
  end if;

  update public.private_chat_conversations c
     set status = 'closed',
         session_token_hash = null,
         invite_token_hash = null,
         session_expires_at = case
           when c.session_expires_at is null or c.session_expires_at > now() then now()
           else c.session_expires_at
         end,
         delete_after = null,
         updated_at = now(),
         last_message_at = now()
   where
     (
       c.status = 'advisor_active'
       and greatest(
         coalesce(c.session_expires_at, '-infinity'::timestamptz),
         coalesce(c.claimed_at + interval '30 minutes', '-infinity'::timestamptz)
       ) <= now()
     )
     or (
       c.status = 'declined_pending_delete'
       and c.delete_after is not null
       and c.delete_after <= now()
     )
     or (
       c.status in ('pending_consent', 'pending_advisor')
       and coalesce(c.session_expires_at, c.invite_expires_at) <= now()
     );

  get diagnostics v_finalized = row_count;
  return jsonb_build_object('ok', true, 'finalized_count', v_finalized);
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
       set consent_choice = 'yes',
           consent_notice_version = v_notice,
           consent_at = now(),
           declined_at = null,
           delete_after = null,
           status = 'pending_advisor',
           updated_at = now(),
           last_message_at = now()
     where id = v_row.id;

    insert into public.private_chat_messages (conversation_id, sender_type, content)
    values (
      v_row.id,
      'assistant',
      'Gracias por confirmar. Ya avisamos al equipo de JB Collections y un asesor continuará contigo por este chat. El registro de compra se completará mediante el procedimiento correspondiente de Go Partners.'
    );

    return jsonb_build_object('ok', true, 'status', 'pending_advisor', 'choice', 'yes');
  elsif v_choice = 'no' and v_row.status = 'pending_consent' then
    v_delete_after := now() + interval '10 minutes';
    update public.private_chat_conversations
       set consent_choice = 'no',
           declined_at = now(),
           delete_after = v_delete_after,
           session_expires_at = v_delete_after,
           status = 'declined_pending_delete',
           updated_at = now(),
           last_message_at = now()
     where id = v_row.id;

    insert into public.private_chat_messages (conversation_id, sender_type, content)
    values (
      v_row.id,
      'assistant',
      'Gracias por avisarnos. El acceso a este chat se cerrará en 10 minutos. Durante ese plazo podés cambiar de opinión con el botón «Cambiar de opinión». El historial puede conservarse por un máximo de 7 días; no te enviaremos recordatorios comerciales. Por seguridad, no compartás aquí datos personales ni de pago.'
    );

    return jsonb_build_object(
      'ok', true, 'status', 'declined_pending_delete',
      'choice', 'no', 'delete_after', v_delete_after
    );
  end if;

  raise exception using errcode='22023', message='invalid_consent_choice';
end;
$function$;


-- Preserve the existing 30-minute window for conversations already claimed
-- before this migration, while allowing a later confirmed purchase extension.
update public.private_chat_conversations
   set session_expires_at = greatest(
         coalesce(session_expires_at, '-infinity'::timestamptz),
         claimed_at + interval '30 minutes'
       ),
       updated_at = now()
 where status = 'advisor_active'
   and claimed_at is not null
   and (session_expires_at is null or session_expires_at < claimed_at + interval '30 minutes');

-- The customer-facing 10-minute window revokes access; it does not erase the
-- conversation immediately. The existing policy retains history up to 7 days.
-- The cron job calls this function once per minute.
create or replace function public.cleanup_private_chats()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  finalized_count integer := 0;
  deleted_count integer := 0;
begin
  update public.private_chat_conversations c
     set status = 'closed',
         session_token_hash = null,
         invite_token_hash = null,
         session_expires_at = case
           when c.session_expires_at is null or c.session_expires_at > now() then now()
           else c.session_expires_at
         end,
         delete_after = null,
         updated_at = now(),
         last_message_at = now()
   where (
       c.status = 'declined_pending_delete'
       and c.delete_after is not null
       and c.delete_after <= now()
     )
     or (
       c.status = 'advisor_active'
       and greatest(
         coalesce(c.session_expires_at, '-infinity'::timestamptz),
         coalesce(c.claimed_at + interval '30 minutes', '-infinity'::timestamptz)
       ) <= now()
     )
     or (
       c.status in ('pending_consent', 'pending_advisor')
       and coalesce(c.session_expires_at, c.invite_expires_at) <= now()
     );
  get diagnostics finalized_count = row_count;

  delete from public.private_chat_conversations
  where created_at <= now() - interval '7 days';
  get diagnostics deleted_count = row_count;

  return finalized_count + deleted_count;
end;
$function$;

revoke all on function public.cleanup_private_chats() from public, anon, authenticated;
revoke all on function public.private_chat_admin_finalize_expired() from public, anon;
grant execute on function public.private_chat_admin_finalize_expired() to authenticated;

revoke all on function public.private_chat_admin_claim(uuid) from public, anon;
grant execute on function public.private_chat_admin_claim(uuid) to authenticated;

revoke all on function public.private_chat_admin_send(uuid, text) from public, anon;
grant execute on function public.private_chat_admin_send(uuid, text) to authenticated;

revoke all on function public.private_chat_admin_extend_after_purchase(uuid) from public, anon;
grant execute on function public.private_chat_admin_extend_after_purchase(uuid) to authenticated;

revoke all on function public.private_chat_record_consent(text, text, text) from public;
grant execute on function public.private_chat_record_consent(text, text, text) to anon, authenticated;
