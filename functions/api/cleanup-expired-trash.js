import { jsonResponse, requireCatalogAdmin, validObjectPath, storageUnavailable } from "../_shared/neon-admin.js";

const RETENTION_DAYS = 15;
const MAX_PRODUCTS_PER_RUN = 25;
const PAGE_SIZE = 1000;
const SOURCE_STORAGE_ORIGIN = "https://uwqnoadelnnplcvqqlyz.supabase.co";
const SOURCE_BUCKET = "product-images";
const PUBLIC_MEDIA_ORIGIN = "https://jb-collections.pages.dev";

function decodePathSegments(value) {
  try {
    const parts = String(value || "").split("/").map(part => decodeURIComponent(part));
    return validObjectPath(parts.join("/"));
  } catch {
    return null;
  }
}

export function storageObjectPath(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();

  // Current and legacy image URLs are only parsed here; this endpoint never
  // fetches from Supabase. Actual deletion always targets the isolated R2 bucket.
  try {
    const url = new URL(raw);
    let remainder = "";
    if (url.origin === SOURCE_STORAGE_ORIGIN) {
      const prefix = "/storage/v1/object/";
      const index = url.pathname.indexOf(prefix);
      if (index < 0) return null;
      const segments = url.pathname.slice(index + prefix.length).split("/");
      if (!["public", "sign", "authenticated"].includes(segments[0] || "") || segments[1] !== SOURCE_BUCKET) return null;
      remainder = segments.slice(2).join("/");
    } else if (url.origin === PUBLIC_MEDIA_ORIGIN || url.hostname.endsWith(".jb-collections.pages.dev")) {
      if (!url.pathname.startsWith("/media/")) return null;
      remainder = url.pathname.slice("/media/".length);
    } else {
      return null;
    }
    return decodePathSegments(remainder);
  } catch {
    return decodePathSegments(raw);
  }
}

export function collectStoragePaths(value, paths = new Set()) {
  if (typeof value === "string") {
    const path = storageObjectPath(value);
    if (path) paths.add(path);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStoragePaths(item, paths);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStoragePaths(item, paths);
  }
  return paths;
}

async function dataApiRequest(env, token, table, filters, options = {}) {
  const base = String(env.NEON_DATA_API_URL || "").replace(/\/+$/, "");
  if (!base) throw new Error("NEON_DATA_API_URL is not configured.");
  const url = new URL(base + "/" + encodeURIComponent(table));
  for (const [key, value] of Object.entries(filters || {})) url.searchParams.set(key, value);
  const response = await fetch(url.toString(), {
    method: options.method || "GET",
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/json",
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(options.returnRepresentation ? { Prefer: "return=representation" } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error("Neon catalog operation failed (" + response.status + ").");
    error.status = response.status;
    throw error;
  }
  return Array.isArray(payload) ? payload : [];
}

export async function onRequest(context) {
  const request = context.request;
  if (request.method !== "POST") return jsonResponse(405, { error: "Método no permitido." });
  if (storageUnavailable(context.env)) return jsonResponse(503, { error: "El almacenamiento R2 no está enlazado." });

  const auth = await requireCatalogAdmin(request, context.env);
  if (!auth.ok) return auth.response;

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const token = auth.token;
  const env = context.env;

  try {
    const candidates = await dataApiRequest(env, token, "products", {
      select: "id,name,workflow_status,deleted_at,image_url,images,variants,colors",
      workflow_status: "in.(trash,deleting)",
      deleted_at: "lte." + cutoff,
      order: "deleted_at.asc",
      limit: String(MAX_PRODUCTS_PER_RUN)
    });

    if (!candidates.length) {
      return jsonResponse(200, {
        ok: true, retentionDays: RETENTION_DAYS, cutoff,
        processed: 0, deleted: 0, failed: 0, removedFiles: 0,
        message: "No hay productos vencidos en la papelera."
      });
    }

    const candidateIds = new Set(candidates.map(product => String(product.id)));
    const allProducts = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const rows = await dataApiRequest(env, token, "products", {
        select: "id,image_url,images,variants,colors",
        order: "id.asc",
        limit: String(PAGE_SIZE),
        offset: String(offset)
      });
      allProducts.push(...rows);
      if (rows.length < PAGE_SIZE) break;
    }

    const referencedElsewhere = new Set();
    for (const product of allProducts) {
      if (candidateIds.has(String(product.id))) continue;
      collectStoragePaths(product, referencedElsewhere);
    }

    let deleted = 0;
    let failed = 0;
    let skippedByRace = 0;
    let removedFiles = 0;

    for (const product of candidates) {
      const id = String(product.id);
      const marked = await dataApiRequest(env, token, "products", {
        id: "eq." + id,
        workflow_status: "in.(trash,deleting)",
        deleted_at: "lte." + cutoff,
        select: "id,workflow_status,deleted_at"
      }, {
        method: "PATCH",
        body: { workflow_status: "deleting", is_published: false },
        returnRepresentation: true
      });

      if (!marked.some(row => String(row.id) === id && row.workflow_status === "deleting")) {
        skippedByRace++;
        continue;
      }

      // Re-read the row after marking it, so a concurrent restore is not treated
      // as an expired deletion candidate.
      const current = await dataApiRequest(env, token, "products", {
        id: "eq." + id,
        workflow_status: "eq.deleting",
        deleted_at: "lte." + cutoff,
        select: "id,workflow_status,deleted_at,image_url,images,variants,colors",
        limit: "1"
      });
      if (!current.length) {
        skippedByRace++;
        continue;
      }

      const paths = [...collectStoragePaths(current[0])].filter(path => !referencedElsewhere.has(path));
      let removalFailed = false;
      const pending = [];
      for (const path of paths) {
        try {
          const object = await env.PRODUCT_IMAGES.head(path);
          if (object) pending.push(path);
        } catch (error) {
          console.error("R2 object check failed:", error instanceof Error ? error.message : "unknown error");
          removalFailed = true;
          break;
        }
      }

      if (!removalFailed) {
        for (let offset = 0; offset < pending.length; offset += 100) {
          try {
            const batch = pending.slice(offset, offset + 100);
            await env.PRODUCT_IMAGES.delete(batch);
            removedFiles += batch.length;
          } catch (error) {
            console.error("R2 object deletion failed:", error instanceof Error ? error.message : "unknown error");
            removalFailed = true;
            break;
          }
        }
      }

      if (removalFailed) {
        failed++;
        continue;
      }

      const removed = await dataApiRequest(env, token, "products", {
        id: "eq." + id,
        workflow_status: "eq.deleting",
        deleted_at: "lte." + cutoff,
        select: "id"
      }, {
        method: "DELETE",
        returnRepresentation: true
      });
      if (!removed.some(row => String(row.id) === id)) {
        failed++;
        continue;
      }
      deleted++;
    }

    return jsonResponse(failed ? 207 : 200, {
      ok: failed === 0,
      retentionDays: RETENTION_DAYS,
      cutoff,
      processed: candidates.length,
      deleted,
      failed,
      skippedByRace,
      removedFiles
    });
  } catch (error) {
    console.error("Expired catalog trash cleanup failed:", error instanceof Error ? error.message : "unknown error");
    return jsonResponse(502, { error: "No se pudo completar la limpieza de la papelera." });
  }
}
