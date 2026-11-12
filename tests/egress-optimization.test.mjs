import { onRequest as handleR2Migration, sha256Hex } from "../functions/api/migration/supabase-r2.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const mediaRoute = read("functions/media/[[path]].js");
const technology = read("app.js");
const perfumery = read("perfumeria.js");
const customerChat = read("private-chat.js");
const admin = read("admin.js");
const workflow = read(".github/workflows/catalog-static-checks.yml");
const migrationRoute = read("functions/api/migration/supabase-r2.js");

test("public product media is proxied through Cloudflare cache without exposing arbitrary origins", () => {
  assert.match(mediaRoute, /SUPABASE_STORAGE_ORIGIN = "https:\/\/uwqnoadelnnplcvqqlyz\.supabase\.co"/);
  assert.match(mediaRoute, /STORAGE_BUCKET = "product-images"/);
  assert.match(mediaRoute, /caches\.default/);
  assert.match(mediaRoute, /cache\.match\(cacheKey\)/);
  assert.match(mediaRoute, /cache\.put\(cacheKey, response\.clone\(\)\)/);
  assert.match(mediaRoute, /max-age=31536000, immutable/);
  assert.match(mediaRoute, /IMAGE_EXTENSIONS/);
  assert.match(mediaRoute, /jfif/);
  assert.match(mediaRoute, /context\.params\?\.path/);
  assert.match(mediaRoute, /request\.method !== "GET" && request\.method !== "HEAD"/);
  assert.doesNotMatch(mediaRoute, /Authorization/);
  assert.match(workflow, /functions\/media\/\*/);
});

test("technology and perfume catalogs route existing Supabase product images through Cloudflare", () => {
  for (const source of [technology, perfumery]) {
    assert.match(source, /function catalogMediaUrl\(value\)/);
    assert.match(source, /\/media\//);
    assert.match(source, /catalogMediaBaseUrl\(\)/);
    assert.match(source, /host\.endsWith\("\.jb-collections\.pages\.dev"\)/);
    assert.match(source, /storage\/v1\/object\/public/);
  }
  assert.match(technology, /catalogMediaUrl\(value\.trim\(\)\)/);
  assert.match(perfumery, /catalogMediaUrl\(item\.trim\(\)\)/);
});

test("newly uploaded image files receive long immutable browser cache headers", () => {
  assert.match(admin, /setRequestHeader\("cache-control","max-age=31536000, immutable"\)/);
});

test("customer private chat polls slowly and skips background tabs", () => {
  assert.match(customerChat, /PRIVATE_CHAT_REFRESH_INTERVAL_MS = 30_000/);
  assert.match(customerChat, /document\.visibilityState === "visible"/);
  assert.match(customerChat, /addEventListener\("visibilitychange", refreshPrivateChatWhenVisible\)/);
  assert.doesNotMatch(customerChat, /6500\)/);
});

test("admin private inbox polls less frequently and skips background tabs", () => {
  assert.match(admin, /PRIVATE_CHAT_ADMIN_REFRESH_INTERVAL_MS = 45_000/);
  assert.match(admin, /document\.visibilityState === "visible"/);
  assert.match(admin, /addEventListener\("visibilitychange", refreshPrivateChatAdminInboxWhenVisible\)/);
  assert.doesNotMatch(admin, /loadPrivateChatInbox\(\{ silent: true \}\);\s*\}, 15000\)/);
});

test("Supabase-to-R2 migration hashes content and verifies R2 readback", async () => {
  assert.equal(
    await sha256Hex(new TextEncoder().encode("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  );
  assert.match(migrationRoute, /async function inventorySourceObjects\(env\)/);
  assert.match(migrationRoute, /MAX_INVENTORY_PAGES/);
  assert.match(migrationRoute, /customMetadata:\s*\{[\s\S]*?sha256:\s*sourceSha256/);
  assert.match(migrationRoute, /const existingObject = await bucket\.get\(path\)/);
  assert.match(migrationRoute, /const existingSha256 = await sha256Hex\(existingBytes\)/);
  assert.match(migrationRoute, /existingBytes\.byteLength !== source\.size \|\| existingSha256 !== sourceSha256/);
  assert.doesNotMatch(migrationRoute, /if \(savedHash\)/);
  assert.match(migrationRoute, /const readback = await bucket\.get\(path\)/);
  assert.match(migrationRoute, /savedSha256 !== sourceSha256/);
  assert.match(migrationRoute, /Supabase restringió temporalmente el servicio por cuota \(HTTP 402\)/);
  assert.match(migrationRoute, /SUPABASE_SERVICE_RESTRICTED/);
});

test("admin migration resumes from a persisted cursor and explains service restriction without looping batches", () => {
  const adminMigration = read("admin-storage-migration.js");
  assert.match(adminMigration, /STATE_KEY/);
  assert.match(adminMigration, /function restoreProgress\(\)/);
  assert.match(adminMigration, /function persistProgress\(\)/);
  assert.match(adminMigration, /HTTP 402/);
  assert.match(adminMigration, /La migración quedó detenida/);
  assert.match(adminMigration, /La paginación S3 no avanzó/);
  assert.match(adminMigration, /no sobrescribió conflictos/);
  assert.match(adminMigration, /migrationCompleted/);
  assert.match(adminMigration, /sourceRestricted/);
  assert.match(adminMigration, /inventory\.isTruncated/);
  assert.match(adminMigration, /errors\.slice\(0, 10\)/);
});


const MIGRATION_DATA_API = "https://neon.example.test/neondb/rest/v1";
const MIGRATION_S3_PREFIX = "https://uwqnoadelnnplcvqqlyz.storage.supabase.co/storage/v1/s3/product-images";
const MIGRATION_SOURCE_BYTES = new Uint8Array([1, 2, 3, 4, 5]);

function xmlPage(objects, { truncated = false, nextToken = "" } = {}) {
  const contents = objects.map(item =>
    "<Contents><Key>" + item.key + "</Key><Size>" + item.size + "</Size></Contents>"
  ).join("");
  return "<ListBucketResult><IsTruncated>" + truncated + "</IsTruncated>" +
    (nextToken ? "<NextContinuationToken>" + nextToken + "</NextContinuationToken>" : "") +
    contents + "</ListBucketResult>";
}

function createR2Bucket({ seed = [], corruptReadback = false } = {}) {
  const objects = new Map(seed.map(item => [item.key, {
    bytes: new Uint8Array(item.bytes),
    customMetadata: item.customMetadata || {}
  }]));
  const calls = { put: 0, get: 0, head: 0 };
  return {
    objects,
    calls,
    async head(key) {
      calls.head += 1;
      const item = objects.get(key);
      return item ? { size: item.bytes.byteLength, customMetadata: item.customMetadata } : null;
    },
    async put(key, value, options = {}) {
      calls.put += 1;
      objects.set(key, {
        bytes: new Uint8Array(value),
        customMetadata: options.customMetadata || {},
        httpMetadata: options.httpMetadata || {}
      });
    },
    async get(key) {
      calls.get += 1;
      const item = objects.get(key);
      if (!item) return null;
      const bytes = new Uint8Array(item.bytes);
      if (corruptReadback && calls.put > 0) bytes[0] ^= 0xff;
      return { arrayBuffer: async () => bytes.slice().buffer };
    }
  };
}

function migrationEnv(PRODUCT_IMAGES) {
  return {
    NEON_DATA_API_URL: MIGRATION_DATA_API,
    SUPABASE_S3_ACCESS_KEY_ID: "test-access-key",
    SUPABASE_S3_SECRET_ACCESS_KEY: "test-secret-key",
    PRODUCT_IMAGES
  };
}

function migrationRequest(payload) {
  return new Request("https://migration-neon-r2.jb-collections.pages.dev/api/migration/supabase-r2", {
    method: "POST",
    headers: {
      Authorization: "Bearer migration-test-admin",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

async function withMigrationFetch(sourceHandler, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/rpc/catalog_admin_context")) {
      return Response.json([{ is_admin: true, admin_id: "migration-admin" }]);
    }
    if (url.origin === new URL(MIGRATION_S3_PREFIX).origin &&
        url.pathname.startsWith(new URL(MIGRATION_S3_PREFIX).pathname)) {
      return sourceHandler(url, init);
    }
    throw new Error("Unexpected migration request: " + url.href);
  };
  try {
    await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("R2 migration inventory follows every S3 continuation page without copying files", async () => {
  const bucket = createR2Bucket();
  const listCalls = [];
  await withMigrationFetch(async url => {
    listCalls.push(url.searchParams.get("continuation-token") || "");
    if (!url.searchParams.has("continuation-token")) {
      return new Response(xmlPage([
        { key: "products/phone-a.jpg", size: 5 },
        { key: "products/phone-b.jpg", size: 7 }
      ], { truncated: true, nextToken: "page-2" }), { status: 200 });
    }
    return new Response(xmlPage([
      { key: "invalid key.jpg", size: 11 },
        { key: "perfumes/amber.webp", size: 13 }
    ]), { status: 200 });
  }, async () => {
    const response = await handleR2Migration({
      request: migrationRequest({ action: "inventory" }),
      env: migrationEnv(bucket)
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.data.objectCount, 4);
    assert.equal(payload.data.totalBytes, 36);
    assert.equal(payload.data.pageCount, 2);
    assert.equal(payload.data.invalidObjectCount, 1);
    assert.equal(payload.data.isTruncated, false);
    assert.deepEqual(listCalls, ["", "page-2"]);
    assert.equal(bucket.calls.put, 0);
  });
});

test("R2 migration refuses to copy when S3 pagination returns an invalid continuation cursor", async () => {
  const bucket = createR2Bucket();
  await withMigrationFetch(async () =>
    new Response(xmlPage([{ key: "products/phone-a.jpg", size: 5 }], { truncated: true }), { status: 200 }),
  async () => {
    const response = await handleR2Migration({
      request: migrationRequest({ action: "inventory" }),
      env: migrationEnv(bucket)
    });
    const payload = await response.json();
    assert.equal(response.status, 502);
    assert.match(payload.error, /cursor de paginación inválido/i);
    assert.equal(bucket.calls.put, 0);
  });
});

test("R2 migration copies an image and verifies the bytes read back from R2", async () => {
  const bucket = createR2Bucket();
  let sourceGets = 0;
  await withMigrationFetch(async url => {
    if (url.pathname.endsWith("/product-images")) {
      return new Response(xmlPage([{ key: "products/phone-a.jpg", size: MIGRATION_SOURCE_BYTES.byteLength }]), { status: 200 });
    }
    sourceGets += 1;
    return new Response(MIGRATION_SOURCE_BYTES, { status: 200, headers: { "Content-Type": "image/jpeg" } });
  }, async () => {
    const response = await handleR2Migration({
      request: migrationRequest({ action: "copy", batchSize: 10 }),
      env: migrationEnv(bucket)
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.data.copied, 1);
    assert.equal(payload.data.failed, 0);
    assert.equal(payload.data.sha256Verified, 1);
    assert.equal(payload.data.bytesCopied, MIGRATION_SOURCE_BYTES.byteLength);
    assert.equal(sourceGets, 1);
    assert.equal(bucket.calls.put, 1);
    assert.equal(bucket.calls.get, 1);
    const stored = bucket.objects.get("products/phone-a.jpg");
    assert.equal(stored.customMetadata.sha256, await sha256Hex(MIGRATION_SOURCE_BYTES));
    assert.equal(stored.httpMetadata.cacheControl, "public, max-age=31536000, immutable");
    assert.deepEqual([...stored.bytes], [...MIGRATION_SOURCE_BYTES]);
  });
});

test("R2 migration does not overwrite an existing object whose bytes differ, even at the same size", async () => {
  const bucket = createR2Bucket({
    seed: [{ key: "products/phone-a.jpg", bytes: [9, 9, 9, 9, 9], customMetadata: { sha256: "untrusted-metadata" } }]
  });
  await withMigrationFetch(async url => {
    if (url.pathname.endsWith("/product-images")) {
      return new Response(xmlPage([{ key: "products/phone-a.jpg", size: MIGRATION_SOURCE_BYTES.byteLength }]), { status: 200 });
    }
    return new Response(MIGRATION_SOURCE_BYTES, { status: 200, headers: { "Content-Type": "image/jpeg" } });
  }, async () => {
    const response = await handleR2Migration({
      request: migrationRequest({ action: "copy" }),
      env: migrationEnv(bucket)
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.data.conflicts, 1);
    assert.equal(payload.data.copied, 0);
    assert.equal(bucket.calls.put, 0);
    assert.deepEqual([...bucket.objects.get("products/phone-a.jpg").bytes], [9, 9, 9, 9, 9]);
  });
});

test("R2 migration maps a Supabase 402 to a safe restricted-service response without writes", async () => {
  const bucket = createR2Bucket();
  await withMigrationFetch(async () =>
    new Response("quota restricted", { status: 402 }),
  async () => {
    const response = await handleR2Migration({
      request: migrationRequest({ action: "inventory" }),
      env: migrationEnv(bucket)
    });
    const payload = await response.json();
    assert.equal(response.status, 503);
    assert.equal(payload.code, "SUPABASE_SERVICE_RESTRICTED");
    assert.match(payload.error, /HTTP 402/);
    assert.equal(bucket.calls.put, 0);
  });
});

test("R2 migration reports a failed read-back checksum instead of marking the file copied", async () => {
  const bucket = createR2Bucket({ corruptReadback: true });
  await withMigrationFetch(async url => {
    if (url.pathname.endsWith("/product-images")) {
      return new Response(xmlPage([{ key: "products/phone-a.jpg", size: MIGRATION_SOURCE_BYTES.byteLength }]), { status: 200 });
    }
    return new Response(MIGRATION_SOURCE_BYTES, { status: 200, headers: { "Content-Type": "image/jpeg" } });
  }, async () => {
    const response = await handleR2Migration({
      request: migrationRequest({ action: "copy" }),
      env: migrationEnv(bucket)
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.data.copied, 0);
    assert.equal(payload.data.failed, 1);
    assert.match(payload.data.errors[0].reason, /SHA-256 posterior a la copia no coincide/i);
  });
});
