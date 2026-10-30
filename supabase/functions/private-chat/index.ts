import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = String(Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
const SERVICE_KEY = getKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
const PUBLIC_HOSTS = new Set([
  "https://jb-collections.pages.dev",
  "https://jasbh121101.github.io",
  "http://localhost",
  "https://localhost",
]);
const ALLOWED_ACTIONS = new Set(["push_claim", "push_finish"]);
const MAX_BODY_BYTES = 12_000;
const RATE_LIMIT_PER_HOUR = 12;
const rateBuckets = new Map<string, { count: number; start: number }>();

function getKey(jsonName: string, legacyName: string): string {
  const legacy = Deno.env.get(legacyName);
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get(jsonName) || "{}");
    return String(keys.default || "");
  } catch {
    return "";
  }
}

function json(status: number, data: unknown, origin = ""): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Vary": "Origin",
  };
  if (PUBLIC_HOSTS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, apikey, X-JB-Client-IP";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function clean(value: unknown, max = 500): string {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, max);
}

function rateLimited(key: string): boolean {
  const now = Date.now();
  const current = rateBuckets.get(key);
  if (!current || now - current.start >= 60 * 60_000) {
    rateBuckets.set(key, { count: 1, start: now });
    if (rateBuckets.size > 1000) {
      for (const [entryKey, entry] of rateBuckets.entries()) {
        if (now - entry.start >= 60 * 60_000) rateBuckets.delete(entryKey);
      }
    }
    return false;
  }
  current.count += 1;
  return current.count > RATE_LIMIT_PER_HOUR;
}

async function serviceRpc(name: string, params: Record<string, unknown>): Promise<any> {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("SUPABASE_SERVER_NOT_CONFIGURED");
  const response = await fetch(SUPABASE_URL + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: "Bearer " + SERVICE_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(params),
  });
  const text = await response.text();
  if (!response.ok) {
    console.error("[private-chat] privileged RPC failed", { name, status: response.status });
    throw new Error("PRIVILEGED_RPC_FAILED");
  }
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function handler(request: Request): Promise<Response> {
  const origin = request.headers.get("Origin") || "";
  if (request.method === "OPTIONS") {
    if (!PUBLIC_HOSTS.has(origin)) return json(403, { error: "origin_not_allowed" });
    return new Response(null, { status: 204, headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, X-JB-Client-IP",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    } });
  }
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
  // Origin is only a browser/CORS boundary, not authentication. Every permitted
  // operation below also requires the server-held dispatch secret at the RPC.
  if (!PUBLIC_HOSTS.has(origin)) return json(403, { error: "origin_not_allowed" });

  let rawBody: string;
  try { rawBody = await request.text(); } catch {
    return json(400, { error: "invalid_json" }, origin);
  }
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return json(413, { error: "request_too_large" }, origin);
  }
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid_object");
    body = parsed as Record<string, unknown>;
  } catch {
    return json(400, { error: "invalid_json" }, origin);
  }

  const action = clean(body.action, 32);
  // All customer-chat actions are handled by the Cloudflare Pages API and
  // token-scoped Supabase RPCs. This Edge Function is deliberately restricted
  // to the two internal Web Push operations; in particular, no legacy "start"
  // route may create a conversation or grant purchase consent.
  if (!ALLOWED_ACTIONS.has(action)) {
    return json(404, { error: "action_not_supported", message: "Este endpoint solo admite operaciones internas de notificación." }, origin);
  }

  const clientIp = clean(request.headers.get("X-JB-Client-IP") || "unknown", 80);
  if (rateLimited("push-dispatch:" + clientIp)) {
    return json(429, { error: "rate_limited", message: "Esperá un momento antes de volver a intentar." }, origin);
  }

  const dispatchSecret = clean(body.dispatch_secret, 512);
  if (!dispatchSecret) return json(403, { error: "push_dispatch_not_authorized" }, origin);

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json(503, { error: "push_service_not_configured" }, origin);
    }
    if (action === "push_claim") {
      const sessionHash = clean(body.session_token_hash, 64).toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(sessionHash)) return json(400, { error: "invalid_session" }, origin);
      const result = await serviceRpc("private_chat_claim_push_delivery", {
        p_dispatch_secret: dispatchSecret,
        p_session_token_hash: sessionHash,
      });
      return json(200, result, origin);
    }

    const conversationId = clean(body.conversation_id, 80);
    if (!/^[0-9a-f-]{36}$/i.test(conversationId)) return json(400, { error: "invalid_conversation" }, origin);
    const result = await serviceRpc("private_chat_finish_push_delivery", {
      p_dispatch_secret: dispatchSecret,
      p_conversation_id: conversationId,
      p_delivered: body.delivered === true,
    });
    return json(200, result, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error("[private-chat] push request failed", { action, error: clean(message, 120) });
    return json(503, { error: "push_service_unavailable", message: "Las notificaciones no están disponibles en este momento." }, origin);
  }
}

Deno.serve(handler);
