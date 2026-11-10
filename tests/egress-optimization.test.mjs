import { sha256Hex } from "../functions/api/migration/supabase-r2.js";
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
