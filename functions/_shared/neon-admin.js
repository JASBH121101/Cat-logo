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
    const response = await fetch(endpoint + "/rpc/catalog_admin_context", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + match[1],
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Profile": "public",
        "Content-Profile": "public",
        "Cache-Control": "no-store"
      },
      body: "{}"
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error("JB admin authorization RPC failed:", response.status, detail.slice(0, 300));
      return { ok: false, response: jsonResponse(response.status === 401 ? 401 : 503, { error: "Neon no pudo validar la sesión administrativa (HTTP " + response.status + ")." }) };
    }

    const context = await response.json().catch(() => null);
    const value = Array.isArray(context) ? context[0] : context;
    if (value?.is_admin !== true || typeof value.admin_id !== "string" || !value.admin_id) {
      return { ok: false, response: jsonResponse(403, { error: "Este usuario no tiene permisos administrativos." }) };
    }

    return { ok: true, token: match[1], adminId: value.admin_id };
  } catch (error) {
    console.error("JB admin authorization request failed:", error instanceof Error ? error.message : "unknown error");
    return { ok: false, response: jsonResponse(503, { error: "No fue posible verificar el acceso administrativo." }) };
  }
}

export function storageUnavailable(env) {
  return !env?.PRODUCT_IMAGES || typeof env.PRODUCT_IMAGES.put !== "function";
}


// These mutation/metadata APIs belong only to the isolated Fiverr demo Preview.
export function isFiverrDemoRequest(request) {
  try {
    const url = new URL(request.url);
    return url.protocol === "https:" && url.hostname === "fiverr-demo.jb-collections.pages.dev";
  } catch {
    return false;
  }
}
