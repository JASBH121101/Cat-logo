const SUPABASE_STORAGE_ORIGIN = "https://uwqnoadelnnplcvqqlyz.supabase.co";
const STORAGE_BUCKET = "product-images";
const IMAGE_EXTENSIONS = /\.(?:avif|gif|jpe?g|jfif|png|webp)$/i;

function errorResponse(status, message) {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function validObjectPath(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 8) return null;
  const segments = value.map(segment => String(segment || ""));
  if (segments.some(segment =>
    !segment || segment === "." || segment === ".." ||
    !/^[a-z0-9._-]+$/i.test(segment)
  )) return null;
  const path = segments.join("/");
  return IMAGE_EXTENSIONS.test(path) ? path : null;
}

function cachedResponse(request, response) {
  return request.method === "HEAD"
    ? new Response(null, { status: response.status, headers: response.headers })
    : response;
}

export async function onRequest(context) {
  const request = context.request;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return errorResponse(405, "Method not allowed.");
  }

  const path = validObjectPath(context.params?.path);
  if (!path) return errorResponse(404, "Image not found.");

  const cacheUrl = new URL(request.url);
  cacheUrl.search = "";
  cacheUrl.hash = "";
  const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
  const cache = caches.default;

  try {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set("X-JB-Media-Cache", "HIT");
      return cachedResponse(request, new Response(request.method === "HEAD" ? null : cached.body, {
        status: cached.status,
        headers
      }));
    }

    let response = null;
    const bucket = context.env.PRODUCT_IMAGES;
    if (bucket && typeof bucket.get === "function") {
      const object = await bucket.get(path);
      if (object) {
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set("Content-Type", headers.get("Content-Type") || "application/octet-stream");
        headers.set("Cache-Control", headers.get("Cache-Control") || "public, max-age=31536000, immutable");
        headers.set("ETag", object.httpEtag || object.etag || "");
        headers.set("Access-Control-Allow-Origin", "*");
        headers.set("X-Content-Type-Options", "nosniff");
        headers.set("X-JB-Media-Cache", "MISS-R2");
        response = new Response(object.body, { status: 200, headers });
      }
    }

    // Keep Supabase as a read-only fallback until all 568 source objects
    // have been copied and checksum-verified in the isolated R2 bucket.
    if (!response) {
      const encodedPath = path.split("/").map(encodeURIComponent).join("/");
      const upstream = await fetch(
        SUPABASE_STORAGE_ORIGIN + "/storage/v1/object/public/" +
        STORAGE_BUCKET + "/" + encodedPath,
        { method: "GET", headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif" } }
      );
      if (!upstream.ok) return errorResponse(upstream.status === 404 ? 404 : 502, "Image unavailable.");
      const contentType = String(upstream.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
      if (!/^image\/(?:avif|gif|jpeg|png|webp)$/.test(contentType)) {
        return errorResponse(415, "Unsupported media type.");
      }
      const headers = new Headers(upstream.headers);
      headers.delete("Set-Cookie");
      headers.set("Content-Type", contentType);
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("X-JB-Media-Cache", "MISS-SUPABASE-FALLBACK");
      response = new Response(upstream.body, { status: 200, headers });
    }

    await cache.put(cacheKey, response.clone());
    return cachedResponse(request, response);
  } catch (error) {
    console.error("JB media proxy failed:", error instanceof Error ? error.message : "unknown error");
    return errorResponse(502, "Image service temporarily unavailable.");
  }
}
