import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";

const PROJECT_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BUCKET = "product-images";
const RETENTION_DAYS = 15;
const MAX_PRODUCTS_PER_RUN = 25;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8"
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

function storageObjectPath(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.origin !== PROJECT_URL) return null;
    const marker = "/storage/v1/object/";
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex < 0) return null;
    const rest = url.pathname.slice(markerIndex + marker.length);
    const parts = rest.split("/");
    if (!["public", "sign", "authenticated"].includes(parts[0] ?? "")) return null;
    if (parts[1] !== BUCKET || parts.length < 3) return null;
    return decodeURIComponent(parts.slice(2).join("/"));
  } catch {
    return null;
  }
}

function collectStoragePaths(value: unknown, paths = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    const path = storageObjectPath(value);
    if (path) paths.add(path);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStoragePaths(item, paths);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectStoragePaths(item, paths);
  }
  return paths;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);
  if (!PROJECT_URL || !SERVICE_ROLE_KEY) {
    console.error("Cleanup function is missing its Supabase runtime configuration.");
    return jsonResponse({ error: "Cleanup service is not configured." }, 500);
  }

  const supabase = createClient(PROJECT_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: candidates, error: candidateError } = await supabase
    .from("products")
    .select("id, workflow_status, deleted_at, images, image_url, variants, colors, name")
    .in("workflow_status", ["trash", "deleting"])
    .lte("deleted_at", cutoff)
    .order("deleted_at", { ascending: true })
    .limit(MAX_PRODUCTS_PER_RUN);

  if (candidateError) {
    console.error("Unable to list expired trash:", candidateError.message);
    return jsonResponse({ error: "Could not read expired products." }, 500);
  }
  if (!candidates?.length) {
    return jsonResponse({ ok: true, cutoff, processed: 0, deleted: 0, failed: 0, message: "No expired products." });
  }

  // Do not remove an object if any product outside this cleanup batch still references it.
  const candidateIds = new Set(candidates.map((item) => String(item.id)));
  const allProducts: Array<Record<string, unknown>> = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("products")
      .select("id, images, image_url, variants, colors")
      .range(offset, offset + 999);
    if (error) {
      console.error("Unable to check shared image references:", error.message);
      return jsonResponse({ error: "Could not verify image references; nothing was deleted." }, 500);
    }
    allProducts.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const referencedElsewhere = new Set<string>();
  for (const product of allProducts) {
    if (candidateIds.has(String(product.id))) continue;
    collectStoragePaths(product, referencedElsewhere);
  }

  let deleted = 0;
  let failed = 0;
  let skippedByRace = 0;
  let removedFiles = 0;

  for (const product of candidates) {
    // Recheck state and expiry to avoid racing a concurrent restore.
    const { data: marked, error: markError } = await supabase
      .from("products")
      .update({ workflow_status: "deleting", is_published: false })
      .eq("id", product.id)
      .in("workflow_status", ["trash", "deleting"])
      .lte("deleted_at", cutoff)
      .select("id");

    if (markError) {
      console.error("Could not mark expired product for cleanup:", product.id, markError.message);
      failed++;
      continue;
    }
    if (!Array.isArray(marked) || !marked.some((row) => String(row.id) === String(product.id))) {
      skippedByRace++;
      continue;
    }

    const paths = [...collectStoragePaths(product)].filter((path) => !referencedElsewhere.has(path));
    const pathsToRemove: string[] = [];
    let fileCheckFailed = false;

    // Existence checks make retries safe when a previous run removed only some files.
    for (const path of paths) {
      const { data: exists, error: existsError } = await supabase.storage.from(BUCKET).exists(path);
      if (existsError) {
        console.error("Could not check a Storage object:", existsError.message);
        fileCheckFailed = true;
        break;
      }
      if (exists) pathsToRemove.push(path);
    }

    if (fileCheckFailed) {
      failed++;
      continue;
    }

    let fileRemovalFailed = false;
    for (let offset = 0; offset < pathsToRemove.length; offset += 100) {
      const batch = pathsToRemove.slice(offset, offset + 100);
      const { error: removeError } = await supabase.storage.from(BUCKET).remove(batch);
      if (removeError) {
        console.error("Storage cleanup failed for product:", product.id, removeError.message);
        fileRemovalFailed = true;
        break;
      }
      removedFiles += batch.length;
    }
    if (fileRemovalFailed) {
      // Keep workflow_status=deleting so the next scheduled run can retry safely.
      failed++;
      continue;
    }

    const { data: removedRows, error: deleteError } = await supabase
      .from("products")
      .delete()
      .eq("id", product.id)
      .eq("workflow_status", "deleting")
      .lte("deleted_at", cutoff)
      .select("id");

    if (deleteError || !Array.isArray(removedRows) || !removedRows.some((row) => String(row.id) === String(product.id))) {
      console.error("Unable to finish cleanup for product:", product.id, deleteError?.message ?? "No row deleted.");
      failed++;
      continue;
    }
    deleted++;
  }

  return jsonResponse({
    ok: failed === 0,
    cutoff,
    retentionDays: RETENTION_DAYS,
    processed: candidates.length,
    deleted,
    failed,
    skippedByRace,
    removedFiles
  }, failed ? 207 : 200);
});
