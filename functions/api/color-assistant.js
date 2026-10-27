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

function normalizeLibraryValue(value) {
  return clean(value, 180)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/[^a-z0-9#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanLibraryEntry(value) {
  if (!value || typeof value !== "object") return null;
  const name = clean(value.name, 80);
  const hex = clean(value.hex, 10).toUpperCase();
  if (!name || !/^#[0-9A-F]{6}$/.test(hex)) return null;
  const aliases = Array.isArray(value.aliases)
    ? [...new Set(value.aliases.map(alias => clean(alias, 80)).filter(Boolean))].slice(0, 20)
    : [];
  return {
    name,
    name_key: normalizeLibraryValue(value.name_key || name),
    hex,
    aliases,
    is_favorite: value.is_favorite === true,
    updated_at: clean(value.updated_at, 50)
  };
}

async function loadSharedColorLibrary(authorization) {
  const url = new URL(SUPABASE_URL + "/rest/v1/color_library");
  url.searchParams.set("select", "name,name_key,hex,aliases,is_favorite,updated_at");
  url.searchParams.set("order", "updated_at.desc");
  url.searchParams.set("limit", "500");
  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: authorization,
      Accept: "application/json"
    },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Shared color library returned HTTP " + response.status);
  const rows = await response.json();
  return Array.isArray(rows) ? rows.map(cleanLibraryEntry).filter(Boolean) : [];
}

function libraryEntryTerms(entry) {
  return [...new Set([entry.name, entry.name_key, entry.hex, ...(entry.aliases || [])]
    .map(normalizeLibraryValue).filter(Boolean))];
}

function findSharedColorMatch(query, rows) {
  const normalized = normalizeLibraryValue(query);
  if (!normalized) return { match: null, ambiguous: [] };

  let matches = rows.filter(entry => libraryEntryTerms(entry).includes(normalized));
  if (!matches.length) {
    const genericTerms = new Set([
      "color", "colour", "codigo", "code", "modelo", "fabricante", "producto",
      "black", "white", "blue", "green", "red", "gray", "grey", "pink", "purple",
      "negro", "blanco", "azul", "verde", "rojo", "gris", "rosa", "morado", "dorado"
    ]);
    matches = rows.filter(entry => libraryEntryTerms(entry).some(term =>
      term.length >= 5 &&
      !genericTerms.has(term) &&
      (normalized.startsWith(term + " ") || normalized.endsWith(" " + term) || normalized.includes(" " + term + " "))
    ));
  }

  const unique = new Map();
  for (const entry of matches) unique.set(entry.name + "|" + entry.hex, entry);
  matches = [...unique.values()];
  const distinctHex = new Set(matches.map(entry => entry.hex));
  if (distinctHex.size > 1) return { match: null, ambiguous: matches.slice(0, 6) };
  if (!matches.length) return { match: null, ambiguous: [] };

  const chosen = matches[0];
  return {
    match: {
      ...chosen,
      aliases: [...new Set(matches.flatMap(entry => [entry.name, ...(entry.aliases || [])])
        .filter(value => normalizeLibraryValue(value) !== normalizeLibraryValue(chosen.name)))].slice(0, 6)
    },
    ambiguous: []
  };
}

function selectRelevantLibraryEntries(query, productContext, rows) {
  const searchText = normalizeLibraryValue([query, productContext].filter(Boolean).join(" "));
  if (!searchText || !rows.length) return [];
  const tokens = [...new Set(searchText.split(" ").filter(token => token.length >= 2))];
  const scored = rows.map(entry => {
    const terms = libraryEntryTerms(entry);
    let score = 0;
    for (const token of tokens) {
      if (terms.some(term => term.split(" ").includes(token))) score += token.length >= 4 ? 3 : 1;
    }
    if (terms.some(term => term.length >= 4 && searchText.includes(term))) score += 8;
    if (entry.is_favorite) score += 0.25;
    return { entry, score };
  }).filter(item => item.score > 0);
  scored.sort((a, b) => b.score - a.score ||
    String(b.entry.updated_at || "").localeCompare(String(a.entry.updated_at || "")));
  return scored.slice(0, 30).map(item => ({
    name: item.entry.name,
    hex: item.entry.hex,
    aliases: item.entry.aliases
  }));
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
  const isImage = Boolean(imageDataUrl);
  const authorization = request.headers.get("Authorization") || "";
  let sharedColors;
  try {
    sharedColors = await loadSharedColorLibrary(authorization);
  } catch (error) {
    console.error("Could not read shared color library:", error instanceof Error ? error.message : "unknown error");
    return respond(503, { error: "color_library_unavailable", message: "No se pudo consultar la biblioteca compartida de colores. Intentá nuevamente para evitar omitir referencias guardadas." }, origin);
  }

  if (!isImage) {
    const lookup = findSharedColorMatch(query, sharedColors);
    if (lookup.ambiguous.length) {
      return respond(409, {
        error: "ambiguous_library_match",
        message: "La referencia coincide con varios colores guardados. Especificá un alias o código más exacto.",
        matches: lookup.ambiguous.map(entry => ({ name: entry.name, hex: entry.hex }))
      }, origin);
    }
    if (lookup.match) {
      return respond(200, {
        name: lookup.match.name,
        hex: lookup.match.hex,
        aliases: lookup.match.aliases,
        confidence: 1,
        basis: "shared_library_match",
        officialVerified: false,
        explanation: "Coincidencia exacta con la biblioteca compartida de JB Collections.",
        note: "La biblioteca conserva referencias guardadas por administración; no constituye una verificación oficial del fabricante."
      }, origin);
    }
  }

  if (!env || !env.AI || typeof env.AI.run !== "function") return respond(503, { error: "ai_not_configured", message: "El servicio de IA de colores no está conectado todavía." }, origin);
  const relevantColors = selectRelevantLibraryEntries(query, productContext, sharedColors);
  const instruction = "Respondé exclusivamente con JSON con name (nombre corto del tono en español o nombre comercial probable), hex (#RRGGBB), aliases (hasta 6), confidence (estimación no calibrada 0-1) y explanation (frase breve). No afirmés que un nombre/código es oficial a menos que haya evidencia verificable en el propio texto. No tenés navegación ni acceso a bases oficiales: un código del fabricante debe tratarse como sugerencia no verificada. Para fotografía, estimá el color principal del producto, no el fondo ni reflejos evidentes. Si no podés identificarlo claramente, devolvé name 'Por confirmar', hex '#777777', aliases [] y explicá la incertidumbre. Si se incluyen colores de la biblioteca interna, respetá sus HEX cuando el nombre/alias coincida; la biblioteca es memoria interna, no una fuente oficial.";
  const prompt = "Marca/modelo: " + (productContext || "No indicado") + "\nConsulta/referencia: " + (query || "Analizar el color principal del producto en la fotografía.") + "\nDevolvé nombre útil, HEX aproximado y alias; la sugerencia no es una identificación oficial." +
    (relevantColors.length ? "\nReferencias relevantes de la biblioteca compartida (JSON; usalas solo si encajan con la consulta): " + JSON.stringify(relevantColors) : "");
  try {
    const input = isImage
      ? { messages: [{ role: "system", content: instruction }, { role: "user", content: prompt }], image: imageDataUrl, max_tokens: 320, temperature: 0.15 }
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
