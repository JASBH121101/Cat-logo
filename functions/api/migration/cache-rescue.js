import { jsonResponse, requireCatalogAdmin, validObjectPath, storageUnavailable } from "../../_shared/neon-admin.js";

const PRODUCTION_HOST = "jb-collections.pages.dev";
const DEMO_HOST = "fiverr-demo.jb-collections.pages.dev";
const MAX_BATCH_SIZE = 10;
const MAX_OBJECT_BYTES = 50 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]);

function imageContentType(value, path) {
  const header = String(value || "").split(";")[0].trim().toLowerCase();
  if (IMAGE_TYPES.has(header)) return header;
  const extension = path.split(".").pop().toLowerCase();
  return ({
    avif: "image/avif",
    gif: "image/gif",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    jfif: "image/jpeg",
    png: "image/png",
    webp: "image/webp"
  })[extension] || "";
}

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value) {
  return hex(await crypto.subtle.digest("SHA-256", value));
}

async function findCachedImage(path) {
  const cache = caches.default;
  const hosts = [PRODUCTION_HOST, DEMO_HOST];

  for (const host of hosts) {
    const key = new Request("https://" + host + "/media/" + path, { method: "GET" });
    const response = await cache.match(key);
    if (!response) continue;
    if (response.status !== 200) {
      await response.body?.cancel?.();
      continue;
    }

    const contentType = imageContentType(response.headers.get("Content-Type"), path);
    if (!contentType) {
      await response.body?.cancel?.();
      return {
        status: "invalid",
        reason: "La entrada de caché no tiene un tipo de imagen permitido.",
        cacheHost: host
      };
    }

    const declaredSize = Number(response.headers.get("Content-Length") || 0);
    if (declaredSize > MAX_OBJECT_BYTES) {
      await response.body?.cancel?.();
      return {
        status: "invalid",
        reason: "La imagen supera el límite seguro de 50 MB.",
        cacheHost: host
      };
    }

    return { response, contentType, cacheHost: host, declaredSize };
  }

  return null;
}

async function readExistingR2(bucket, path) {
  const head = await bucket.head(path);
  if (!head) return null;
  if (head.size > MAX_OBJECT_BYTES) {
    return { error: "El objeto existente en R2 supera el límite seguro de 50 MB." };
  }

  const object = await bucket.get(path);
  if (!object) return { error: "El objeto existente desapareció durante la verificación." };

  const contentType = imageContentType(object.httpMetadata?.contentType, path);
  if (!contentType) {
    return { error: "El objeto existente en R2 no tiene un tipo de imagen válido." };
  }

  const bytes = new Uint8Array(await object.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength !== head.size || bytes.byteLength > MAX_OBJECT_BYTES) {
    return { error: "El tamaño del objeto existente en R2 no pasó la verificación." };
  }

  return {
    size: bytes.byteLength,
    sha256: await sha256Hex(bytes),
    contentType
  };
}

async function processPath(bucket, path, action) {
  const existing = await readExistingR2(bucket, path);
  if (existing?.error) {
    return { path, status: "error", reason: existing.error };
  }
  if (existing) {
    return {
      path,
      status: "already",
      size: existing.size,
      contentType: existing.contentType,
      sha256: existing.sha256,
      message: "Ya existe en R2 y se verificaron sus bytes."
    };
  }

  const cached = await findCachedImage(path);
  if (!cached) {
    return {
      path,
      status: "miss",
      reason: "No existe una copia en la caché local de Cloudflare para las claves de producción o demo."
    };
  }
  if (cached.status === "invalid") return { path, ...cached };

  if (action === "probe") {
    return {
      path,
      status: "hit",
      cacheHost: cached.cacheHost,
      size: cached.declaredSize || null,
      contentType: cached.contentType,
      message: "La caché contiene una respuesta de imagen; todavía no se copió."
    };
  }

  const bytes = new Uint8Array(await cached.response.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > MAX_OBJECT_BYTES ||
      (cached.declaredSize && bytes.byteLength !== cached.declaredSize)) {
    return {
      path,
      status: "invalid",
      cacheHost: cached.cacheHost,
      reason: "El cuerpo almacenado en caché no pasó la validación de tamaño."
    };
  }

  const sourceSha256 = await sha256Hex(bytes);

  // Deliberately no source fetch or Supabase fallback exists in this route.
  // It copies only a response already present in the local Cloudflare Cache API.
  const created = await bucket.put(path, bytes, {
    // Atomic create-only semantics: a concurrent rescue cannot overwrite an existing object.
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: {
      contentType: cached.contentType,
      cacheControl: "public, max-age=31536000, immutable"
    },
    customMetadata: {
      source: "cloudflare-production-cache",
      sourceHost: cached.cacheHost,
      sha256: sourceSha256,
      recoveredAt: new Date().toISOString()
    }
  });

  if (!created) {
    const raced = await readExistingR2(bucket, path);
    if (raced && !raced.error && raced.size === bytes.byteLength && raced.sha256 === sourceSha256) {
      return {
        path,
        status: "already",
        size: raced.size,
        contentType: raced.contentType,
        sha256: raced.sha256,
        message: "Otro intento guardó la misma imagen; se verificó sin sobrescribirla."
      };
    }
    return {
      path,
      status: "error",
      reason: raced?.error || "R2 protegió un objeto que apareció durante la copia; no se sobrescribió."
    };
  }

  const saved = await bucket.get(path);
  if (!saved) {
    return { path, status: "error", reason: "R2 no devolvió el objeto después de guardarlo." };
  }

  const savedBytes = new Uint8Array(await saved.arrayBuffer());
  const savedSha256 = await sha256Hex(savedBytes);
  if (savedBytes.byteLength !== bytes.byteLength || savedSha256 !== sourceSha256) {
    return {
      path,
      status: "error",
      reason: "La lectura posterior de R2 no coincide con el SHA-256 de la caché."
    };
  }

  return {
    path,
    status: "copied",
    size: savedBytes.byteLength,
    contentType: cached.contentType,
    sha256: savedSha256,
    cacheHost: cached.cacheHost,
    message: "Recuperada desde caché y verificada por SHA-256 en R2."
  };
}

export async function onRequest(context) {
  if (context.request.method !== "POST") {
    return jsonResponse(405, { error: "Método no permitido." });
  }

  const auth = await requireCatalogAdmin(context.request, context.env);
  if (!auth.ok) return auth.response;

  if (storageUnavailable(context.env)) {
    return jsonResponse(503, { error: "R2 no está enlazado en este entorno." });
  }

  const bucket = context.env.PRODUCT_IMAGES;
  if (typeof bucket.head !== "function" || typeof bucket.get !== "function") {
    return jsonResponse(503, { error: "El binding R2 no ofrece las operaciones de verificación necesarias." });
  }

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return jsonResponse(400, { error: "Solicitud JSON inválida." });
  }

  const action = String(payload?.action || "");
  if (action !== "probe" && action !== "rescue") {
    return jsonResponse(400, { error: "Acción no válida. Usá probe o rescue." });
  }

  if (!Array.isArray(payload?.paths) || payload.paths.length < 1 ||
      payload.paths.length > MAX_BATCH_SIZE) {
    return jsonResponse(400, { error: "Enviá entre 1 y " + MAX_BATCH_SIZE + " rutas por lote." });
  }

  const results = [];
  for (const rawPath of payload.paths) {
    const path = validObjectPath(rawPath);
    if (!path || path !== rawPath) {
      results.push({
        path: String(rawPath || "").slice(0, 900),
        status: "invalid",
        reason: "La ruta no cumple el formato permitido."
      });
      continue;
    }

    try {
      results.push(await processPath(bucket, path, action));
    } catch (error) {
      results.push({
        path,
        status: "error",
        reason: error instanceof Error ? error.message : "Error desconocido al procesar la imagen."
      });
    }
  }

  return jsonResponse(200, {
    data: {
      action,
      processed: results.length,
      hits: results.filter(item => item.status === "hit" || item.status === "copied").length,
      copied: results.filter(item => item.status === "copied").length,
      alreadyPresent: results.filter(item => item.status === "already").length,
      misses: results.filter(item => item.status === "miss").length,
      errors: results.filter(item => item.status === "error" || item.status === "invalid").length,
      results
    },
    message: action === "probe"
      ? "Prueba de caché terminada; no se escribieron archivos."
      : "Lote de rescate terminado; solo se copiaron imágenes ya presentes en la caché."
  });
}
