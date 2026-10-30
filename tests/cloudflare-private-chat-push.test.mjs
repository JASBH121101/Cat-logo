import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/private-chat.js";
import { readFileSync } from "node:fs";

const privateChatEdge = readFileSync(new URL("../supabase/functions/private-chat/index.ts", import.meta.url), "utf8");
const pushSecurityMigration = readFileSync(new URL("../supabase/migrations/20261029124043_catalog_security_performance_hardening.sql", import.meta.url), "utf8");


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
      PUSH_DISPATCH_SECRET: "test-dispatch-secret",
      VAPID_PRIVATE_JWK: JSON.stringify(vapidPrivateJwk),
      VAPID_PUBLIC_KEY: vapidPublicKey,
    },
    subscription: { id: "subscription-1", endpoint: "https://push.example.test/send/123", p256dh, auth },
  };
}

function request(body) {
  return new Request("https://jb-collections.pages.dev/api/private-chat", {
    method: "POST",
    headers: {
      Origin: "https://jb-collections.pages.dev",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

test("customer purchase consent dispatches encrypted Web Push and records delivery", async () => {
  const { env, subscription } = await fixture();
  const originalFetch = globalThis.fetch;
  const calls = [];
  let finishDelivered;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes("/rest/v1/rpc/private_chat_record_consent")) {
      calls.push({ kind: "consent", params: JSON.parse(options.body) });
      return new Response(JSON.stringify({ ok: true, status: "pending_advisor" }), { status: 200 });
    }
    if (target.includes("/functions/v1/private-chat")) {
      const params = JSON.parse(options.body);
      if (params.action === "push_claim") {
        calls.push({ kind: "claim", params });
        return new Response(JSON.stringify({
          ok: true,
          sent: true,
          conversation_id: "2b81e51b-4d0a-4a02-a49d-6411d4e8c12a",
          product_name: "Phone X",
          contact_route: "buy",
          subscriptions: [subscription],
        }), { status: 200 });
      }
      if (params.action === "push_finish") {
        finishDelivered = params.delivered;
        calls.push({ kind: "finish", params });
        return new Response(JSON.stringify({ ok: true, delivered: finishDelivered }), { status: 200 });
      }
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
    assert.equal(calls[1].params.dispatch_secret, env.PUSH_DISPATCH_SECRET);
    assert.equal(calls[1].params.action, "push_claim");
    assert.equal(calls[1].params.session_token_hash.length, 64);
    assert.equal(calls[2].options.headers["Content-Encoding"], "aes128gcm");
    assert.match(calls[2].options.headers.Authorization, /^vapid t=/);
    assert.equal(finishDelivered, true);
    assert.equal(calls[3].params.conversation_id, "2b81e51b-4d0a-4a02-a49d-6411d4e8c12a");
    assert.equal(calls[3].params.action, "push_finish");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("push server failure does not block a customer's successful consent response", async () => {
  const { env, subscription } = await fixture();
  const originalFetch = globalThis.fetch;
  let finishDelivered = true;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes("/rest/v1/rpc/private_chat_record_consent")) {
      return new Response(JSON.stringify({ ok: true, status: "pending_advisor" }), { status: 200 });
    }
    if (target.includes("/functions/v1/private-chat")) {
      const params = JSON.parse(options.body);
      if (params.action === "push_claim") {
        return new Response(JSON.stringify({
          ok: true, sent: true,
          conversation_id: "2b81e51b-4d0a-4a02-a49d-6411d4e8c12a",
          product_name: "Phone X", contact_route: "buy", subscriptions: [subscription],
        }), { status: 200 });
      }
      if (params.action === "push_finish") {
        finishDelivered = params.delivered;
        return new Response(JSON.stringify({ ok: true, delivered: finishDelivered }), { status: 200 });
      }
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

test("push dispatch is skipped safely when production secrets are not configured", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    calls.push(target);
    if (target.includes("/rest/v1/rpc/private_chat_record_consent")) {
      return new Response(JSON.stringify({ ok: true, status: "pending_advisor" }), { status: 200 });
    }
    throw new Error("Push should not be dispatched without server secrets.");
  };
  try {
    const response = await onRequest({
      request: request({ action: "consent", sessionToken: "d".repeat(64), choice: "yes" }),
      env: {},
    });
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("the public Edge Function is restricted to secret-protected internal push operations", () => {
  assert.match(privateChatEdge, /const SERVICE_KEY = getKey\("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"\)/);
  assert.match(privateChatEdge, /const ALLOWED_ACTIONS = new Set\(\["push_claim", "push_finish"\]\)/);
  assert.match(privateChatEdge, /if \(!ALLOWED_ACTIONS\.has\(action\)\)/);
  assert.match(privateChatEdge, /serviceRpc\("private_chat_claim_push_delivery"/);
  assert.match(privateChatEdge, /serviceRpc\("private_chat_finish_push_delivery"/);
  assert.match(privateChatEdge, /p_dispatch_secret: dispatchSecret/);
  assert.doesNotMatch(privateChatEdge, /if \(action === "start"\)/);
  assert.doesNotMatch(privateChatEdge, /consent_choice:\s*"yes"/);
  assert.doesNotMatch(privateChatEdge, /async function createConversation/);
  assert.match(pushSecurityMigration, /REVOKE EXECUTE ON FUNCTION public\.private_chat_claim_push_delivery\(text, text\) FROM PUBLIC, anon, authenticated/i);
  assert.match(pushSecurityMigration, /REVOKE EXECUTE ON FUNCTION public\.private_chat_finish_push_delivery\(text, uuid, boolean\) FROM PUBLIC, anon, authenticated/i);
  assert.match(pushSecurityMigration, /GRANT EXECUTE ON FUNCTION public\.private_chat_claim_push_delivery\(text, text\) TO service_role/i);
  assert.match(pushSecurityMigration, /GRANT EXECUTE ON FUNCTION public\.private_chat_finish_push_delivery\(text, uuid, boolean\) TO service_role/i);
  for (const index of [
    "admin_push_subscriptions_user_id_idx",
    "color_library_updated_by_idx",
    "commission_records_product_id_idx",
    "product_provider_review_history_reviewed_by_idx",
    "product_provider_status_reviewed_by_idx",
    "products_updated_by_idx"
  ]) assert.ok(pushSecurityMigration.includes(index), "Missing covering index: " + index);
});
