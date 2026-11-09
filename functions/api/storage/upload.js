import { jsonResponse, requireCatalogAdmin, validObjectPath, storageUnavailable } from "../../_shared/neon-admin.js";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]);

function validImageBytes(bytes, type) {
  if (type === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value);
  if (type === "image/gif") return bytes.length >= 6 && (String.fromCharCode(...bytes.slice(0,6)) === "GIF87a" || String.fromCharCode(...bytes.slice(0,6)) === "GIF89a");
  if (type === "image/webp") return bytes.length >= 12 && String.fromCharCode(...bytes.slice(0,4)) === "RIFF" && String.fromCharCode(...bytes.slice(8,12)) === "WEBP";
  if (type === "image/avif") return bytes.length >= 12 && String.fromCharCode(...bytes.slice(4,8)) === "ftyp" && /avif|avis/.test(String.fromCharCode(...bytes.slice(8,16)));
  return false;
}

export async function onRequest(context) {
  if (context.request.method !== "POST") return jsonResponse(405, { error: "Método no permitido." });
  if (storageUnavailable(context.env)) return jsonResponse(503, { error: "El almacenamiento R2 no está enlazado." });

  const auth = await requireCatalogAdmin(context.request, context.env);
  if (!auth.ok) return auth.response;

  const url = new URL(context.request.url);
  if (url.searchParams.get("bucket") !== "product-images") return jsonResponse(400, { error: "Bucket no permitido." });
  const path = validObjectPath(url.searchParams.get("path"));
  if (!path) return jsonResponse(400, { error: "Ruta de imagen inválida." });

  const type = String(context.request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.has(type)) return jsonResponse(415, { error: "Formato de imagen no permitido." });
  const declaredSize = Number(context.request.headers.get("Content-Length") || 0);
  if (declaredSize > MAX_IMAGE_BYTES) return jsonResponse(413, { error: "La imagen supera el límite de 15 MB." });

  try {
    const bytes = new Uint8Array(await context.request.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return jsonResponse(413, { error: "La imagen está vacía o supera el límite de 15 MB." });
    if (!validImageBytes(bytes, type)) return jsonResponse(415, { error: "El contenido del archivo no coincide con un formato de imagen permitido." });

    const existing = await context.env.PRODUCT_IMAGES.head(path);
    if (existing) return jsonResponse(409, { error: "Ya existe una imagen con esa ruta." });

    const object = await context.env.PRODUCT_IMAGES.put(path, bytes, {
      httpMetadata: {
        contentType: type,
        cacheControl: "public, max-age=31536000, immutable"
      },
      customMetadata: {
        uploadedBy: auth.adminId,
        source: "jb-manager"
      }
    });
    return jsonResponse(201, { data: { path, etag: object.etag, size: bytes.byteLength } });
  } catch (error) {
    console.error("JB R2 upload failed:", error instanceof Error ? error.message : "unknown error");
    return jsonResponse(502, { error: "No se pudo guardar la imagen en R2." });
  }
}
