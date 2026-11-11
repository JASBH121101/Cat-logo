const AUTH_PROXY_PREFIX = "/api/neon-auth";
const MAX_AUTH_BODY_BYTES = 1024 * 1024;

function proxyJson(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function rewriteCookie(cookie, upstreamPath) {
  const attributes = String(cookie || "").split(";");
  const rewritten = [];
  for (const attribute of attributes) {
    const trimmed = attribute.trim();
    if (/^domain=/i.test(trimmed)) continue;
    if (/^path=/i.test(trimmed) && trimmed.slice(5).trim().replace(/\/+$/, "") === upstreamPath) {
      rewritten.push(" Path=" + AUTH_PROXY_PREFIX);
    } else {
      rewritten.push(attribute);
    }
  }
  return rewritten.join(";");
}

export async function onRequest({ request, env }) {
  const method = request.method.toUpperCase();
  if (!["GET", "POST", "OPTIONS"].includes(method)) {
    return proxyJson(405, { error: "method_not_allowed" });
  }

  const baseValue = String(
    new URL(request.url).hostname === "fiverr-demo.jb-collections.pages.dev"
      ? "https://ep-steep-rain-bei5dxk1.neonauth.c-9.us-east-2.aws.neon.tech/fiverr_auth/auth"
      : env.NEON_AUTH_BASE_URL || ""
  ).trim();
  let upstreamBase;
  try {
    upstreamBase = new URL(baseValue);
    if (upstreamBase.protocol !== "https:" || !upstreamBase.pathname || upstreamBase.pathname === "/") {
      throw new Error("invalid_auth_base");
    }
  } catch {
    return proxyJson(503, { error: "neon_auth_not_configured" });
  }

  const incoming = new URL(request.url);
  if (incoming.pathname !== AUTH_PROXY_PREFIX && !incoming.pathname.startsWith(AUTH_PROXY_PREFIX + "/")) {
    return proxyJson(404, { error: "not_found" });
  }

  const origin = request.headers.get("Origin");
  if (origin && origin !== incoming.origin) {
    return proxyJson(403, { error: "cross_origin_request_blocked" });
  }

  const relativePath = incoming.pathname.slice(AUTH_PROXY_PREFIX.length).replace(/^\/+/, "");
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(relativePath);
  } catch {
    return proxyJson(400, { error: "invalid_auth_path" });
  }
  if (!decodedPath || decodedPath.includes("\\") || decodedPath.split("/").some(part =>
    !part || part === "." || part === ".." || !/^[a-zA-Z0-9._~-]+$/.test(part)
  )) {
    return proxyJson(400, { error: "invalid_auth_path" });
  }

  let body;
  if (method !== "GET" && method !== "OPTIONS") {
    const declaredLength = Number(request.headers.get("Content-Length") || 0);
    if (declaredLength > MAX_AUTH_BODY_BYTES) {
      return proxyJson(413, { error: "auth_request_too_large" });
    }
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_AUTH_BODY_BYTES) {
      return proxyJson(413, { error: "auth_request_too_large" });
    }
  }

  const upstreamPath = upstreamBase.pathname.replace(/\/+$/, "");
  const target = new URL(upstreamBase.toString());
  target.pathname = upstreamPath + "/" + relativePath;
  target.search = incoming.search;

  const headers = new Headers(request.headers);
  for (const name of ["Host", "Content-Length", "Connection", "Accept-Encoding", "CF-Connecting-IP", "CF-Ray", "CF-Visitor"]) {
    headers.delete(name);
  }

  let upstream;
  try {
    upstream = await fetch(target.toString(), {
      method,
      headers,
      body: body && body.byteLength ? body : undefined,
      redirect: "manual"
    });
  } catch {
    return proxyJson(502, { error: "neon_auth_upstream_unreachable" });
  }

  const responseHeaders = new Headers(upstream.headers);
  for (const name of ["Content-Length", "Content-Encoding", "Transfer-Encoding", "Set-Cookie"]) {
    responseHeaders.delete(name);
  }
  responseHeaders.set("Cache-Control", "no-store");
  responseHeaders.set("X-Content-Type-Options", "nosniff");

  const cookies = typeof upstream.headers.getSetCookie === "function"
    ? upstream.headers.getSetCookie()
    : (upstream.headers.get("Set-Cookie") ? [upstream.headers.get("Set-Cookie")] : []);
  for (const cookie of cookies) {
    responseHeaders.append("Set-Cookie", rewriteCookie(cookie, upstreamPath));
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders
  });
}
