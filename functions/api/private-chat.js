import { sendWebPush } from "../_shared/web-push.js";

const SUPABASE_URL = "https://uwqnoadelnnplcvqqlyz.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_ml5eoKXvotG4ZfoG6P19FA_57YQ8t2p";
const PUBLIC_CHAT_URL = "https://jb-collections.pages.dev";
const ALLOWED_ORIGINS = new Set([
  "https://jb-collections.pages.dev",
  "https://jasbh121101.github.io",
  "https://localhost",
  "http://localhost"
]);
const rateBuckets = new Map();
const RATE_LIMITS = { start: 8, redeem: 12, status: 35, messages: 35, route: 10, consent: 10, send: 24 };

function allowedOrigin(origin) {
  return Boolean(origin) && ALLOWED_ORIGINS.has(origin);
}
function cors(origin) {
  const headers = {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Vary": "Origin"
  };
  if (allowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return headers;
}
function json(status, body, origin) {
  return new Response(JSON.stringify(body), { status, headers: cors(origin) });
}
function clean(value, max = 500) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}
async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}
function rateLimit(request, action) {
  const now = Date.now();
  const ip = clean(request.headers.get("CF-Connecting-IP") || "unknown", 64);
  const key = action + ":" + ip;
  const limit = RATE_LIMITS[action] || 12;
  const current = rateBuckets.get(key);
  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    if (rateBuckets.size > 3000) {
      for (const [bucketKey, bucket] of rateBuckets) if (bucket.resetAt <= now) rateBuckets.delete(bucketKey);
      while (rateBuckets.size > 2500) rateBuckets.delete(rateBuckets.keys().next().value);
    }
    return false;
  }
  current.count += 1;
  return current.count > limit;
}
async function rpc(name, params) {
  const response = await fetch(SUPABASE_URL + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_PUBLISHABLE_KEY,
      "Authorization": "Bearer " + SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(params)
  });
  let data = null;
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    const message = clean(data?.message || data?.hint || data?.error || "", 180);
    const error = new Error(message || "chat_service_error");
    error.status = response.status;
    throw error;
  }
  return data;
}
async function dispatchAdminPush(sessionHash, env = {}) {
  const dispatchSecret = String(env.PUSH_DISPATCH_SECRET || "");
  const vapidPrivateJwk = env.VAPID_PRIVATE_JWK;
  const vapidPublicKey = String(env.VAPID_PUBLIC_KEY || "");
  if (!dispatchSecret || !vapidPrivateJwk || !vapidPublicKey) return;

  let claim;
  try {
    claim = await rpc("private_chat_claim_push_delivery", {
      p_dispatch_secret: dispatchSecret,
      p_session_token_hash: sessionHash
    });
  } catch (error) {
    console.warn("JB admin push claim failed:", clean(error?.message || "unknown error", 120));
    return;
  }
  if (!claim?.sent || !claim.conversation_id || !Array.isArray(claim.subscriptions) || !claim.subscriptions.length) return;

  const isPurchase = claim.contact_route === "buy";
  const payload = {
    title: isPurchase ? "Cliente confirmó que quiere comprar" : "Nueva solicitud de atención",
    body: (String(claim.product_name || "Consulta general") + ": el cliente está listo para continuar.").slice(0, 180),
    url: PUBLIC_CHAT_URL + "/admin.html?open=messages",
    conversationId: claim.conversation_id,
    tag: "jb-private-chat-" + claim.conversation_id
  };

  const deliveries = await Promise.all(claim.subscriptions.map(async subscription => {
    try {
      const result = await sendWebPush(subscription, payload, {
        privateJwk: vapidPrivateJwk,
        publicKey: vapidPublicKey,
        subject: PUBLIC_CHAT_URL + "/"
      });
      if (result.expired) {
        console.warn("JB admin push endpoint expired:", clean(subscription.id || "unknown", 60));
      }
      if (!result.ok) {
        console.warn("JB admin push delivery failed:", clean(result.reason || String(result.status), 120));
      }
      return result;
    } catch (error) {
      console.warn("JB admin push delivery error:", clean(error?.message || "unknown error", 120));
      return { ok: false };
    }
  }));
  const delivered = deliveries.some(result => result?.ok);

  try {
    await rpc("private_chat_finish_push_delivery", {
      p_dispatch_secret: dispatchSecret,
      p_conversation_id: claim.conversation_id,
      p_delivered: delivered
    });
  } catch (error) {
    console.warn("JB admin push completion failed:", clean(error?.message || "unknown error", 120));
  }
}

function scheduleAdminPush(context, sessionHash) {
  const operation = dispatchAdminPush(sessionHash, context?.env || {});
  if (typeof context?.waitUntil === "function") {
    context.waitUntil(operation);
    return Promise.resolve();
  }
  return operation;
}

function errorResponse(error, origin) {
  const message = String(error?.message || "");
  if (/personal_data_not_allowed/i.test(message)) {
    return json(422, {
      ok: false,
      error: "personal_data_not_allowed",
      message: "Por seguridad, no envíes teléfonos, correos, cédulas ni datos de pago en este chat. Si compartiste alguno por error, volvé a escribir tu consulta sin esos datos."
    }, origin);
  }
  if (/invalid_or_expired_invite/i.test(message)) {
    return json(410, { ok: false, error: "invite_expired", message: "Este enlace ya venció o fue utilizado. Volvé al catálogo para iniciar una nueva conversación." }, origin);
  }
  if (/chat_session_expired|chat_session_expired_or_not_ready/i.test(message)) {
    return json(410, { ok: false, error: "session_expired", message: "La sesión de este chat venció o ya se cerró. Podés iniciar otra conversación desde el catálogo." }, origin);
  }
  if (/already_claimed|not_pending|claim_conversation|admin_only|conversation_not_found/i.test(message)) {
    return json(409, { ok: false, error: "conversation_state_changed", message: "El estado de la conversación cambió. Actualizá el panel y volvé a intentarlo." }, origin);
  }
  if (/invalid_message_length/i.test(message)) {
    return json(422, { ok: false, error: "invalid_message_length", message: "El mensaje debe contener entre 1 y 1200 caracteres." }, origin);
  }
  if (/route_not_available|consent_decision_not_available|invalid_chat_route|invalid_consent_choice/i.test(message)) {
    return json(409, { ok: false, error: "chat_state_changed", message: "La conversación ya cambió de estado. Actualizá la pantalla para continuar." }, origin);
  }
  console.warn("JB private chat RPC failed:", message || "unknown error");
  return json(error?.status === 429 ? 429 : 503, {
    ok: false,
    error: "chat_service_unavailable",
    message: "No pudimos procesar el chat en este momento. Intentá de nuevo en un momento."
  }, origin);
}

export async function onRequest(context) {
  const request = context.request;
  const origin = request.headers.get("Origin") || "";
  if (request.method === "OPTIONS") {
    if (!allowedOrigin(origin)) return json(403, { ok: false, error: "origin_not_allowed" }, "");
    return new Response(null, { status: 204, headers: cors(origin) });
  }
  if (request.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" }, origin);
  if (!allowedOrigin(origin)) return json(403, { ok: false, error: "origin_not_allowed" }, "");
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > 8000) return json(413, { ok: false, error: "request_too_large" }, origin);

  let body;
  try { body = await request.json(); } catch {
    return json(400, { ok: false, error: "invalid_json" }, origin);
  }
  const action = clean(body?.action, 24).toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(RATE_LIMITS, action)) {
    return json(400, { ok: false, error: "invalid_action" }, origin);
  }
  if (rateLimit(request, action)) {
    return json(429, { ok: false, error: "rate_limited", message: "Hiciste demasiadas solicitudes seguidas. Esperá un minuto e intentá de nuevo." }, origin);
  }

  try {
    if (action === "start") {
      const catalogType = clean(body.catalogType, 20).toLowerCase();
      const productId = body.productId == null || body.productId === "" ? null : String(body.productId);
      const productName = clean(body.productName || "Consulta general", 160);
      const productUrl = clean(body.productUrl || PUBLIC_CHAT_URL + "/", 500);
      const paymentTopic = clean(body.paymentTopic || "product", 20).toLowerCase();
      if (!["technology", "perfumery", "collections"].includes(catalogType)) {
        return json(400, { ok: false, error: "invalid_catalog_type" }, origin);
      }
      if (productId && !isUuid(productId)) return json(400, { ok: false, error: "invalid_product" }, origin);
      if (!["product", "financing", "credit_card", "other"].includes(paymentTopic)) {
        return json(400, { ok: false, error: "invalid_payment_topic" }, origin);
      }
      const inviteToken = randomToken();
      const inviteHash = await sha256Hex(inviteToken);
      const result = await rpc("private_chat_create", {
        p_catalog_type: catalogType,
        p_product_id: productId,
        p_product_name: productName,
        p_product_url: productUrl,
        p_payment_topic: paymentTopic,
        p_invite_token_hash: inviteHash
      });
      const conversationId = result?.conversation_id || result?.id;
      if (!conversationId) throw new Error("chat_service_invalid_create_response");
      return json(200, {
        ok: true,
        conversationId,
        inviteExpiresAt: result.invite_expires_at,
        inviteUrl: PUBLIC_CHAT_URL + "/mensajes.html?invite=" + inviteToken
      }, origin);
    }

    if (action === "redeem") {
      const inviteToken = clean(body.inviteToken, 128);
      if (!/^[a-f0-9]{64}$/i.test(inviteToken)) {
        return json(410, { ok: false, error: "invite_expired", message: "El enlace no es válido. Volvé al catálogo para iniciar otra conversación." }, origin);
      }
      const sessionToken = randomToken();
      const result = await rpc("private_chat_redeem", {
        p_invite_token_hash: await sha256Hex(inviteToken),
        p_session_token_hash: await sha256Hex(sessionToken)
      });
      return json(200, { ok: true, sessionToken, conversation: result }, origin);
    }

    const sessionToken = clean(body.sessionToken, 128);
    if (!/^[a-f0-9]{64}$/i.test(sessionToken)) {
      return json(410, { ok: false, error: "session_expired", message: "Esta sesión no es válida. Volvé al catálogo para iniciar otra conversación." }, origin);
    }
    const sessionHash = await sha256Hex(sessionToken);

    if (action === "status") {
      return json(200, { ok: true, conversation: await rpc("private_chat_public_status", { p_session_token_hash: sessionHash }) }, origin);
    }
    if (action === "messages") {
      return json(200, { ok: true, messages: await rpc("private_chat_public_messages", { p_session_token_hash: sessionHash }) }, origin);
    }
    if (action === "route") {
      const route = clean(body.route, 12).toLowerCase();
      if (!["support", "buy"].includes(route)) return json(400, { ok: false, error: "invalid_route" }, origin);
      const result = await rpc("private_chat_choose_route", { p_session_token_hash: sessionHash, p_route: route });
      if (route === "support") await scheduleAdminPush(context, sessionHash);
      return json(200, { ok: true, result }, origin);
    }
    if (action === "consent") {
      const choice = clean(body.choice, 8).toLowerCase();
      if (!["yes", "no"].includes(choice)) return json(400, { ok: false, error: "invalid_choice" }, origin);
      const result = await rpc("private_chat_record_consent", {
        p_session_token_hash: sessionHash,
        p_choice: choice,
        p_notice_version: "2026-10-28-v1"
      });
      if (choice === "yes") await scheduleAdminPush(context, sessionHash);
      return json(200, { ok: true, result }, origin);
    }
    if (action === "send") {
      const content = clean(body.content, 1200);
      return json(200, { ok: true, result: await rpc("private_chat_public_send", { p_session_token_hash: sessionHash, p_content: content }) }, origin);
    }
    return json(400, { ok: false, error: "invalid_action" }, origin);
  } catch (error) {
    return errorResponse(error, origin);
  }
}
