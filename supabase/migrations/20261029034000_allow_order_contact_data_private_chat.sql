-- Allow the customer data needed for Go Partners order registration in the private chat.
-- Keep blocking data that is not needed in the chat: email addresses, home addresses,
-- full payment-card numbers, and bank-account numbers.
create or replace function public.private_chat_contains_sensitive(p_content text)
returns boolean
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $function$
  select
    coalesce(p_content, '') ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}'
    or coalesce(p_content, '') ~* '(c[oó]digo de seguridad|cvv|cvc|n[uú]mero de tarjeta|tarjeta (bancaria|de cr[eé]dito|de d[eé]bito))[^0-9]{0,24}([0-9][ -]?){3,19}'
    or coalesce(p_content, '') ~* '(mi cuenta bancaria|n[uú]mero de cuenta)[^[:alnum:]]{0,12}[A-Z0-9-]{8,}'
    or coalesce(p_content, '') ~* '(mi direcci[oó]n|mi domicilio|vivo en|mi casa queda)[[:space:]]*(es|:)?[[:space:]]*[^,.!?[:space:]]+([[:space:]]+[^,.!?[:space:]]+)+';
$function$;

revoke all on function public.private_chat_contains_sensitive(text) from public, anon, authenticated;
