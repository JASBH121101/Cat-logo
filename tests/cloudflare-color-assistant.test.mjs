import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/color-assistant.js";

const ORIGIN = "https://jb-collections.pages.dev";
const ADMIN_ID = "e72a1601-1122-4321-9abc-123456789abc";
const TOKEN = "Bearer test-admin-access-token";
let sequence = 1;

function makeRequest(body = {}, options = {}) {
  const headers = new Headers({
    "Content-Type": "application/json",
    "CF-Connecting-IP": options.ip || "198.51.100." + sequence++
  });
  const origin = Object.prototype.hasOwnProperty.call(options, "origin") ? options.origin : ORIGIN;
  if (origin) headers.set("Origin", origin);
  if (options.authorization) headers.set("Authorization", options.authorization);
  return new Request(ORIGIN + "/api/color-assistant", {
    method: options.method || "POST",
    headers,
    body: options.method === "GET" || options.method === "OPTIONS" ? undefined : JSON.stringify(body)
  });
}
async function withAdminFetch(callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.endsWith("/auth/v1/user")) return Response.json({ id: ADMIN_ID });
    if (url.includes("/rest/v1/admin_users")) return Response.json([{ user_id: ADMIN_ID }]);
    throw new Error("Unexpected fetch URL: " + url);
  };
  try { await callback(); } finally { globalThis.fetch = originalFetch; }
}

test("rejects non-POST methods", async () => {
  const response = await onRequest({ request: makeRequest({}, { method: "GET" }), env: {} });
  assert.equal(response.status, 405);
});

test("answers preflight for the production origin", async () => {
  const response = await onRequest({ request: makeRequest({}, { method: "OPTIONS" }), env: {} });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.match(response.headers.get("Access-Control-Allow-Headers") || "", /Authorization/i);
});

test("rejects unrelated origins", async () => {
  const response = await onRequest({
    request: makeRequest({ query: "blue" }, { origin: "https://attacker.example", authorization: TOKEN }),
    env: { AI: { run: async () => ({}) } }
  });
  assert.equal(response.status, 403);
});

test("requires an authenticated administrator before calling AI", async () => {
  let called = false;
  const response = await onRequest({
    request: makeRequest({ query: "blue" }),
    env: { AI: { run: async () => { called = true; return {}; } } }
  });
  assert.equal(response.status, 401);
  assert.equal(called, false);
});

test("rejects an unsupported image data URL", async () => {
  const response = await onRequest({
    request: makeRequest({ imageDataUrl: "data:text/plain;base64,SGVsbG8=" }, { authorization: TOKEN }),
    env: { AI: { run: async () => ({}) } }
  });
  assert.equal(response.status, 415);
});

test("analyzes a photo with vision AI and marks the result as an estimate", async () => {
  await withAdminFetch(async () => {
    let selectedModel = "", receivedInput = null;
    const response = await onRequest({
      request: makeRequest({
        query: "¿Qué color es este?",
        productContext: "Samsung Galaxy",
        imageDataUrl: "data:image/jpeg;base64,AAAA"
      }, { authorization: TOKEN }),
      env: { AI: { run: async (model, input) => {
        selectedModel = model;
        receivedInput = input;
        return { response: JSON.stringify({
          name: "Azul grisáceo", hex: "#74879A", aliases: ["Azul acero"],
          confidence: 0.7, explanation: "Tono azul apagado con matiz gris."
        }) };
      } } }
    });
    assert.equal(response.status, 200);
    assert.equal(selectedModel, "@cf/meta/llama-3.2-11b-vision-instruct");
    assert.equal(receivedInput.image, "data:image/jpeg;base64,AAAA");
    const payload = await response.json();
    assert.equal(payload.officialVerified, false);
    assert.equal(payload.basis, "visual_estimate");
  });
});

test("answers a manufacturer code query with an unverified text suggestion", async () => {
  await withAdminFetch(async () => {
    let selectedModel = "";
    const response = await onRequest({
      request: makeRequest({ query: "Titanium Jadegreen código X", productContext: "Samsung Galaxy" }, { authorization: TOKEN }),
      env: { AI: { run: async model => {
        selectedModel = model;
        return { response: JSON.stringify({
          name: "Verde jade", hex: "#4C6855", aliases: ["Jade Green"],
          confidence: 0.5, explanation: "Coincidencia probable por el nombre."
        }) };
      } } }
    });
    assert.equal(response.status, 200);
    assert.equal(selectedModel, "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
    const payload = await response.json();
    assert.equal(payload.basis, "ai_suggestion");
    assert.equal(payload.officialVerified, false);
    assert.equal(payload.hex, "#4C6855");
  });
});

test("rejects an invalid HEX from the model", async () => {
  await withAdminFetch(async () => {
    const response = await onRequest({
      request: makeRequest({ query: "unknown color code" }, { authorization: TOKEN }),
      env: { AI: { run: async () => ({ response: JSON.stringify({ name: "Por confirmar", hex: "no sé" }) }) } }
    });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error, "color_not_identified");
  });
});
