import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 15;
const BUCKET = Deno.env.get("CATALOG_STORAGE_BUCKET") || "product-images";

function jsonResponse(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function collectProductStoragePaths(
  product: Record<string, unknown>,
  storageOrigin: string,
  productId: string
): string[] {
  const prefix = `/storage/v1/object/public/${BUCKET}/`;
  const paths = new Set<string>();

  const visit = (value: unknown) => {
    if (typeof value === "string") {
      if (!/^https?:\/\//i.test(value)) return;
      try {
        const url = new URL(value);
        if (url.origin !== storageOrigin || !url.pathname.startsWith(prefix)) return;
        const encodedPath = url.pathname.slice(prefix.length);
        const path = encodedPath.split("/").map(part => {
          try { return decodeURIComponent(part); } catch { return part; }
        }).join("/");
        // Current uploader stores every product image beneath its UUID folder.
        // This guard prevents this cleanup from removing another product's file.
        if (!path || path.split("/").some(part => part === "." || part === "..")) return;
        if (path.split("/")[0] !== productId) return;
        paths.add(path);
      } catch {
        // Ignore malformed or external URLs.
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach(visit);
    }
  };

  visit(product);
  return [...paths];
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  const expectedSecret = Deno.env.get("CATALOG_TRASH_CLEANUP_SECRET") || "";
  const receivedSecret = request.headers.get("x-cron-secret") || "";
  if (!expectedSecret || !safeEqual(receivedSecret, expectedSecret)) {
    return jsonResponse(401, { error: "Unauthorized." });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, { error: "Required server configuration is missing." });
  }

  let storageOrigin: string;
  try {
    storageOrigin = new URL(supabaseUrl).origin;
  } catch {
    return jsonResponse(500, { error: "Supabase URL is invalid." });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const cutoff = new Date(Date.now() - RETENTION_DAYS * DAY_MS).toISOString();

  const { data: candidates, error: queryError } = await supabase
    .from("products")
    .select("*")
    .in("workflow_status", ["trash", "deleting"])
    .lte("deleted_at", cutoff)
    .order("deleted_at", { ascending: true })
    .limit(100);

  if (queryError) {
    console.error("Failed to list expired trash products:", queryError.message);
    return jsonResponse(500, { error: "Could not list expired trash products." });
  }

  const summary = { found: candidates?.length || 0, deleted: 0, retried: 0, failures: 0 };
  for (const candidate of (candidates || []) as Record<string, unknown>[]) {
    const id = String(candidate.id || "");
    if (!id) {
      summary.failures++;
      continue;
    }

    let claimed = candidate;
    if (candidate.workflow_status === "trash") {
      const { data, error } = await supabase
        .from("products")
        .update({ workflow_status: "deleting", is_published: false })
        .eq("id", id)
        .eq("workflow_status", "trash")
        .lte("deleted_at", cutoff)
        .select("*")
        .maybeSingle();

      if (error) {
        console.error("Failed to claim expired product:", id, error.message);
        summary.failures++;
        continue;
      }
      if (!data) continue;
      claimed = data as Record<string, unknown>;
    } else {
      summary.retried++;
    }

    const paths = collectProductStoragePaths(claimed, storageOrigin, id);
    if (paths.length) {
      const { error: storageError } = await supabase.storage.from(BUCKET).remove(paths);
      if (storageError) {
        console.error("Storage cleanup failed for expired product:", id, storageError.message);
        await supabase
          .from("products")
          .update({ workflow_status: "trash", is_published: false })
          .eq("id", id)
          .eq("workflow_status", "deleting");
        summary.failures++;
        continue;
      }
    }

    const { data: deletedRows, error: deleteError } = await supabase
      .from("products")
      .delete()
      .eq("id", id)
      .eq("workflow_status", "deleting")
      .lte("deleted_at", cutoff)
      .select("id");

    if (deleteError) {
      // Keep the row in 'deleting' so the next scheduled run retries the DB delete.
      console.error("Database cleanup failed for expired product:", id, deleteError.message);
      summary.failures++;
      continue;
    }

    if (deletedRows?.length) summary.deleted++;
  }

  return jsonResponse(200, { ok: true, retention_days: RETENTION_DAYS, ...summary });
});
