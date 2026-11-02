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
