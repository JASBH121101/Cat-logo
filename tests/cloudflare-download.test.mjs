import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/download/apk.js";

const publicAssetUrl = "https://github.com/JASBH121101/Cat-logo/releases/download/jb-manager-v1.0.64/JB-Manager-Collections.apk";

function request(url = "https://jb-collections.pages.dev/api/download/apk?version=1.0.64", headers = {}) {
  return new Request(url, { method: "GET", headers });
}

function fakeApk(length = 1024) {
  const body = new Uint8Array(length);
  body.set([0x50, 0x4b, 0x03, 0x04]);
  if (length >= 22) body.set([0x50, 0x4b, 0x05, 0x06], length - 22);
  return body;
}

function responseFor(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(body.length),
      "Accept-Ranges": "bytes",
      ...headers
    }
  });
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

test("returns 404 when the official release URL does not exist", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(String(url), publicAssetUrl);
    return new Response("not found", { status: 404 });
  };
  try {
    const result = await onRequest({ request: request() });
    assert.equal(result.status, 404);
    assert.match(await result.text(), /release not found/i);
  } finally { globalThis.fetch = previous; }
});

test("streams the complete APK immediately with exact download headers", async () => {
  const previousFetch = globalThis.fetch;
  const previousCaches = globalThis.caches;
  globalThis.caches = undefined;
  let pulls = 0;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    assert.equal(String(url), publicAssetUrl);
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "follow");
    assert.equal(init.cache, "no-store");
    assert.equal(init.headers.get("Accept"), "application/octet-stream");
    return new Response(new ReadableStream({
      pull(controller) {
        pulls++;
        controller.enqueue(fakeApk());
        controller.close();
      }
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": "1024",
        "Accept-Ranges": "bytes",
        "ETag": '"apk-etag"'
      }
    });
  };
  try {
    const result = await onRequest({ request: request() });
    assert.equal(result.status, 200);
    assert.equal(pulls, 0, "the proxy must not consume the full APK before returning");
    assert.equal(result.headers.get("Content-Type"), "application/vnd.android.package-archive");
    assert.match(result.headers.get("Content-Disposition"), /JB-Manager-Collections-v1\.0\.64\.apk/);
    assert.equal(result.headers.get("Content-Length"), "1024");
    assert.equal(result.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
    assert.equal(result.headers.get("ETag"), '"apk-etag"');
    const body = new Uint8Array(await result.arrayBuffer());
    assert.equal(body.length, 1024);
    assert.deepEqual([...body.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
    assert.deepEqual([...body.slice(-22, -18)], [0x50, 0x4b, 0x05, 0x06]);
    assert.equal(pulls, 1);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousCaches === undefined) delete globalThis.caches;
    else globalThis.caches = previousCaches;
  }
});

test("forwards valid byte-range requests without buffering them", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(String(url), publicAssetUrl);
    assert.equal(init.headers.get("Range"), "bytes=0-4");
    return responseFor(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]), 206, {
      "Content-Range": "bytes 0-4/1024"
    });
  };
  try {
    const result = await onRequest({
      request: request(undefined, { Range: "bytes=0-4" })
    });
    assert.equal(result.status, 206);
    assert.equal(result.headers.get("Content-Length"), "5");
    assert.equal(result.headers.get("Content-Range"), "bytes 0-4/1024");
    assert.equal(result.headers.get("Cache-Control"), "no-store");
    assert.deepEqual([...new Uint8Array(await result.arrayBuffer())], [0x50, 0x4b, 0x03, 0x04, 0x00]);
  } finally { globalThis.fetch = previous; }
});

test("rejects invalid transfer-size metadata before streaming", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => responseFor(new Uint8Array([0x50, 0x4b]), 200, {
    "Content-Length": String(51 * 1024 * 1024)
  });
  try {
    const result = await onRequest({ request: request() });
    assert.equal(result.status, 502);
    assert.match(await result.text(), /invalid size or range/i);
  } finally { globalThis.fetch = previous; }
});

test("caches immutable complete APKs and serves later requests without GitHub", async () => {
  const previousFetch = globalThis.fetch;
  const previousCaches = globalThis.caches;
  const store = new Map();
  globalThis.caches = {
    default: {
      async match(key) {
        const stored = store.get(key.url);
        return stored ? stored.clone() : undefined;
      },
      async put(key, value) {
        const bytes = await value.arrayBuffer();
        store.set(key.url, new Response(bytes, {
          status: value.status,
          headers: value.headers
        }));
      }
    }
  };
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls++;
    return responseFor(fakeApk(), 200, { "ETag": '"apk-etag"' });
  };
  try {
    const pending = [];
    const first = await onRequest({
      request: request(),
      waitUntil(promise) { pending.push(promise); }
    });
    assert.equal(first.status, 200);
    await Promise.all(pending);
    const second = await onRequest({
      request: request(),
      waitUntil() { throw new Error("a cache hit should not schedule a write"); }
    });
    assert.equal(second.status, 200);
    assert.equal(fetchCalls, 1);
    assert.equal((await second.arrayBuffer()).byteLength, 1024);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousCaches === undefined) delete globalThis.caches;
    else globalThis.caches = previousCaches;
  }
});

test("rejects non-GET requests", async () => {
  const result = await onRequest({ request: new Request("https://jb-collections.pages.dev/api/download/apk?version=1.0.64", { method: "POST" }) });
  assert.equal(result.status, 405);
  assert.equal(result.headers.get("Allow"), "GET");
});
