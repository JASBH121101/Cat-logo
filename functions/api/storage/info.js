import { jsonResponse, requireCatalogAdmin, validObjectPath, storageUnavailable, isFiverrDemoRequest } from "../../_shared/neon-admin.js";

export async function onRequest(context) {
  if (!isFiverrDemoRequest(context.request)) return jsonResponse(404, { error: "not_found" });
  if (context.request.method !== "GET" && context.request.method !== "HEAD") {
    return jsonResponse(405, { error: "Método no permitido." });
  }
  if (storageUnavailable(context.env)) return jsonResponse(503, { error: "El almacenamiento R2 no está enlazado." });

  const auth = await requireCatalogAdmin(context.request, context.env);
  if (!auth.ok) return auth.response;

  const path = validObjectPath(new URL(context.request.url).searchParams.get("path"));
  if (!path) return jsonResponse(400, { error: "Ruta de imagen inválida." });

  try {
    const object = await context.env.PRODUCT_IMAGES.head(path);
    if (!object) return jsonResponse(404, { error: "La imagen no existe en R2." });
    return jsonResponse(200, {
      data: {
        path,
        size: object.size,
        etag: object.etag,
        uploaded: object.uploaded?.toISOString?.() || null,
        contentType: object.httpMetadata?.contentType || null,
        cacheControl: object.httpMetadata?.cacheControl || null
      }
    });
  } catch (error) {
    console.error("JB R2 metadata lookup failed:", error instanceof Error ? error.message : "unknown error");
    return jsonResponse(502, { error: "No se pudo consultar la imagen." });
  }
}
