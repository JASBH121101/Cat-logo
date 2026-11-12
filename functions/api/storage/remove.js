import { jsonResponse, requireCatalogAdmin, validObjectPath, storageUnavailable, isFiverrDemoRequest } from "../../_shared/neon-admin.js";

export async function onRequest(context) {
  if (!isFiverrDemoRequest(context.request)) return jsonResponse(404, { error: "not_found" });
  if (context.request.method !== "POST") return jsonResponse(405, { error: "Método no permitido." });
  if (storageUnavailable(context.env)) return jsonResponse(503, { error: "El almacenamiento R2 no está enlazado." });

  const auth = await requireCatalogAdmin(context.request, context.env);
  if (!auth.ok) return auth.response;

  let payload;
  try { payload = await context.request.json(); }
  catch { return jsonResponse(400, { error: "Solicitud JSON inválida." }); }

  if (!Array.isArray(payload?.paths) || payload.paths.length < 1 || payload.paths.length > 100) {
    return jsonResponse(400, { error: "Se permiten entre 1 y 100 rutas por operación." });
  }
  const paths = payload.paths.map(validObjectPath);
  if (paths.some(path => !path) || new Set(paths).size !== paths.length) {
    return jsonResponse(400, { error: "La lista contiene rutas inválidas o repetidas." });
  }

  try {
    await context.env.PRODUCT_IMAGES.delete(paths);
    return jsonResponse(200, { data: paths.map(path => ({ name: path, bucket: "product-images" })) });
  } catch (error) {
    console.error("JB R2 delete failed:", error instanceof Error ? error.message : "unknown error");
    return jsonResponse(502, { error: "R2 no pudo eliminar uno o más objetos." });
  }
}
