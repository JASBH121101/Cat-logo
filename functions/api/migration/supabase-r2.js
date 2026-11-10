import { jsonResponse, requireCatalogAdmin, validObjectPath, storageUnavailable } from "../../_shared/neon-admin.js";

const SOURCE_ENDPOINT = "https://uwqnoadelnnplcvqqlyz.storage.supabase.co/storage/v1/s3";
const SOURCE_REGION = "us-east-2";
const SOURCE_BUCKET = "product-images";
const MAX_BATCH_SIZE = 10;
const MAX_SOURCE_OBJECT_BYTES = 50 * 1024 * 1024;
const MAX_INVENTORY_PAGES = 100;

const encoder = new TextEncoder();

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, "0")).join("");
}

async function sha256(value) {
  return await crypto.subtle.digest("SHA-256", value);
}

export async function sha256Hex(value) {
  return hex(await sha256(value));
}

async function hmac(key, value) {
  const imported = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return await crypto.subtle.sign("HMAC", imported, encoder.encode(value));
}

function rfc3986(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, character =>
    "%" + character.charCodeAt(0).toString(16).toUpperCase()
  );
}

function canonicalQuery(values) {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => [rfc3986(key), rfc3986(value)])
    .sort((left, right) => left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]))
    .map(([key, value]) => key + "=" + value)
    .join("&");
}

function xmlValue(source, tag) {
  const match = source.match(new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">"));
  if (!match) return "";
  return match[1]
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseListXml(xml) {
  const objects = [];
  for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const key = xmlValue(match[1], "Key");
    const size = Number(xmlValue(match[1], "Size"));
    if (key && Number.isSafeInteger(size) && size >= 0) objects.push({ key, size });
  }
  return {
    objects,
    isTruncated: xmlValue(xml, "IsTruncated").toLowerCase() === "true",
    nextContinuationToken: xmlValue(xml, "NextContinuationToken") || null
  };
}

async function signedSourceRequest({ env, method, key = "", query = {} }) {
  const accessKeyId = String(env.SUPABASE_S3_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(env.SUPABASE_S3_SECRET_ACCESS_KEY || "");
  if (!accessKeyId || !secretAccessKey) throw new Error("Faltan los secretos S3 del entorno de migración.");

  const endpoint = new URL(SOURCE_ENDPOINT);
  const encodedKey = key ? "/" + key.split("/").map(rfc3986).join("/") : "";
  const canonicalUri = endpoint.pathname.replace(/\/+$/, "") + "/" + rfc3986(SOURCE_BUCKET) + encodedKey;
  const queryString = canonicalQuery(query);
  const url = endpoint.origin + canonicalUri + (queryString ? "?" + queryString : "");

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = hex(await sha256(new ArrayBuffer(0)));
  const host = endpoint.host.toLowerCase();
  const canonicalHeaders =
    "host:" + host + "\n" +
    "x-amz-content-sha256:" + payloadHash + "\n" +
    "x-amz-date:" + amzDate + "\n";
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    method,
    canonicalUri,
    queryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");
  const scope = dateStamp + "/" + SOURCE_REGION + "/s3/aws4_request";
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    hex(await sha256(encoder.encode(canonicalRequest)))
  ].join("\n");

  let signingKey = await hmac(encoder.encode("AWS4" + secretAccessKey), dateStamp);
  signingKey = await hmac(signingKey, SOURCE_REGION);
  signingKey = await hmac(signingKey, "s3");
  signingKey = await hmac(signingKey, "aws4_request");
  const signature = hex(await hmac(signingKey, stringToSign));
  const authorization = "AWS4-HMAC-SHA256 Credential=" + accessKeyId + "/" + scope +
    ", SignedHeaders=" + signedHeaders + ", Signature=" + signature;

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: authorization,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      Accept: method === "GET" && key ? "*/*" : "application/xml"
    },
    cache: "no-store"
  });
  return response;
}

async function listSourceObjects(env, continuationToken = "", maxKeys = 1000) {
  const response = await signedSourceRequest({
    env,
    method: "GET",
    query: {
      "list-type": "2",
      "max-keys": String(maxKeys),
      "continuation-token": continuationToken || undefined
    }
  });
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    console.error("JB S3 list failed:", response.status, message.slice(0, 500));
    const explanation = response.status === 402
      ? "Supabase restringió temporalmente el servicio por cuota (HTTP 402). No se copió ningún archivo."
      : "Supabase S3 no pudo listar el bucket (HTTP " + response.status + ").";
    throw new Error(explanation);
  }
  return parseListXml(await response.text());
}

async function inventorySourceObjects(env) {
  const inventory = {
    sourceBucket: SOURCE_BUCKET,
    region: SOURCE_REGION,
    objectCount: 0,
    totalBytes: 0,
    invalidObjectCount: 0,
    pageCount: 0,
    isTruncated: false
  };
  let continuationToken = "";
  const seenTokens = new Set();

  while (inventory.pageCount < MAX_INVENTORY_PAGES) {
    const page = await listSourceObjects(env, continuationToken, 1000);
    inventory.pageCount += 1;
    inventory.objectCount += page.objects.length;
    inventory.totalBytes += page.objects.reduce((sum, object) => sum + object.size, 0);
    inventory.invalidObjectCount += page.objects.filter(object => !validObjectPath(object.key)).length;

    if (!page.isTruncated) return inventory;
    const nextToken = String(page.nextContinuationToken || "");
    if (!nextToken || seenTokens.has(nextToken)) {
      throw new Error("El inventario S3 devolvió un cursor de paginación inválido. No se inició la copia.");
    }
    seenTokens.add(nextToken);
    continuationToken = nextToken;
  }

  inventory.isTruncated = true;
  inventory.message = "El inventario superó el límite seguro de " + MAX_INVENTORY_PAGES +
    " páginas. No se inició la copia.";
  return inventory;
}

function imageContentType(value, key) {
  const header = String(value || "").split(";")[0].trim().toLowerCase();
  if (/^image\/(?:avif|gif|jpeg|png|webp)$/.test(header)) return header;
  const extension = key.split(".").pop().toLowerCase();
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

async function copyBatch(context, continuationToken, batchSize) {
  const sourcePage = await listSourceObjects(context.env, continuationToken, batchSize);
  const bucket = context.env.PRODUCT_IMAGES;
  const result = {
    copied: 0,
    alreadyPresent: 0,
    conflicts: 0,
    failed: 0,
    bytesCopied: 0,
    sha256Verified: 0,
    errors: []
  };

  for (const source of sourcePage.objects) {
    const path = validObjectPath(source.key);
    if (!path) {
      result.failed += 1;
      result.errors.push({ key: source.key, reason: "Ruta de imagen no válida para JB Collections." });
      continue;
    }
    if (source.size > MAX_SOURCE_OBJECT_BYTES) {
      result.failed += 1;
      result.errors.push({ key: path, reason: "El archivo supera el límite seguro de 50 MB por objeto." });
      continue;
    }

    try {
      const existing = await bucket.head(path);
      if (existing && existing.size !== source.size) {
        result.conflicts += 1;
        result.errors.push({
          key: path,
          reason: "Ya existe en R2 con un tamaño distinto; no se sobrescribió."
        });
        continue;
      }

      const sourceResponse = await signedSourceRequest({ env: context.env, method: "GET", key: path });
      if (!sourceResponse.ok) {
        await sourceResponse.body?.cancel?.();
        const explanation = sourceResponse.status === 402
          ? "Supabase restringió temporalmente la descarga por cuota (HTTP 402). No se sobrescribió ningún archivo."
          : "Supabase S3 respondió HTTP " + sourceResponse.status + " al descargar el objeto.";
        throw new Error(explanation);
      }

      const contentType = imageContentType(sourceResponse.headers.get("Content-Type"), path);
      if (!contentType) {
        await sourceResponse.body?.cancel?.();
        throw new Error("El origen no devolvió un tipo de imagen permitido.");
      }

      const bytes = new Uint8Array(await sourceResponse.arrayBuffer());
      if (bytes.byteLength !== source.size) {
        throw new Error("El tamaño descargado no coincide con el inventario S3.");
      }
      const sourceSha256 = await sha256Hex(bytes);

      if (existing) {
        const savedHash = String(existing.customMetadata?.sha256 || "").toLowerCase();
        if (savedHash) {
          if (savedHash !== sourceSha256) {
            result.conflicts += 1;
            result.errors.push({
              key: path,
              reason: "Ya existe en R2 con SHA-256 distinto; no se sobrescribió."
            });
            continue;
          }
        } else {
          // Legacy objects without our checksum metadata are read back and hashed.
          // Matching size alone is never considered proof that the object is identical.
          const existingObject = await bucket.get(path);
          if (!existingObject) throw new Error("El objeto existente desapareció durante la verificación.");
          const existingBytes = await existingObject.arrayBuffer();
          const existingSha256 = await sha256Hex(existingBytes);
          if (existingBytes.byteLength !== source.size || existingSha256 !== sourceSha256) {
            result.conflicts += 1;
            result.errors.push({
              key: path,
              reason: "El contenido existente en R2 no coincide por SHA-256; no se sobrescribió."
            });
            continue;
          }
        }
        result.alreadyPresent += 1;
        result.sha256Verified += 1;
        continue;
      }

      await bucket.put(path, bytes, {
        httpMetadata: {
          contentType,
          cacheControl: "public, max-age=31536000, immutable"
        },
        customMetadata: {
          source: "supabase-s3-migration",
          sourceBucket: SOURCE_BUCKET,
          sha256: sourceSha256
        }
      });

      const saved = await bucket.head(path);
      if (!saved || saved.size !== source.size ||
          String(saved.customMetadata?.sha256 || "").toLowerCase() !== sourceSha256) {
        throw new Error("La verificación de metadatos del objeto guardado no coincide.");
      }

      // Read the written object back from R2. This verifies bytes, not only metadata or size.
      const readback = await bucket.get(path);
      if (!readback) throw new Error("R2 no devolvió el objeto después de guardarlo.");
      const savedBytes = await readback.arrayBuffer();
      const savedSha256 = await sha256Hex(savedBytes);
      if (savedBytes.byteLength !== source.size || savedSha256 !== sourceSha256) {
        throw new Error("La verificación SHA-256 posterior a la copia no coincide.");
      }

      result.copied += 1;
      result.sha256Verified += 1;
      result.bytesCopied += bytes.byteLength;
    } catch (error) {
      result.failed += 1;
      result.errors.push({
        key: path,
        reason: error instanceof Error ? error.message : "Error desconocido al copiar."
      });
    }
  }

  return {
    ...result,
    processed: sourcePage.objects.length,
    nextContinuationToken: sourcePage.nextContinuationToken,
    isTruncated: sourcePage.isTruncated
  };
}

export async function onRequest(context) {
  if (context.request.method !== "POST") return jsonResponse(405, { error: "Método no permitido." });

  const auth = await requireCatalogAdmin(context.request, context.env);
  if (!auth.ok) return auth.response;

  if (storageUnavailable(context.env)) {
    return jsonResponse(503, { error: "R2 no está enlazado en este entorno. La migración no se ejecutó." });
  }
  const bucket = context.env.PRODUCT_IMAGES;
  if (typeof bucket.head !== "function" || typeof bucket.get !== "function") {
    return jsonResponse(503, { error: "El binding R2 no ofrece las operaciones necesarias para verificar archivos. La migración no se ejecutó." });
  }

  let payload;
  try { payload = await context.request.json(); }
  catch { return jsonResponse(400, { error: "Solicitud JSON inválida." }); }

  const action = String(payload?.action || "");
  const continuationToken = String(payload?.continuationToken || "");
  if (continuationToken.length > 4096) return jsonResponse(400, { error: "Token de continuación inválido." });

  try {
    if (action === "inventory") {
      const inventory = await inventorySourceObjects(context.env);
      return jsonResponse(200, {
        data: {
          ...inventory,
          message: inventory.isTruncated
            ? inventory.message
            : "Inventario completo de " + inventory.objectCount + " objetos en " +
              inventory.pageCount + " página(s). No se modificó ningún objeto."
        }
      });
    }

    if (action === "copy") {
      const requestedBatch = Number(payload?.batchSize || MAX_BATCH_SIZE);
      const batchSize = Number.isInteger(requestedBatch)
        ? Math.min(MAX_BATCH_SIZE, Math.max(1, requestedBatch))
        : MAX_BATCH_SIZE;
      const result = await copyBatch(context, continuationToken, batchSize);
      return jsonResponse(200, {
        data: result,
        message: result.failed || result.conflicts
          ? "Lote completado con incidencias. No se eliminaron archivos del origen."
          : "Lote copiado y verificado. El origen permanece intacto."
      });
    }

    return jsonResponse(400, { error: "Acción no válida. Usá inventory o copy." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo completar la operación S3.";
    const sourceRestricted = /HTTP 402/.test(message);
    console.error("JB Supabase-to-R2 migration failed:", message);
    return jsonResponse(sourceRestricted ? 503 : 502, {
      code: sourceRestricted ? "SUPABASE_SERVICE_RESTRICTED" : "MIGRATION_FAILED",
      error: message
    });
  }
}
