const OWNER = "JASBH121101";
const REPO = "Cat-logo";
const APK_NAME = "JB-Manager-Collections.apk";
const MAX_APK_BYTES = 50 * 1024 * 1024;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

function response(status, body, headers = {}, method = "GET") {
  return new Response(method === "HEAD" ? null : body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...headers
    }
  });
}

function githubHeaders(request, accept) {
  const headers = new Headers({
    Accept: accept,
    "User-Agent": "JB-Collections-APK-Download",
    "Cache-Control": "no-cache",
    Pragma: "no-cache"
  });
  const range = request.headers.get("Range");
  const ifRange = request.headers.get("If-Range");
  if (range) headers.set("Range", range);
  if (ifRange) headers.set("If-Range", ifRange);
  return headers;
}

async function fetchAsset(version, request) {
  const url = `https://github.com/${OWNER}/${REPO}/releases/download/jb-manager-v${version}/${APK_NAME}`;
  return fetch(url, {
    method: "GET",
    headers: githubHeaders(request, "application/octet-stream"),
    cache: "no-store",
    redirect: "follow"
  });
}

function hasValidLengthAndRange(upstream) {
  const lengthHeader = upstream.headers.get("Content-Length") || "";
  if (!/^\d+$/.test(lengthHeader)) return false;
  const length = Number(lengthHeader);
  if (!Number.isSafeInteger(length) || length < 1 || length > MAX_APK_BYTES) return false;

  if (upstream.status === 200) return length >= 1024;

  const contentRange = upstream.headers.get("Content-Range") || "";
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(contentRange);
  if (!match) return false;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  return Number.isSafeInteger(start)
    && Number.isSafeInteger(end)
    && Number.isSafeInteger(total)
    && start <= end
    && end < total
    && total <= MAX_APK_BYTES
    && end - start + 1 === length;
}

function downloadHeaders(upstream, version, isRangeRequest) {
  const headers = new Headers({
    "Content-Type": "application/vnd.android.package-archive",
    "Content-Disposition": `attachment; filename="JB-Manager-Collections-v${version}.apk"`,
    "Cache-Control": isRangeRequest ? "no-store" : IMMUTABLE_CACHE_CONTROL,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Accept-Ranges": upstream.headers.get("Accept-Ranges") || "bytes"
  });

  for (const name of ["Content-Length", "Content-Range", "ETag", "Last-Modified"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (upstream.status !== 206) headers.delete("Content-Range");
  return headers;
}

function cacheKeyFor(requestUrl, version) {
  return new Request(new URL(`/__jb-manager-apk-cache/${version}`, requestUrl.origin), {
    method: "GET"
  });
}

export async function onRequest(context) {
  const { request, waitUntil } = context;
  if (request.method !== "GET") {
    return response(405, "Method not allowed", { Allow: "GET" }, request.method);
  }

  let requestUrl;
  try { requestUrl = new URL(request.url); }
  catch { return response(400, "Invalid download URL"); }

  const versionValues = requestUrl.searchParams.getAll("version");
  const version = versionValues[0] || "";
  if (versionValues.length !== 1 || !VERSION_PATTERN.test(version) || version.length > 30) {
    return response(400, "Missing or invalid version. Expected ?version=1.0.64");
  }

  const isRangeRequest = request.headers.has("Range");
  const canUseCache = !isRangeRequest && typeof caches !== "undefined" && Boolean(caches.default);
  const cache = canUseCache ? caches.default : null;
  const cacheKey = canUseCache ? cacheKeyFor(requestUrl, version) : null;

  if (cache) {
    try {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    } catch (error) {
      console.warn("APK edge-cache lookup failed; continuing to GitHub:", error instanceof Error ? error.message : "unknown error");
    }
  }

  try {
    const upstream = await fetchAsset(version, request);
    if (upstream.status === 404 || upstream.status === 410) {
      try { await upstream.body?.cancel(); } catch {}
      return response(404, "APK release not found");
    }
    if (upstream.status !== 200 && upstream.status !== 206) {
      try { await upstream.body?.cancel(); } catch {}
      return response(502, "The official APK host did not return a complete download");
    }

    // Validate the declared transfer size and range without reading the body.
    // Every published release is also ZIP-checked by the GitHub Actions release workflow.
    if (!hasValidLengthAndRange(upstream)) {
      try { await upstream.body?.cancel(); } catch {}
      return response(502, "APK response has invalid size or range metadata");
    }

    // Stream GitHub's body directly to the phone. Buffering arrayBuffer() here made
    // the user wait for the complete ~50 MB file before Android received byte one.
    const download = new Response(upstream.body, {
      status: upstream.status,
      headers: downloadHeaders(upstream, version, isRangeRequest)
    });

    // Release URLs are versioned and immutable. Cache only complete GET responses;
    // Range requests continue to pass through so DownloadManager can resume them.
    if (cache && upstream.status === 200 && typeof waitUntil === "function") {
      try {
        waitUntil(cache.put(cacheKey, download.clone()).catch(error => {
          console.warn("APK edge-cache write failed:", error instanceof Error ? error.message : "unknown error");
        }));
      } catch (error) {
        console.warn("APK edge-cache scheduling failed:", error instanceof Error ? error.message : "unknown error");
      }
    }

    return download;
  } catch (error) {
    console.error("APK proxy failed:", error instanceof Error ? error.message : "unknown error");
    return response(502, "Download service could not retrieve the official APK. Retry shortly.");
  }
}
