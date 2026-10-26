const OWNER = "JASBH121101";
const REPO = "Cat-logo";
const APK_NAME = "JB-Manager-Collections.apk";
const MAX_APK_BYTES = 50 * 1024 * 1024;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

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

async function getRelease(version) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/jb-manager-v${version}`;
  const result = await fetch(url, {
    method: "GET",
    headers: githubHeaders(new Request("https://jb-collections.pages.dev/"), "application/vnd.github+json"),
    cache: "no-store",
    redirect: "follow"
  });
  if (result.status === 404) return { notFound: true };
  if (!result.ok) return { error: true };
  let release;
  try { release = await result.json(); } catch { return { error: true }; }
  if (release?.draft || release?.tag_name !== `jb-manager-v${version}`) return { notFound: true };
  const asset = Array.isArray(release.assets)
    ? release.assets.find(item => item?.name === APK_NAME && item?.state === "uploaded")
    : null;
  if (!asset || !Number.isSafeInteger(asset.size) || asset.size < 1024 || asset.size > MAX_APK_BYTES) {
    return { notFound: true };
  }
  const canonicalUrl = `https://github.com/${OWNER}/${REPO}/releases/download/jb-manager-v${version}/${APK_NAME}`;
  if (asset.browser_download_url !== canonicalUrl || !Number.isSafeInteger(asset.id) || asset.id <= 0) {
    return { error: true };
  }
  return { release, asset };
}

async function fetchAsset(asset, request) {
  const headers = githubHeaders(request, "application/octet-stream");
  const apiUrl = `https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${asset.id}`;
  let upstream = await fetch(apiUrl, { method: "GET", headers, cache: "no-store", redirect: "follow" });
  const type = (upstream.headers.get("Content-Type") || "").toLowerCase();
  if (!upstream.ok || type.includes("application/json") || type.includes("text/html")) {
    try { await upstream.body?.cancel(); } catch {}
    // Re-resolve the public release URL at request time rather than relying on
    // a previously issued signed release-assets URL.
    upstream = await fetch(asset.browser_download_url, {
      method: "GET",
      headers,
      cache: "no-store",
      redirect: "follow"
    });
  }
  return upstream;
}

export async function onRequest({ request }) {
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

  try {
    const found = await getRelease(version);
    if (found.notFound) return response(404, "APK release not found");
    if (found.error) return response(502, "Could not resolve the official APK release");

    const upstream = await fetchAsset(found.asset, request);
    if (upstream.status !== 200 && upstream.status !== 206) {
      try { await upstream.body?.cancel(); } catch {}
      return response(502, "The official APK host did not return a complete download");
    }

    // Buffer the modest-sized APK before replying so the edge can verify the
    // actual body and send a precise Content-Length. This avoids mobile browsers
    // waiting on a streamed upstream response that never closes cleanly.
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    const actualLength = bytes.byteLength;
    if (actualLength < (upstream.status === 206 ? 1 : 1024) || actualLength > MAX_APK_BYTES) {
      return response(502, "APK response size is outside the allowed range");
    }

    if (upstream.status === 200) {
      // A complete APK is a ZIP archive: validate its header and end record
      // instead of trusting release metadata that can differ from streamed bytes.
      if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
        return response(502, "The release host returned data that is not an APK archive");
      }
      const searchStart = Math.max(0, actualLength - 65557);
      let hasEndRecord = false;
      for (let i = actualLength - 22; i >= searchStart; i--) {
        if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b
          && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
          hasEndRecord = true;
          break;
        }
      }
      if (!hasEndRecord) {
        return response(502, "The APK transfer was incomplete; the archive end record is missing");
      }
      if (actualLength !== found.asset.size) {
        console.warn("APK release metadata size differs from verified archive bytes:", found.asset.size, actualLength);
      }
    } else {
      const contentRange = upstream.headers.get("Content-Range") || "";
      const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(contentRange);
      if (!match || Number(match[2]) < Number(match[1])
        || Number(match[2]) - Number(match[1]) + 1 !== actualLength) {
        return response(502, "Partial APK response has an invalid Content-Range");
      }
    }

    const headers = new Headers({
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Disposition": `attachment; filename="JB-Manager-Collections-v${version}.apk"`,
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Length": String(actualLength),
      "Accept-Ranges": upstream.headers.get("Accept-Ranges") || "bytes"
    });
    for (const name of ["Content-Range", "ETag", "Last-Modified"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(bytes, { status: upstream.status, headers });
  } catch (error) {
    console.error("APK proxy failed:", error instanceof Error ? error.message : "unknown error");
    return response(502, "Download service could not retrieve the official APK. Retry shortly.");
  }
}
