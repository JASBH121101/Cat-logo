import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/download/apk.js";

const releaseUrl = "https://api.github.com/repos/JASBH121101/Cat-logo/releases/tags/jb-manager-v1.0.64";
const assetUrl = "https://api.github.com/repos/JASBH121101/Cat-logo/releases/assets/123";
const publicAssetUrl = "https://github.com/JASBH121101/Cat-logo/releases/download/jb-manager-v1.0.64/JB-Manager-Collections.apk";

function releaseResponse(overrides = {}) {
  return new Response(JSON.stringify({
    tag_name: "jb-manager-v1.0.64",
    draft: false,
    prerelease: true,
    assets: [{
      id: 123,
      name: "JB-Manager-Collections.apk",
      state: "uploaded",
      size: 6_500_000,
      browser_download_url: publicAssetUrl
    }],
    ...overrides
  }), { status: 200, headers: { "Content-Type": "application/vnd.github+json" } });
}

function request(url = "https://jb-collections.pages.dev/api/download/apk?version=1.0.64", headers = {}) {
  return new Request(url, { method: "GET", headers });
}

test("rejects an invalid version without contacting GitHub", async () => {
  let calls = 0;
  const previous = globalThis.fetch;
  globalThis.fetch = async () => { calls++; throw new Error("fetch should not be called"); };
  try {
    const result = await onRequest({ request: request("https://jb-collections.pages.dev/api/download/apk?version=latest") });
    assert.equal(result.status, 400);
    assert.match(await result.text(), /invalid version/i);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = previous; }
});

test("returns 404 when the requested release does not exist", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(String(url), releaseUrl);
    return new Response("not found", { status: 404 });
  };
  try {
    const result = await onRequest({ request: request() });
    assert.equal(result.status, 404);
    assert.match(await result.text(), /release not found/i);
  } finally { globalThis.fetch = previous; }
});

test("streams the official APK with Android download headers and forwards Range", async () => {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url) === releaseUrl) return releaseResponse();
    assert.equal(String(url), assetUrl);
    assert.equal(init.headers.get("Accept"), "application/octet-stream");
    assert.equal(init.headers.get("Range"), "bytes=0-4");
    return new Response(new Uint8Array([1, 2, 3, 4, 5]), {
      status: 206,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": "5",
        "Content-Range": "bytes 0-4/6500000",
        "Accept-Ranges": "bytes",
        "ETag": '"apk-etag"'
      }
    });
  };
  try {
    const result = await onRequest({ request: request(undefined, { Range: "bytes=0-4" }) });
    assert.equal(result.status, 206);
    assert.equal(result.headers.get("Content-Type"), "application/vnd.android.package-archive");
    assert.match(result.headers.get("Content-Disposition"), /JB-Manager-Collections-v1\.0\.64\.apk/);
    assert.equal(result.headers.get("Content-Length"), "5");
    assert.equal(result.headers.get("Content-Range"), "bytes 0-4/6500000");
    assert.equal(result.headers.get("Cache-Control"), "no-store, no-cache, must-revalidate");
    assert.deepEqual([...new Uint8Array(await result.arrayBuffer())], [1, 2, 3, 4, 5]);
    assert.equal(calls.length, 2);
  } finally { globalThis.fetch = previous; }
});

test("refreshes via the canonical download URL if GitHub API returns metadata instead of bytes", async () => {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(String(url));
    if (String(url) === releaseUrl) return releaseResponse();
    if (String(url) === assetUrl) return new Response('{"message":"asset metadata"}', {
      status: 200, headers: { "Content-Type": "application/json" }
    });
    assert.equal(String(url), publicAssetUrl);
    return new Response(new Uint8Array([9, 8, 7]), {
      status: 200,
      headers: { "Content-Type": "application/vnd.android.package-archive", "Content-Length": "3" }
    });
  };
  try {
    const result = await onRequest({ request: request() });
    assert.equal(result.status, 200);
    assert.deepEqual([...new Uint8Array(await result.arrayBuffer())], [9, 8, 7]);
    assert.deepEqual(calls, [releaseUrl, assetUrl, publicAssetUrl]);
  } finally { globalThis.fetch = previous; }
});

test("does not allow an unexpected release asset URL", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(String(url), releaseUrl);
    return releaseResponse({ assets: [{
      id: 123,
      name: "JB-Manager-Collections.apk",
      state: "uploaded",
      size: 6_500_000,
      browser_download_url: "https://attacker.example/file.apk"
    }] });
  };
  try {
    const result = await onRequest({ request: request() });
    assert.equal(result.status, 502);
  } finally { globalThis.fetch = previous; }
});

test("rejects non-GET requests", async () => {
  const result = await onRequest({ request: new Request("https://jb-collections.pages.dev/api/download/apk?version=1.0.64", { method: "POST" }) });
  assert.equal(result.status, 405);
  assert.equal(result.headers.get("Allow"), "GET");
});
