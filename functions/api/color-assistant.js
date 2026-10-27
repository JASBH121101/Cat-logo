const SUPABASE_URL = "https://uwqnoadelnnplcvqqlyz.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_ml5eoKXvotG4ZfoG6P19FA_57YQ8t2p";
const TEXT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const ALLOWED_ORIGINS = new Set(["https://jb-collections.pages.dev", "https://localhost", "http://localhost"]);
const MAX_IMAGE_DATA_URL = 5600000;
const rateBuckets = new Map();

function corsHeaders(origin) {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "Vary": "Origin" };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return headers;
}
function respond(status, data, origin, extra = {}) {
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8", ...extra }
  });
}
function clean(value, max) {
  return String(value == null ? "" : value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max || 300);
}
function parseModelValue(output) {
  if (output && output.response && typeof output.response === "object") return output.response;
  let source = "";
  if (output && typeof output.response === "string") source = output.response;
  else if (output && typeof output.output_text === "string") source = output.output_text;
  else if (output && typeof output.result === "string") source = output.result;
  if (!source) return null;
  try { return JSON.parse(source); } catch {}
  const start = source.indexOf("{"), end = source.lastIndexOf("}");
  if (start >= 0 && end > start) { try { return JSON.parse(source.slice(start, end + 1)); } catch {} }
  return null;
}
function rateLimited(ip) {
  const key = ip || "unknown", now = Date.now(), current = rateBuckets.get(key);
  if (!current || now - current.start >= 60000) {
    rateBuckets.set(key, { start: now, count: 1 });
    if (rateBuckets.size > 1500) {
      for (const entry of rateBuckets.entries()) if (now - entry[1].start >= 60000) rateBuckets.delete(entry[0]);
    }
    return false;
  }
  if (current.count >= 10) return true;
  current.count += 1;
  return false;
}
async function verifyAdmin(request) {
  const authorization = request.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+$/i.test(authorization) || authorization.length > 6000) return { ok: false, status: 401 };
  let userResponse;
  try {
    userResponse = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: authorization, Accept: "application/json" }, cache: "no-store"
    });
  } catch { return { ok: false, status: 503 }; }
  if (!userResponse.ok) return { ok: false, status: 401 };
  let user;
  try { user = await userResponse.json(); } catch { return { ok: false, status: 401 }; }
  if (!user || !/^[0-9a-f-]{36}$/i.test(String(user.id || ""))) return { ok: false, status: 401 };
  const url = new URL(SUPABASE_URL + "/rest/v1/admin_users");
  url.searchParams.set("select", "user_id"); url.searchParams.set("user_id", "eq." + user.id); url.searchParams.set("limit", "1");
  try {
    const adminResponse = await fetch(url, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: authorization, Accept: "application/json" }, cache: "no-store"
    });
    if (!adminResponse.ok) return { ok: false, status: 503 };
    const rows = await adminResponse.json();
    return { ok: Array.isArray(rows) && rows.some(row => String(row.user_id) === String(user.id)), status: 403 };
  } catch { return { ok: false, status: 503 }; }
}
export async function onRequest({ request, env }) {
  const origin = request.headers.get("Origin") || "";
  if (origin && !ALLOWED_ORIGINS.has(origin)) return respond(403, { error: "origin_not_allowed", message: "Origen no permitido." }, origin);
  if (request.method === "OPTIONS") return respond(204, null, origin);
  if (request.method !== "POST") return respond(405, { error: "method_not_allowed", message: "Usá POST para analizar un color." }, origin, { Allow: "POST, OPTIONS" });
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 5900000) return respond(413, { error: "payload_too_large", message: "La fotografía es demasiado grande." }, origin);
  let body;
  try { body = await request.json(); } catch { return respond(400, { error: "invalid_json", message: "No se pudo leer la consulta." }, origin); }
  const query = clean(body && body.query, 320), productContext = clean(body && body.productContext, 180);
  const imageDataUrl = String(body && body.imageDataUrl || "");
  if (!query && !imageDataUrl) return respond(400, { error: "empty_query", message: "Escribí una referencia o adjuntá una fotografía." }, origin);
  if (imageDataUrl && (imageDataUrl.length > MAX_IMAGE_DATA_URL || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=\r\n]+$/i.test(imageDataUrl))) {
    return respond(imageDataUrl.length > MAX_IMAGE_DATA_URL ? 413 : 415, { error: "invalid_image", message: "Usá una foto JPG, PNG o WebP de tamaño moderado." }, origin);
  }
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || "unknown";
  if (rateLimited(ip)) return respond(429, { error: "rate_limited", message: "Llegaste al límite temporal de consultas. Esperá un minuto y volvé a intentar." }, origin);
  const auth = await verifyAdmin(request);
  if (!auth.ok) {
    const message = auth.status === 401 ? "Volvé a iniciar sesión como administrador." :
      auth.status === 403 ? "Esta función solo está disponible para administradores autorizados." :
      "No se pudo validar la sesión. Intentá nuevamente.";
    return respond(auth.status, { error: auth.status === 401 ? "admin_auth_required" : auth.status === 403 ? "admin_only" : "auth_unavailable", message }, origin);
  }
  if (!env || !env.AI || typeof env.AI.run !== "function") return respond(503, { error: "ai_not_configured", message: "El servicio de IA de colores no está conectado todavía." }, origin);
  const isImage = Boolean(imageDataUrl);
  const instruction = "Respondé exclusivamente con JSON con name (nombre corto del tono en español o nombre comercial probable), hex (#RRGGBB), aliases (hasta 6), confidence (estimación no calibrada 0-1) y explanation (frase breve). No afirmés que un nombre/código es oficial a menos que haya evidencia verificable en el propio texto. No tenés navegación ni acceso a bases oficiales: un código del fabricante debe tratarse como sugerencia no verificada. Para fotografía, estimá el color principal del producto, no el fondo ni reflejos evidentes. Si no podés identificarlo claramente, devolvé name 'Por confirmar', hex '#777777', aliases [] y explicá la incertidumbre.";
  const prompt = "Marca/modelo: " + (productContext || "No indicado") + "\nConsulta/referencia: " + (query || "Analizar el color principal del producto en la fotografía.") + "\nDevolvé nombre útil, HEX aproximado y alias; la sugerencia no es una identificación oficial.";
  try {
    const input = isImage
      ? { messages: [{ role: "system", content: instruction }, { role: "user", content: prompt }], image: Array.from(atob(String(imageDataUrl).replace(/^data:image\/[^;]+;base64,/i, "")), character => character.charCodeAt(0)), max_tokens: 320, temperature: 0.15 }
      : { messages: [{ role: "system", content: instruction }, { role: "user", content: prompt }], max_tokens: 320, temperature: 0.15 };
    const output = await env.AI.run(isImage ? VISION_MODEL : TEXT_MODEL, input);
    const parsed = parseModelValue(output), name = clean(parsed && parsed.name, 80);
    let hex = clean(parsed && parsed.hex, 12).toUpperCase();
    if (hex && !hex.startsWith("#")) hex = "#" + hex;
    if (!name || !/^#[0-9A-F]{6}$/.test(hex)) return respond(422, { error: "color_not_identified", message: "La IA no devolvió un nombre y HEX válidos. Probá otra foto o agregá marca, modelo y código." }, origin);
    const aliases = Array.isArray(parsed.aliases) ? [...new Set(parsed.aliases.map(value => clean(value, 45)).filter(value => value && value.toLowerCase() !== name.toLowerCase()))].slice(0, 6) : [];
    const rawConfidence = Number(parsed.confidence);
    const confidence = Number.isFinite(rawConfidence) ? Math.max(0, Math.min(1, rawConfidence)) : (isImage ? 0.55 : 0.3);
    const explanation = clean(parsed.explanation, 240) || (isImage ? "Estimación visual; el acabado y la iluminación pueden alterar el tono." : "Sugerencia de IA; no se contrastó con una ficha oficial en tiempo real.");
    return respond(200, { name, hex, aliases, confidence, basis: isImage ? "visual_estimate" : "ai_suggestion", officialVerified: false, explanation,
      note: isImage ? "El HEX representa el color visto en la foto; no es una medición de laboratorio." : "No se consultó una base oficial en tiempo real; verificá el código del fabricante antes de publicarlo."
    }, origin);
  } catch (error) {
    console.error("JB color assistant failed:", error instanceof Error ? error.message : "unknown error");
    return respond(503, { error: "color_ai_unavailable", message: "No se pudo consultar la IA de colores ahora. Intentá de nuevo en unos minutos." }, origin);
  }
}
