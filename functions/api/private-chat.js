const SUPABASE_FUNCTION_URL = "https://uwqnoadelnnplcvqqlyz.supabase.co/functions/v1/private-chat";
const PUBLISHABLE_KEY = "sb_publishable_ml5eoKXvotG4ZfoG6P19FA_57YQ8t2p";
const ALLOWED_ORIGINS = new Set([
  "https://jb-collections.pages.dev",
  "https://jasbh121101.github.io",
  "http://localhost",
  "https://localhost"
]);

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin") || "";
  if (!ALLOWED_ORIGINS.has(origin)) {
    return Response.json({ error: "origin_not_allowed", message: "Origen no permitido." }, { status: 403 });
  }
  const length = Number(request.headers.get("Content-Length") || "0");
  if (length > 12000) return Response.json({ error: "request_too_large" }, { status: 413 });

  let body;
  try { body = await request.json(); }
  catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }

  const headers = {
    "Content-Type": "application/json",
    "Origin": origin,
    "apikey": PUBLISHABLE_KEY,
    "X-JB-Client-IP": request.headers.get("CF-Connecting-IP") || "unknown"
  };
  const authorization = request.headers.get("Authorization");
  if (authorization && /^Bearer\s+\S+$/i.test(authorization) && authorization.length < 6000) {
    headers.Authorization = authorization;
  }
  let upstream;
  try {
    upstream = await fetch(SUPABASE_FUNCTION_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
  } catch {
    return Response.json(
      { error: "private_chat_unavailable", message: "La mensajería privada no está disponible en este momento. Probá otra vez o elegí WhatsApp." },
      { status: 503, headers: { "Access-Control-Allow-Origin": origin, "Vary": "Origin", "Cache-Control": "no-store" } }
    );
  }
  const responseBody = await upstream.text();
  const responseHeaders = new Headers({
    "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  return new Response(responseBody, { status: upstream.status, headers: responseHeaders });
}

export async function onRequestOptions({ request }) {
  const origin = request.headers.get("Origin") || "";
  if (!ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    }
  });
}
