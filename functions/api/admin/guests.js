const OWNER_EMAIL_DOMAIN = "gmail.com";
const NEON_PROJECT_ID = "wispy-forest-84396726";
const NEON_BRANCH_ID = "br-little-sun-be3xph9h";
const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};

function json(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

function bearerToken(request) {
  const value = request.headers.get("Authorization") || "";
  const match = value.match(/^Bearer\s+([A-Za-z0-9._~-]+)$/i);
  return match ? match[1] : "";
}

async function getOwnerContext(token, dataApiUrl) {
  const response = await fetch(dataApiUrl.replace(/\/+$/, "") + "/rpc/catalog_admin_context", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Profile": "public",
      "Content-Profile": "public",
      "Cache-Control": "no-store"
    },
    body: "{}"
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  return Array.isArray(payload) ? payload[0] : payload;
}

export async function onRequest({ request, env }) {
  const requestUrl = new URL(request.url);
  if (requestUrl.protocol !== "https:" || requestUrl.hostname !== "fiverr-demo.jb-collections.pages.dev") {
    return json(404, { error: "not_found" });
  }
  const origin = request.headers.get("Origin");
  if (origin && origin !== requestUrl.origin) return json(403, { error: "cross_origin_request_blocked" });
  if (request.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }
  const token = bearerToken(request);
  if (!token) return json(401, { error: "Iniciá sesión como propietario." });

  const dataApiUrl = String(env.NEON_DATA_API_URL || "").trim();
  if (!dataApiUrl) return json(503, { error: "NEON_DATA_API_URL no está configurada en Preview." });
  let parsedDataApiUrl;
  try {
    parsedDataApiUrl = new URL(dataApiUrl);
    if (parsedDataApiUrl.protocol !== "https:" || !parsedDataApiUrl.hostname.endsWith(".neon.tech")) throw new Error("invalid_data_api_url");
  } catch {
    return json(503, { error: "La URL de Neon Data API no es válida." });
  }
  const dataApiEndpoint = parsedDataApiUrl.toString();
  const owner = await getOwnerContext(token, dataApiEndpoint.endsWith("/") ? dataApiEndpoint.slice(0, -1) : dataApiEndpoint).catch(() => null);
  if (owner?.is_owner !== true || owner?.role !== "admin") {
    return json(403, { error: "Solo el propietario puede crear usuarios invitados." });
  }

  const apiKey = String(env.NEON_API_KEY || "").trim();
  const ownerEmail = String(env.DEMO_OWNER_AUTH_EMAIL || "").trim().toLowerCase();
  if (!apiKey || !ownerEmail) {
    return json(503, {
      error: "Falta configurar NEON_API_KEY y DEMO_OWNER_AUTH_EMAIL como secretos del entorno Preview en Cloudflare Pages."
    });
  }

  let input;
  try {
    const raw = await request.text();
    if (raw.length > 4096) return json(413, { error: "La solicitud es demasiado grande." });
    input = JSON.parse(raw);
  } catch {
    return json(400, { error: "La solicitud no contiene JSON válido." });
  }

  const username = String(input?.username || "").trim().normalize("NFKC").toLowerCase();
  const displayName = String(input?.display_name || username).trim().slice(0, 80);
  if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username) || username === "jaredbh") {
    return json(400, { error: "El usuario debe tener entre 3 y 30 caracteres válidos y no puede usar JaredBH." });
  }

  const at = ownerEmail.lastIndexOf("@");
  if (at <= 0 || ownerEmail.slice(at + 1) !== OWNER_EMAIL_DOMAIN) {
    return json(500, { error: "El correo de propietario debe usar el dominio Gmail para generar alias privados." });
  }
  const localPart = ownerEmail.slice(0, at);
  const guestEmail = localPart + "+" + username + "@" + OWNER_EMAIL_DOMAIN;

  const managementUrl = "https://console.neon.tech/api/v2/projects/" + NEON_PROJECT_ID +
    "/branches/" + NEON_BRANCH_ID + "/auth/users";

  let authUserId = "";
  try {
    const created = await fetch(managementUrl, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ email: guestEmail, name: displayName })
    });
    const result = await created.json().catch(() => ({}));
    if (!created.ok) {
      const detail = String(result?.message || result?.error || "").slice(0, 240);
      const status = created.status === 409 ? 409 : created.status === 401 || created.status === 403 ? 503 : 400;
      return json(status, { error: detail || "Neon no pudo crear la identidad del invitado." });
    }
    authUserId = String(result?.id || result?.user?.id || result?.data?.id || "");
    if (!authUserId) {
      return json(502, { error: "Neon creó la solicitud, pero no devolvió el identificador de usuario. Verificá el directorio Auth antes de repetir." });
    }

    const linked = await fetch(dataApiUrl.replace(/\/+$/, "") + "/rpc/link_fiverr_demo_guest", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Profile": "public",
        "Content-Profile": "public",
        "Cache-Control": "no-store"
      },
      body: JSON.stringify({
        target_auth_user_id: authUserId,
        requested_username: username
      })
    });

    if (!linked.ok) {
      const detail = await linked.text().catch(() => "");
      await fetch("https://console.neon.tech/api/v2/projects/" + NEON_PROJECT_ID +
        "/branches/" + NEON_BRANCH_ID + "/auth/users/" + encodeURIComponent(authUserId), {
        method: "DELETE",
        headers: { Authorization: "Bearer " + apiKey, Accept: "application/json" }
      }).catch(() => null);
      return json(linked.status === 409 ? 409 : 400, {
        error: detail.slice(0, 300) || "No se pudo vincular la cuenta al equipo."
      });
    }

    return json(201, {
      ok: true,
      username,
      display_name: displayName,
      password_setup_required: true,
      note: "La cuenta fue creada. El propietario debe asignar la contraseña mediante el código de un solo uso enviado a su bandeja Gmail."
    });
  } catch {
    return json(502, { error: "No fue posible completar el alta de la cuenta invitada." });
  }
}
