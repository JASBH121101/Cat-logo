import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/private-chat.js";
import { readFileSync } from "node:fs";

const privateChatBackend = readFileSync(new URL("../functions/api/private-chat.js", import.meta.url), "utf8");
const pushSecurityMigration = readFileSync(new URL("../db/migrations/0005_private_chat_push_dispatch.sql", import.meta.url), "utf8");
const PUBLIC_ACCESS_TOKEN = "test-neon-anonymous-token";
const NEON_ENDPOINT = "https://neon.example.test/neondb/rest/v1";

function base64url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

async function fixture() {
  const vapidPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]
  );
  const clientPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]
  );
  const vapidPrivateJwk = await crypto.subtle.exportKey("jwk", vapidPair.privateKey);
  const vapidPublicKey = base64url(new Uint8Array(await crypto.subtle.exportKey("raw", vapidPair.publicKey)));
  const p256dh = base64url(new Uint8Array(await crypto.subtle.exportKey("raw", clientPair.publicKey)));
  const auth = base64url(crypto.getRandomValues(new Uint8Array(16)));
  return {
    env: {
      NEON_DATA_API_URL: NEON_ENDPOINT,
      PUSH_DISPATCH_SECRET: "test-dispatch-secret",
      VAPID_PRIVATE_JWK: JSON.stringify(vapidPrivateJwk),
      VAPID_PUBLIC_KEY: vapidPublicKey,
    },
    subscription: { id: "subscription-1", endpoint: "https://push.example.test/send/123", p256dh, auth },
  };
}

function request(body, token = PUBLIC_ACCESS_TOKEN) {
  const headers = {
    Origin: "https://jb-collections.pages.dev",
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = "Bearer " + token;
  return new Request("https://jb-collections.pages.dev/api/private-chat", {
    method: "POST", headers, body: JSON.stringify(body),
  });
}

test("customer purchase consent dispatches encrypted Web Push and records delivery", async () => {
  const { env, subscription } = await fixture();
  const originalFetch = globalThis.fetch;
  const calls = [];
  let finishDelivered;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    assert.equal(options.headers.Authorization, "Bearer " + PUBLIC_ACCESS_TOKEN);
    const params = JSON.parse(options.body);
    if (target.endsWith("/rpc/private_chat_record_consent")) {
      calls.push({ kind: "consent", params });
      return new Response(JSON.stringify({ ok: true, status: "pending_advisor" }), { status: 200 });
    }
    if (target.endsWith("/rpc/private_chat_claim_push_delivery")) {
      calls.push({ kind: "claim", params });
      return new Response(JSON.stringify({
        ok: true, sent: true,
        conversation_id: "2b81e51b-4d0a-4a02-a49d-6411d4e8c12a",
        product_name: "Phone X", contact_route: "buy", subscriptions: [subscription],
      }), { status: 200 });
    }
    if (target.endsWith("/rpc/private_chat_finish_push_delivery")) {
      finishDelivered = params.p_delivered;
      calls.push({ kind: "finish", params });
      return new Response(JSON.stringify({ ok: true, delivered: finishDelivered }), { status: 200 });
    }
    if (target.startsWith("https://push.example.test/")) {
      calls.push({ kind: "push", options });
      return new Response(null, { status: 201 });
    }
    throw new Error("Unexpected network request: " + target);
  };

  try {
    const response = await onRequest({
      request: request({ action: "consent", sessionToken: "b".repeat(64), choice: "yes" }),
      env,
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.ok, true);
    assert.deepEqual(calls.map(call => call.kind), ["consent", "claim", "push", "finish"]);
    assert.equal(calls[1].params.p_dispatch_secret, env.PUSH_DISPATCH_SECRET);
    assert.equal(calls[1].params.p_session_token_hash.length, 64);
    assert.equal(calls[2].options.headers["Content-Encoding"], "aes128gcm");
    assert.match(calls[2].options.headers.Authorization, /^vapid t=/);
    assert.equal(finishDelivered, true);
    assert.equal(calls[3].params.p_conversation_id, "2b81e51b-4d0a-4a02-a49d-6411d4e8c12a");
    assert.equal(calls[3].params.p_delivered, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("push server failure does not block successful customer consent", async () => {
  const { env, subscription } = await fixture();
  const originalFetch = globalThis.fetch;
  let finishDelivered = true;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    const params = JSON.parse(options.body);
    if (target.endsWith("/rpc/private_chat_record_consent")) {
      return new Response(JSON.stringify({ ok: true, status: "pending_advisor" }), { status: 200 });
    }
    if (target.endsWith("/rpc/private_chat_claim_push_delivery")) {
      return new Response(JSON.stringify({
        ok: true, sent: true,
        conversation_id: "2b81e51b-4d0a-4a02-a49d-6411d4e8c12a",
        product_name: "Phone X", contact_route: "buy", subscriptions: [subscription],
      }), { status: 200 });
    }
    if (target.endsWith("/rpc/private_chat_finish_push_delivery")) {
      finishDelivered = params.p_delivered;
      return new Response(JSON.stringify({ ok: true, delivered: finishDelivered }), { status: 200 });
    }
    if (target.startsWith("https://push.example.test/")) return new Response(null, { status: 410 });
    throw new Error("Unexpected network request: " + target);
  };

  try {
    const response = await onRequest({
      request: request({ action: "consent", sessionToken: "c".repeat(64), choice: "yes" }),
      env,
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
    assert.equal(finishDelivered, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("push dispatch is skipped when its server secrets are not configured", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    calls.push(target);
    if (target.endsWith("/rpc/private_chat_record_consent")) {
      return new Response(JSON.stringify({ ok: true, status: "pending_advisor" }), { status: 200 });
    }
    throw new Error("Push should not be dispatched without server secrets.");
  };
  try {
    const response = await onRequest({
      request: request({ action: "consent", sessionToken: "d".repeat(64), choice: "yes" }),
      env: { NEON_DATA_API_URL: NEON_ENDPOINT },
    });
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("customer chat rejects a missing Neon bearer token before database access", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("Database should not be reached."); };
  try {
    const response = await onRequest({
      request: request({ action: "status", sessionToken: "e".repeat(64) }, ""),
      env: { NEON_DATA_API_URL: NEON_ENDPOINT },
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, "neon_token_required");
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("private chat dispatch uses Neon and protects server-side push secrets", () => {
  assert.doesNotMatch(privateChatBackend, /supabase\\.co|SUPABASE_PUBLISHABLE_KEY|functions\\/v1\\/private-chat/i);
  assert.match(privateChatBackend, /NEON_DATA_API_URL/);
  assert.match(privateChatBackend, /Authorization: "Bearer " \\+ accessToken/);
  assert.match(privateChatBackend, /private_chat_claim_push_delivery/);
  assert.match(privateChatBackend, /private_chat_finish_push_delivery/);
  assert.match(privateChatBackend, /env\\.PUSH_DISPATCH_SECRET/);
  assert.match(pushSecurityMigration, /secret_hash text NOT NULL/);
  assert.match(pushSecurityMigration, /REVOKE ALL ON FUNCTION public\\.private_chat_claim_push_delivery\\(text,text\\) FROM PUBLIC, authenticated/i);
  assert.match(pushSecurityMigration, /REVOKE ALL ON FUNCTION public\\.private_chat_finish_push_delivery\\(text,uuid,boolean\\) FROM PUBLIC, authenticated/i);
  assert.match(pushSecurityMigration, /GRANT EXECUTE ON FUNCTION public\\.private_chat_claim_push_delivery\\(text,text\\) TO anonymous/i);
  assert.match(pushSecurityMigration, /GRANT EXECUTE ON FUNCTION public\\.private_chat_finish_push_delivery\\(text,uuid,boolean\\) TO anonymous/i);
});
