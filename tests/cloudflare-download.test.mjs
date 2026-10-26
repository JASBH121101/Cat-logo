import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/download/apk.js";

const publicAssetUrl = "https://github.com/JASBH121101/Cat-logo/releases/download/jb-manager-v1.0.64/JB-Manager-Collections.apk";

function request(url = "https://jb-collections.pages.dev/api/download/apk?version=1.0.64", headers = {}) {
  return new Request(url, { method: "GET", headers });
}

function fakeApk(length = 1024, includeEndRecord = true) {
  const body = new Uint8Array(length);
  body.set([0x50, 0x4b, 0x03, 0x04]);
  if (includeEndRecord && length >= 22) body.set([0x50, 0x4b, 0x05, 0x06], length - 22);
  return body;
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

test("returns a fully buffered APK with exact Content-Length and attachment headers", async () => {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    assert.equal(String(url), publicAssetUrl);
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "follow");
    assert.equal(init.cache, "no-store");
    assert.equal(init.headers.get("Accept"), "application/octet-stream");
    return new Response(fakeApk(), {
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
    assert.equal(result.headers.get("Content-Type"), "application/vnd.android.package-archive");
    assert.match(result.headers.get("Content-Disposition"), /JB-Manager-Collections-v1\.0\.64\.apk/);
    assert.equal(result.headers.get("Content-Length"), "1024");
    assert.equal(result.headers.get("Cache-Control"), "no-store, no-cache, must-revalidate");
    const body = new Uint8Array(await result.arrayBuffer());
    assert.equal(body.length, 1024);
    assert.deepEqual([...body.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
    assert.deepEqual([...body.slice(-22, -18)], [0x50, 0x4b, 0x05, 0x06]);
    assert.equal(calls.length, 1);
  } finally { globalThis.fetch = previous; }
});

test("forwards valid byte-range requests and returns exact partial length", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(String(url), publicAssetUrl);
    assert.equal(init.headers.get("Range"), "bytes=0-4");
    return new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]), {
      status: 206,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": "5",
        "Content-Range": "bytes 0-4/1024",
        "Accept-Ranges": "bytes"
      }
    });
  };
  try {
    const result = await onRequest({ request: request(undefined, { Range: "bytes=0-4" }) });
    assert.equal(result.status, 206);
    assert.equal(result.headers.get("Content-Length"), "5");
    assert.equal(result.headers.get("Content-Range"), "bytes 0-4/1024");
    assert.deepEqual([...new Uint8Array(await result.arrayBuffer())], [0x50, 0x4b, 0x03, 0x04, 0x00]);
  } finally { globalThis.fetch = previous; }
});

test("rejects an incomplete APK archive instead of sending a response that hangs", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(String(url), publicAssetUrl);
    return new Response(fakeApk(1024, false), {
      status: 200,
      headers: { "Content-Type": "application/octet-stream", "Content-Length": "1024" }
    });
  };
  try {
    const result = await onRequest({ request: request() });
    assert.equal(result.status, 502);
    assert.match(await result.text(), /APK incomplete: received=1024 bytes/i);
  } finally { globalThis.fetch = previous; }
});

test("rejects non-GET requests", async () => {
  const result = await onRequest({ request: new Request("https://jb-collections.pages.dev/api/download/apk?version=1.0.64", { method: "POST" }) });
  assert.equal(result.status, 405);
  assert.equal(result.headers.get("Allow"), "GET");
});
