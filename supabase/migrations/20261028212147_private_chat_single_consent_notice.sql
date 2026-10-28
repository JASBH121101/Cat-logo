create or replace function public.private_chat_choose_route(p_session_token_hash text, p_route text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
declare
  v_row public.private_chat_conversations%rowtype;
  v_route text := lower(coalesce(p_route, ''));
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
    update public.private_chat_conversations
      set contact_route='buy', consent_notice_version='2026-10-28-v2',
          updated_at=now(), last_message_at=now()
      where id=v_row.id;
  end if;

  return jsonb_build_object('ok', true, 'status', case when v_route='support' then 'pending_advisor' else 'pending_consent' end, 'contact_route', v_route);
end;
$function$;