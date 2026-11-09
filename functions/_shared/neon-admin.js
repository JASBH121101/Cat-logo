const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};

export function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

export function validObjectPath(value) {
  const raw = String(value || "").replace(/^\/+|\/+$/g, "");
  const parts = raw.split("/");
  if (!raw || parts.length < 2 || parts.length > 8 || raw.length > 900) return null;
  if (parts.some(part => !part || part === "." || part === ".." || !/^[a-z0-9._-]+$/i.test(part))) return null;
  if (!/\.(?:avif|gif|jpe?g|jfif|png|webp)$/i.test(parts[parts.length - 1])) return null;
  return parts.join("/");
}

export async function requireCatalogAdmin(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+([A-Za-z0-9._~-]+)$/i);
  if (!match) return { ok: false, response: jsonResponse(401, { error: "Sesión administrativa requerida." }) };

  const endpoint = String(env.NEON_DATA_API_URL || "").replace(/\/+$/, "");
  if (!endpoint) return { ok: false, response: jsonResponse(503, { error: "Neon Data API no está configurada para este entorno." }) };

  try {
    // The Data API validates the Neon Auth JWT and applies admin_users RLS.
    // Non-admin authenticated users receive an empty array rather than the admin row.
    const response = await fetch(endpoint + "/admin_users?select=user_id&limit=1", {
      method: "GET",
      headers: {
        Authorization: "Bearer " + match[1],
        Accept: "application/json",
        "Cache-Control": "no-store"
      }
    });
    if (!response.ok) return { ok: false, response: jsonResponse(401, { error: "La sesión no está autorizada." }) };
    const rows = await response.json().catch(() => null);
    if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]?.user_id) {
      return { ok: false, response: jsonResponse(403, { error: "Este usuario no tiene permisos administrativos." }) };
    }
    return { ok: true, token: match[1], adminId: rows[0].user_id };
  } catch {
    return { ok: false, response: jsonResponse(503, { error: "No fue posible verificar el acceso administrativo." }) };
  }
}

export function storageUnavailable(env) {
  return !env?.PRODUCT_IMAGES || typeof env.PRODUCT_IMAGES.put !== "function";
}
