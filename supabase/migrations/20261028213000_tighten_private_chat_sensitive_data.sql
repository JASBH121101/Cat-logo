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
    or coalesce(p_content, '') ~* '(mi tarjeta( bancaria)?|n[uú]mero de tarjeta|tarjeta (bancaria|de crédito|de débito))[^0-9]{0,20}([0-9][ -]?){12,19}'
    or coalesce(p_content, '') ~* '(mi cuenta bancaria|n[uú]mero de cuenta)[^[:alnum:]]{0,12}[A-Z0-9-]{8,}'
    or coalesce(p_content, '') ~* '(mi direcci[oó]n|mi domicilio|vivo en|mi casa queda)[[:space:]]*(es|:)?[[:space:]]*[^,.!?[:space:]]+([[:space:]]+[^,.!?[:space:]]+)+';
$function$;
revoke all on function public.private_chat_contains_sensitive(text) from public, anon, authenticated;
