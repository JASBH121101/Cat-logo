import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = String(Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
const PUBLISHABLE_KEY = getKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
const SERVICE_KEY = getKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
const NOTICE_VERSION = "jb-private-chat-2026-10-28-v1";
const PUBLIC_HOSTS = new Set(["https://jb-collections.pages.dev", "https://jasbh121101.github.io", "http://localhost", "https://localhost"]);
const rateBuckets = new Map();

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
    "Vary": "Origin",
  };
  if (PUBLIC_HOSTS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-JB-Client-IP";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return new Response(JSON.stringify(data), { status, headers });
}
function clean(value: unknown, max = 500): string {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, max);
}
function piiDetected(value: unknown): boolean {
  const text = String(value == null ? "" : value);
  const patterns = [
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
    /(?<!\d)(?:\+?505[\s().-]?)?(?:\d[\s().-]?){8}(?!\d)/,
    /\b(?:c[eé]dula(?:\s+de\s+identidad)?|n[uú]mero de identidad|pasaporte)\b\s*(?:(?:es|n[uú]mero|no\.?|#)\s*)?(?::|=)?\s*[A-Z]?\d[\d -]{5,}\b/i,
    /\b(?:tarjeta de cr[eé]dito|n[uú]mero de tarjeta|datos de tarjeta)\b.{0,20}(?:\d[ -]?){12,19}/i,
    /\b(?:cuenta bancaria|n[uú]mero de cuenta|cuenta)\b.{0,20}(?:\d[ -]?){7,20}/i,
    /\b(?:cvv|c[oó]digo de seguridad)\b\s*(?::|=)?\s*\d{3,4}\b/i,
    /\bcontrase[nñ]a\b\s*(?::|=)\s*\S{4,}/i,
    /\b(?:mi direcci[oó]n|mi domicilio|ubicaci[oó]n exacta|vivo en|mi casa queda)\b\s*(?:es|:)?\s*[^,.!?]{4,}/i,
  ];
  return patterns.some((pattern) => pattern.test(text));
}
function sha256(value: string): Promise<string> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
    .then((digest) => [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""));
}
function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function addMinutes(date: Date, minutes: number): string {
  return new Date(date.getTime() + minutes * 60_000).toISOString();
}
function validCatalog(value: unknown): string {
  return ["technology", "perfumery", "collections"].includes(String(value)) ? String(value) : "collections";
}
function safeProductUrl(value: unknown): string {
  const fallback = "https://jb-collections.pages.dev/";
  try {
    const url = new URL(String(value || fallback));
    if (!["https:", "http:"].includes(url.protocol)) return fallback;
    if (!["jb-collections.pages.dev", "jasbh121101.github.io", "localhost"].includes(url.hostname)) return fallback;
    return url.href.slice(0, 500);
  } catch {
    return fallback;
  }
}
function safeTopic(value: unknown): string {
  return ["product", "financing", "credit_card", "other"].includes(String(value)) ? String(value) : "product";
}
function safeConversation(row: Record<string, unknown>) {
  return {
    id: row.id,
    catalog_type: row.catalog_type,
    product_id: row.product_id,
    product_name: row.product_name,
    product_url: row.product_url,
    payment_topic: row.payment_topic,
    status: row.status,
    consent_choice: row.consent_choice,
    consent_at: row.consent_at,
    consent_notice_version: row.consent_notice_version,
    declined_at: row.declined_at,
    delete_after: row.delete_after,
    claimed_by: row.claimed_by,
    claimed_at: row.claimed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_message_at: row.last_message_at,
    invite_expires_at: row.invite_expires_at,
    invite_redeemed_at: row.invite_redeemed_at,
  };
}
async function rest(table: string, query: Record<string, string>, method = "GET", body?: unknown, prefer = ""): Promise<any> {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("SUPABASE_SERVER_NOT_CONFIGURED");
  const url = new URL(SUPABASE_URL + "/rest/v1/" + table);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const headers: Record<string, string> = {
    apikey: SERVICE_KEY,
    Authorization: "Bearer " + SERVICE_KEY,
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(url.href, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    console.error("[private-chat] database request failed", { table, status: response.status });
    throw new Error("DATABASE_REQUEST_FAILED");
  }
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}
async function verifyAdmin(request: Request): Promise<{ id: string; email?: string } | null> {
  const authorization = request.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+$/i.test(authorization) || authorization.length > 6000 || !PUBLISHABLE_KEY) return null;
  const userResponse = await fetch(SUPABASE_URL + "/auth/v1/user", {
    headers: { apikey: PUBLISHABLE_KEY, Authorization: authorization, Accept: "application/json" },
    cache: "no-store",
  }).catch(() => null);
  if (!userResponse?.ok) return null;
  const user = await userResponse.json().catch(() => null);
  const userId = String(user?.id || "");
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
  const admins = await rest("admin_users", { select: "user_id", user_id: "eq." + userId, limit: "1" });
  return Array.isArray(admins) && admins.some((row) => String(row.user_id) === userId)
    ? { id: userId, email: typeof user.email === "string" ? user.email : undefined }
    : null;
}
async function getConversationBySession(sessionToken: string) {
  if (!sessionToken || sessionToken.length > 256) return null;
  const hash = await sha256(sessionToken);
  const rows = await rest("private_chat_conversations", {
    select: "*", session_token_hash: "eq." + hash, limit: "1",
  });
  if (!Array.isArray(rows) || !rows[0]) return null;
  const row = rows[0];
  if (!row.session_expires_at || new Date(row.session_expires_at).getTime() <= Date.now()) return null;
  return row;
}
async function insertMessage(conversationId: string, senderType: string, content: string) {
  const now = new Date().toISOString();
  await rest("private_chat_messages", {}, "POST", {
    conversation_id: conversationId,
    sender_type: senderType,
    content,
    created_at: now,
  }, "return=minimal");
  await rest("private_chat_conversations", { id: "eq." + conversationId }, "PATCH", {
    updated_at: now,
    last_message_at: now,
  }, "return=minimal");
}
async function readMessages(conversationId: string) {
  return await rest("private_chat_messages", {
    select: "id,sender_type,content,created_at",
    conversation_id: "eq." + conversationId,
    order: "created_at.asc",
    limit: "200",
  });
}
function rateLimit(key: string, limit = 12): boolean {
  const now = Date.now();
  const previous = rateBuckets.get(key) || { count: 0, start: now };
  if (now - previous.start > 60 * 60_000) {
    rateBuckets.set(key, { count: 1, start: now });
    return false;
  }
  previous.count += 1;
  rateBuckets.set(key, previous);
  return previous.count > limit;
}
async function createConversation(input: Record<string, unknown>, publicBase: string, includeInvite = false) {
  const now = new Date();
  const conversationId = crypto.randomUUID();
  const sessionToken = includeInvite ? "" : randomToken();
  const inviteToken = includeInvite ? randomToken() : "";
  const row = {
    id: conversationId,
    catalog_type: validCatalog(input.catalog_type),
    product_id: /^[0-9a-f-]{36}$/i.test(String(input.product_id || "")) ? String(input.product_id) : null,
    product_name: clean(input.product_name, 160) || "Consulta general",
    product_url: safeProductUrl(input.product_url),
    payment_topic: safeTopic(input.payment_topic),
    status: "pending_consent",
    invite_token_hash: includeInvite ? await sha256(inviteToken) : null,
    invite_expires_at: includeInvite ? addMinutes(now, 30) : null,
    session_token_hash: includeInvite ? null : await sha256(sessionToken),
    session_expires_at: includeInvite ? null : addMinutes(now, 7 * 24 * 60),
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    last_message_at: now.toISOString(),
  };
  const created = await rest("private_chat_conversations", { select: "*" }, "POST", row, "return=representation");
  if (!Array.isArray(created) || !created[0]) throw new Error("CONVERSATION_CREATE_FAILED");
  const conversation = created[0];
  const response: Record<string, unknown> = { conversation: safeConversation(conversation) };
  if (includeInvite) {
    const publicRoot = publicBase.replace(/\/+$/, "");
    response.invite_token = inviteToken;
    response.invite_url = publicRoot + "/mensajes/?invite=" + encodeURIComponent(inviteToken);
  } else {
    response.session_token = sessionToken;
  }
  return response;
}
async function handler(request: Request): Promise<Response> {
  const origin = request.headers.get("Origin") || "";
  if (!PUBLIC_HOSTS.has(origin)) return json(403, { error: "origin_not_allowed", message: "Origen no permitido." }, origin);
  if (request.method === "OPTIONS") return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-JB-Client-IP",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    }
  });
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" }, origin);
  const rawLength = Number(request.headers.get("Content-Length") || "0");
  if (rawLength > 12_000) return json(413, { error: "request_too_large" }, origin);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json(400, { error: "invalid_json" }, origin); }
  const action = clean(body.action, 32);
  const ip = clean(request.headers.get("X-JB-Client-IP") || "unknown", 80);
  if (["start", "decline_start"].includes(action) && rateLimit(ip, 8)) {
    return json(429, { error: "rate_limited", message: "Recibimos varias solicitudes. Esperá un momento y probá otra vez." }, origin);
  }
  try {
    if (action === "start") {
      const payload = await createConversation({
        catalog_type: body.catalog_type,
        product_id: body.product_id,
        product_name: body.product_name,
        product_url: body.product_url,
        payment_topic: body.payment_topic,
      }, "https://jb-collections.pages.dev");
      const createdConversation = payload.conversation as Record<string, unknown>;
      const now = new Date().toISOString();
      const accepted = await rest("private_chat_conversations", { id: "eq." + createdConversation.id }, "PATCH", {
        status: "pending_advisor",
        consent_choice: "yes",
        consent_notice_version: NOTICE_VERSION,
        consent_at: now,
        updated_at: now,
        last_message_at: now,
      }, "return=representation");
      await insertMessage(String(createdConversation.id), "assistant", "Gracias por aceptar el aviso de privacidad. Contanos qué necesitás y revisaremos tu consulta. Esta aceptación solo autoriza continuar este chat; no es una solicitud de compra ni autorización para compartir tus datos con Go Partners.");
      return json(201, { ...payload, conversation: safeConversation(accepted[0]), messages: await readMessages(String(createdConversation.id)) }, origin);
    }

    if (action === "create_invite") {
      const admin = await verifyAdmin(request);
      if (!admin) return json(403, { error: "admin_only", message: "Solo un administrador autorizado puede crear un enlace." }, origin);
      const payload = await createConversation(body, "https://jb-collections.pages.dev", true);
      return json(201, payload, origin);
    }

    if (action === "redeem") {
      const token = clean(body.invite_token, 256);
      if (token.length < 32) return json(400, { error: "invalid_invite", message: "El enlace no es válido." }, origin);
      const hash = await sha256(token);
      const now = new Date();
      const rows = await rest("private_chat_conversations", {
        select: "*",
        invite_token_hash: "eq." + hash,
        invite_redeemed_at: "is.null",
        invite_expires_at: "gt." + now.toISOString(),
        status: "eq.pending_consent",
        limit: "1",
      });
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row) return json(410, { error: "invite_expired", message: "Este enlace ya fue utilizado o venció. Solicitá uno nuevo." }, origin);
      const sessionToken = randomToken();
      const updated = await rest("private_chat_conversations", {
        id: "eq." + row.id,
        invite_token_hash: "eq." + hash,
        invite_redeemed_at: "is.null",
        invite_expires_at: "gt." + now.toISOString(),
      }, "PATCH", {
        invite_token_hash: null,
        invite_redeemed_at: now.toISOString(),
        session_token_hash: await sha256(sessionToken),
        session_expires_at: addMinutes(now, 7 * 24 * 60),
        updated_at: now.toISOString(),
      }, "return=representation");
      if (!Array.isArray(updated) || !updated[0]) return json(409, { error: "invite_already_used", message: "Este enlace ya fue utilizado. Solicitá uno nuevo." }, origin);
      return json(200, { session_token: sessionToken, conversation: safeConversation(updated[0]), messages: await readMessages(String(updated[0].id)) }, origin);
    }

    if (action === "decline_start") {
      const now = new Date();
      const payload = await createConversation({
        catalog_type: body.catalog_type,
        product_id: body.product_id,
        product_name: body.product_name,
        product_url: body.product_url,
        payment_topic: body.payment_topic,
      }, "https://jb-collections.pages.dev");
      const conversation = payload.conversation as Record<string, unknown>;
      const declinedAt = now.toISOString();
      const deleteAfter = addMinutes(now, 10);
      const updated = await rest("private_chat_conversations", { id: "eq." + conversation.id }, "PATCH", {
        status: "declined_pending_delete",
        consent_choice: "no",
        consent_notice_version: NOTICE_VERSION,
        consent_at: declinedAt,
        declined_at: declinedAt,
        delete_after: deleteAfter,
        session_expires_at: deleteAfter,
        updated_at: declinedAt,
      }, "return=representation");
      return json(201, { session_token: payload.session_token, conversation: safeConversation(updated[0]), delete_after: deleteAfter }, origin);
    }

    const sessionToken = clean(body.session_token, 256);
    const conversation = await getConversationBySession(sessionToken);
    if (["read", "consent", "decline", "change_mind", "send"].includes(action)) {
      if (!conversation) return json(401, { error: "session_expired", message: "La sesión venció o ya no está disponible. Abrí un nuevo enlace para continuar." }, origin);
      const id = String(conversation.id);
      const status = String(conversation.status);

      if (action === "read") {
        return json(200, { conversation: safeConversation(conversation), messages: await readMessages(id) }, origin);
      }
      if (action === "consent") {
        if (status !== "pending_consent") return json(409, { error: "consent_already_resolved", message: "La elección de consentimiento ya fue registrada." }, origin);
        const now = new Date().toISOString();
        const changed = await rest("private_chat_conversations", { id: "eq." + id, status: "eq.pending_consent" }, "PATCH", {
          status: "pending_advisor",
          consent_choice: "yes",
          consent_notice_version: NOTICE_VERSION,
          consent_at: now,
          updated_at: now,
          last_message_at: now,
        }, "return=representation");
        if (!Array.isArray(changed) || !changed[0]) return json(409, { error: "consent_already_resolved" }, origin);
        await insertMessage(id, "assistant", "Gracias por aceptar el aviso de privacidad. Contanos qué necesitás y revisaremos tu consulta. Esta aceptación solo autoriza continuar este chat; no es una solicitud de compra ni autorización para compartir tus datos con Go Partners.");
        return json(200, { conversation: safeConversation(changed[0]), messages: await readMessages(id) }, origin);
      }
      if (action === "decline") {
        if (status !== "pending_consent") return json(409, { error: "consent_already_resolved" }, origin);
        const now = new Date();
        const deleteAfter = addMinutes(now, 10);
        const changed = await rest("private_chat_conversations", { id: "eq." + id, status: "eq.pending_consent" }, "PATCH", {
          status: "declined_pending_delete",
          consent_choice: "no",
          consent_notice_version: NOTICE_VERSION,
          consent_at: now.toISOString(),
          declined_at: now.toISOString(),
          delete_after: deleteAfter,
          session_expires_at: deleteAfter,
          updated_at: now.toISOString(),
          last_message_at: now.toISOString(),
        }, "return=representation");
        await insertMessage(id, "assistant", "Gracias por revisarlo. El chat se cerrará y se eliminará en 10 minutos. No recibirás recordatorios comerciales. Podés cambiar de opinión antes de que termine el contador.");
        return json(200, { conversation: safeConversation(changed[0]), messages: await readMessages(id) }, origin);
      }
      if (action === "change_mind") {
        if (status !== "declined_pending_delete" || !conversation.delete_after || new Date(conversation.delete_after as string).getTime() <= Date.now()) {
          return json(410, { error: "decline_window_expired", message: "El periodo para cambiar de opinión ya terminó." }, origin);
        }
        const now = new Date().toISOString();
        const changed = await rest("private_chat_conversations", { id: "eq." + id, status: "eq.declined_pending_delete" }, "PATCH", {
          status: "pending_advisor",
          consent_choice: "yes",
          consent_notice_version: NOTICE_VERSION,
          consent_at: now,
          declined_at: null,
          delete_after: null,
          session_expires_at: addMinutes(new Date(), 7 * 24 * 60),
          updated_at: now,
          last_message_at: now,
        }, "return=representation");
        await insertMessage(id, "assistant", "Listo, reactivaste el chat. Contanos qué necesitás; esta decisión solo permite conversar y no autoriza a compartir tus datos con Go Partners.");
        return json(200, { conversation: safeConversation(changed[0]), messages: await readMessages(id) }, origin);
      }
      if (action === "send") {
        if (!["pending_advisor", "advisor_active"].includes(status) || conversation.consent_choice !== "yes") {
          return json(403, { error: "chat_not_active", message: "Aceptá primero el aviso para poder escribir." }, origin);
        }
        const content = clean(body.content, 1200);
        if (!content) return json(400, { error: "empty_message", message: "Escribí tu consulta." }, origin);
        if (piiDetected(content)) return json(400, { error: "personal_data_not_needed", message: "Por privacidad, no compartás teléfonos, correos, cédula ni datos financieros por este chat. Para una compra, los datos se pedirán por separado a través del canal oficial del proveedor, con una explicación de su finalidad." }, origin);
        await insertMessage(id, "customer", content);
        return json(201, { conversation: safeConversation(conversation), messages: await readMessages(id) }, origin);
      }
    }

    if (["admin_list", "admin_read", "claim", "admin_send", "close"].includes(action)) {
      const admin = await verifyAdmin(request);
      if (!admin) return json(403, { error: "admin_only", message: "Se requiere una sesión administrativa autorizada." }, origin);
      if (action === "admin_list") {
        const rows = await rest("private_chat_conversations", {
          select: "*",
          status: "in.(pending_consent,pending_advisor,advisor_active,declined_pending_delete)",
          order: "last_message_at.desc",
          limit: "100",
        });
        return json(200, { conversations: Array.isArray(rows) ? rows.map(safeConversation) : [] }, origin);
      }
      const id = clean(body.conversation_id, 80);
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: "invalid_conversation" }, origin);
      const rows = await rest("private_chat_conversations", { select: "*", id: "eq." + id, limit: "1" });
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row) return json(404, { error: "conversation_not_found" }, origin);
      if (action === "admin_read") return json(200, { conversation: safeConversation(row), messages: await readMessages(id) }, origin);
      if (action === "claim") {
        if (row.status !== "pending_advisor" && row.status !== "advisor_active") return json(409, { error: "conversation_not_ready", message: "El cliente aún no ha aceptado o la conversación está cerrada." }, origin);
        if (row.claimed_by && String(row.claimed_by) !== admin.id) return json(409, { error: "already_claimed", message: "Otro asesor ya tomó esta conversación." }, origin);
        const now = new Date().toISOString();
        const changed = await rest("private_chat_conversations", { id: "eq." + id }, "PATCH", {
          status: "advisor_active",
          claimed_by: admin.id,
          claimed_at: now,
          updated_at: now,
          last_message_at: now,
        }, "return=representation");
        if (!row.claimed_by) {
          await insertMessage(id, "assistant", "Excelente, gracias por confiar en JB Collections. Un asesor te atenderá personalmente en cuanto esté disponible. No compartás datos personales por este chat.");
        }
        return json(200, { conversation: safeConversation(changed[0]), messages: await readMessages(id) }, origin);
      }
      if (action === "admin_send") {
        if (String(row.claimed_by || "") !== admin.id || row.status !== "advisor_active") {
          return json(403, { error: "claim_required", message: "Tomá la conversación antes de responder." }, origin);
        }
        const content = clean(body.content, 1200);
        if (!content) return json(400, { error: "empty_message" }, origin);
        if (piiDetected(content)) return json(400, { error: "personal_data_not_needed", message: "No envíes números de identidad, tarjetas ni otros datos personales por este chat." }, origin);
        await insertMessage(id, "advisor", content);
        return json(201, { conversation: safeConversation(row), messages: await readMessages(id) }, origin);
      }
      if (action === "close") {
        const now = new Date().toISOString();
        const closed = await rest("private_chat_conversations", { id: "eq." + id }, "PATCH", {
          status: "closed",
          invite_token_hash: null,
          invite_expires_at: null,
          session_expires_at: addMinutes(new Date(now), 7 * 24 * 60),
          updated_at: now,
          last_message_at: now,
        }, "return=representation");
        return json(200, { conversation: safeConversation(closed[0]) }, origin);
      }
    }
    return json(400, { error: "unknown_action", message: "Acción no válida." }, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error("[private-chat] request failed", { action, error: message });
    return json(503, { error: "private_chat_unavailable", message: "La mensajería privada no está disponible en este momento. Probá otra vez o elegí WhatsApp." }, origin);
  }
}

Deno.serve(handler);
