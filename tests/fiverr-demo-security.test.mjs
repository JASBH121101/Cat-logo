import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { onRequest as guests } from "../functions/api/admin/guests.js";
import { onRequest as upload } from "../functions/api/storage/upload.js";
import { onRequest as remove } from "../functions/api/storage/remove.js";
import { onRequest as info } from "../functions/api/storage/info.js";
import { onRequest as cacheRescue } from "../functions/api/migration/cache-rescue.js";
import { onRequest as neonAuthProxy } from "../functions/api/neon-auth/[[path]].js";
import { onRequest as supabaseMigration } from "../functions/api/migration/supabase-r2.js";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("the legacy self-registration function is removed by migration 0015", () => {
  const migration = read("db/migrations/0015_fiverr_demo_remove_legacy_self_registration.sql");
  assert.match(migration, /DROP FUNCTION IF EXISTS public\.register_fiverr_demo_viewer\(\)/);
  assert.match(migration, /VALUES \('0015', 'fiverr_demo_remove_legacy_self_registration'\)/);
  assert.doesNotMatch(read("admin.js"), /register_fiverr_demo_viewer/);
});

test("guest provisioning requires the dedicated HTTPS demo host and same-origin browser calls", () => {
  const request = new Request("https://other.jb-collections.pages.dev/api/admin/guests", { method: "POST" });
  return guests({ request, env: {} }).then(async response => {
    assert.equal(response.status, 404);
    const sameHost = new Request("https://fiverr-demo.jb-collections.pages.dev/api/admin/guests", { method: "POST" });
    assert.equal((await guests({ request: sameHost, env: {} })).status, 401);
    const forgedOrigin = new Request("https://fiverr-demo.jb-collections.pages.dev/api/admin/guests", {
      method: "POST", headers: { Origin: "https://attacker.example" }
    });
    assert.equal((await guests({ request: forgedOrigin, env: {} })).status, 403);
  });
});

test("R2 storage and cache recovery mutation APIs reject every non-demo hostname before auth or storage", async () => {
  const env = { PRODUCT_IMAGES: { put() {}, head() {}, get() {}, delete() {} } };
  const cases = [
    [upload, "POST", "/api/storage/upload"],
    [remove, "POST", "/api/storage/remove"],
    [info, "GET", "/api/storage/info"],
    [cacheRescue, "POST", "/api/migration/cache-rescue"]
  ];
  for (const [handler, method, path] of cases) {
    const request = new Request("https://random-preview.jb-collections.pages.dev" + path, { method });
    const response = await handler({ request, env });
    assert.equal(response.status, 404, path + " must reject the wrong hostname");
  }
});

test("R2 storage APIs require an authenticated owner on the dedicated demo hostname", async () => {
  const env = { PRODUCT_IMAGES: { put() {}, head() {}, get() {}, delete() {} } };
  const cases = [
    [upload, "POST", "/api/storage/upload"],
    [remove, "POST", "/api/storage/remove"],
    [info, "GET", "/api/storage/info"],
    [cacheRescue, "POST", "/api/migration/cache-rescue"]
  ];
  for (const [handler, method, path] of cases) {
    const request = new Request("https://fiverr-demo.jb-collections.pages.dev" + path, { method });
    const response = await handler({ request, env });
    assert.equal(response.status, 401, path + " must authenticate before accessing R2");
  }
});

test("uploads use conditional create-only semantics and never overwrite an existing image", () => {
  assert.match(read("functions/api/storage/upload.js"), /onlyIf:\s*\{\s*etagDoesNotMatch:\s*"\*"\s*\}/);
  assert.match(read("functions/api/migration/cache-rescue.js"), /onlyIf:\s*\{\s*etagDoesNotMatch:\s*"\*"\s*\}/);
});

test("Supabase-to-R2 migration is isolated to its dedicated migration Preview, never the Fiverr demo", async () => {
  const wrongHost = new Request("https://fiverr-demo.jb-collections.pages.dev/api/migration/supabase-r2", { method: "POST" });
  assert.equal((await supabaseMigration({ request: wrongHost, env: {} })).status, 404);
  assert.match(read("functions/api/migration/supabase-r2.js"), /migration-neon-r2\.jb-collections\.pages\.dev/);
});

test("guest provisioning fails closed when Neon Data API is missing and never uses a fallback host", () => {
  const source = read("functions/api/admin/guests.js");
  assert.match(source, /env\.NEON_DATA_API_URL \|\| ""/);
  assert.match(source, /NEON_DATA_API_URL no está configurada/);
  assert.doesNotMatch(source, /DATA_API_FALLBACK|ep-wandering-scene/);
});

test("Neon Auth proxy is restricted to the demo and isolated migration Preview hosts", async () => {
  const wrongHost = new Request("https://other-preview.jb-collections.pages.dev/api/neon-auth/get-session", { method: "GET" });
  assert.equal((await neonAuthProxy({ request: wrongHost, env: {} })).status, 404);

  const insecure = new Request("http://fiverr-demo.jb-collections.pages.dev/api/neon-auth/get-session", { method: "GET" });
  assert.equal((await neonAuthProxy({ request: insecure, env: {} })).status, 404);

  const demoUnsupportedMethod = new Request("https://fiverr-demo.jb-collections.pages.dev/api/neon-auth/get-session", { method: "PATCH" });
  assert.equal((await neonAuthProxy({ request: demoUnsupportedMethod, env: {} })).status, 405);

  const migrationUnsupportedMethod = new Request("https://migration-neon-r2.jb-collections.pages.dev/api/neon-auth/get-session", { method: "PATCH" });
  assert.equal((await neonAuthProxy({ request: migrationUnsupportedMethod, env: {} })).status, 405);
});
