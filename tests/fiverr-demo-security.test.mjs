import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { onRequest as guests } from "../functions/api/admin/guests.js";
import { onRequest as upload } from "../functions/api/storage/upload.js";
import { onRequest as remove } from "../functions/api/storage/remove.js";
import { onRequest as info } from "../functions/api/storage/info.js";
import { onRequest as neonAuthProxy } from "../functions/api/neon-auth/[[path]].js";

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

test("R2 storage APIs reject every non-demo hostname before auth or storage", async () => {
  const env = { PRODUCT_IMAGES: { put() {}, head() {}, get() {}, delete() {} } };
  const cases = [
    [upload, "POST", "/api/storage/upload"],
    [remove, "POST", "/api/storage/remove"],
    [info, "GET", "/api/storage/info"],
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
  ];
  for (const [handler, method, path] of cases) {
    const request = new Request("https://fiverr-demo.jb-collections.pages.dev" + path, { method });
    const response = await handler({ request, env });
    assert.equal(response.status, 401, path + " must authenticate before accessing R2");
  }
});

test("uploads use conditional create-only semantics and never overwrite an existing image", () => {
  assert.match(read("functions/api/storage/upload.js"), /onlyIf:\s*\{\s*etagDoesNotMatch:\s*"\*"\s*\}/);
});

test("guest provisioning fails closed when Neon Data API is missing and never uses a fallback host", () => {
  const source = read("functions/api/admin/guests.js");
  assert.match(source, /env\.NEON_DATA_API_URL \|\| ""/);
  assert.match(source, /NEON_DATA_API_URL no está configurada/);
  assert.doesNotMatch(source, /DATA_API_FALLBACK|ep-wandering-scene/);
});

test("Neon Auth proxy is restricted to the dedicated Fiverr demo host", async () => {
  const wrongHost = new Request("https://other-preview.jb-collections.pages.dev/api/neon-auth/get-session", { method: "GET" });
  assert.equal((await neonAuthProxy({ request: wrongHost, env: {} })).status, 404);

  const insecure = new Request("http://fiverr-demo.jb-collections.pages.dev/api/neon-auth/get-session", { method: "GET" });
  assert.equal((await neonAuthProxy({ request: insecure, env: {} })).status, 404);

  const demoUnsupportedMethod = new Request("https://fiverr-demo.jb-collections.pages.dev/api/neon-auth/get-session", { method: "PATCH" });
  assert.equal((await neonAuthProxy({ request: demoUnsupportedMethod, env: {} })).status, 405);

});


test("Neon Auth proxy resolves owner and guest usernames to their reserved Gmail aliases", async () => {
  const originalFetch = globalThis.fetch;
  const forwarded = [];
  globalThis.fetch = async (url, options = {}) => {
    forwarded.push({ url: String(url), payload: JSON.parse(new TextDecoder().decode(options.body)) });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  try {
    const cases = [
      ["JaredBH", "owner@gmail.com"],
      ["ventas_01", "owner+ventas_01@gmail.com"]
    ];
    for (const [username, expectedEmail] of cases) {
      const request = new Request("https://fiverr-demo.jb-collections.pages.dev/api/neon-auth/sign-in/email", {
        method: "POST",
        headers: {
          Origin: "https://fiverr-demo.jb-collections.pages.dev",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email: username, password: "not-a-real-password" })
      });
      const response = await neonAuthProxy({
        request,
        env: {
          DEMO_OWNER_AUTH_EMAIL: "owner@gmail.com",
          NEON_AUTH_BASE_URL: "https://auth.example.neon.tech/fiverr_auth/auth"
        }
      });
      assert.equal(response.status, 200);
      assert.equal(forwarded.at(-1).payload.email, expectedEmail);
      assert.match(forwarded.at(-1).url, /\/fiverr_auth\/auth\/sign-in\/email$/);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Neon Auth proxy fails closed when username-to-email mapping is not configured", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalled = false;
  globalThis.fetch = async () => {
    upstreamCalled = true;
    return new Response("{}", { status: 200 });
  };

  try {
    const request = new Request("https://fiverr-demo.jb-collections.pages.dev/api/neon-auth/sign-in/email", {
      method: "POST",
      headers: {
        Origin: "https://fiverr-demo.jb-collections.pages.dev",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email: "JaredBH", password: "not-a-real-password" })
    });
    const response = await neonAuthProxy({
      request,
      env: { NEON_AUTH_BASE_URL: "https://auth.example.neon.tech/fiverr_auth/auth" }
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "demo_username_login_not_configured");
    assert.equal(upstreamCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
