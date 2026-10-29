import assert from "node:assert/strict";
import { sendWebPush } from "../functions/_shared/web-push.js";


function b64url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function decodeJwtPart(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

async function fixtures() {
  const vapidPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]
  );
  const vapidPrivateJwk = await crypto.subtle.exportKey("jwk", vapidPair.privateKey);
  const vapidPublicKey = b64url(new Uint8Array(await crypto.subtle.exportKey("raw", vapidPair.publicKey)));
  const clientPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]
  );
  const clientPublicKey = b64url(new Uint8Array(await crypto.subtle.exportKey("raw", clientPair.publicKey)));
  const auth = b64url(crypto.getRandomValues(new Uint8Array(16)));
  return {
    config: {
      privateJwk: JSON.stringify(vapidPrivateJwk),
      publicKey: vapidPublicKey,
      subject: "https://jb-collections.pages.dev/",
    },
    subscription: {
      endpoint: "https://push.example.test/send/abc",
      p256dh: clientPublicKey,
      auth,
    },
  };
}

test("Web Push creates a valid VAPID JWT and aes128gcm encrypted POST body", async () => {
  const { config, subscription } = await fixtures();
  let captured;
  const result = await sendWebPush(
    subscription,
    { title: "Cliente confirmó que quiere comprar", body: "Phone X", url: "https://jb-collections.pages.dev/admin.html?open=messages" },
    config,
    async (url, options) => {
      captured = { url, options };
      return { status: 201 };
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, 201);
  assert.equal(captured.url, subscription.endpoint);
  assert.equal(captured.options.method, "POST");
  assert.equal(captured.options.headers["Content-Encoding"], "aes128gcm");
  assert.equal(captured.options.headers["Content-Type"], "application/octet-stream");
  assert.equal(captured.options.headers.TTL, "60");
  assert.match(captured.options.headers.Authorization, /^vapid t=[^.]+\.[^.]+\.[^,]+, k=/);

  const token = captured.options.headers.Authorization.match(/^vapid t=([^,]+), k=/)[1].split(".");
  const jwtHeader = decodeJwtPart(token[0]);
  const jwtClaims = decodeJwtPart(token[1]);
  assert.equal(jwtHeader.alg, "ES256");
  assert.equal(jwtHeader.typ, "JWT");
  assert.equal(jwtClaims.aud, "https://push.example.test");
  assert.ok(jwtClaims.exp > Math.floor(Date.now() / 1000));
  assert.ok(token[2].length > 0);

  const body = new Uint8Array(captured.options.body);
  assert.ok(body.length > 86, "Encrypted record must contain the aes128gcm header and ciphertext");
  assert.equal(body[20], 65, "The record header must carry a 65-byte uncompressed P-256 ephemeral key");
  assert.equal(body[19], 0, "The record size is encoded big endian as 4096");
  assert.ok(body.slice(21, 86).some(value => value !== 0));
});

test("expired push endpoints are reported for subscription cleanup", async () => {
  const { config, subscription } = await fixtures();
  const result = await sendWebPush(subscription, { title: "test" }, config, async () => ({ status: 410 }));
  assert.equal(result.ok, false);
  assert.equal(result.expired, true);
  assert.equal(result.status, 410);
});

test("invalid subscription and missing VAPID configuration do not issue network requests", async () => {
  let calls = 0;
  const fetchMock = async () => { calls += 1; return { status: 201 }; };
  const badSubscription = await sendWebPush({ endpoint: "http://push.example.test", p256dh: "x", auth: "y" }, {}, { privateJwk: "{}", publicKey: "x" }, fetchMock);
  assert.equal(badSubscription.ok, false);
  assert.equal(calls, 0);

  const { subscription } = await fixtures();
  const missingConfig = await sendWebPush(subscription, {}, {}, fetchMock);
  assert.equal(missingConfig.reason, "missing-vapid-config");
  assert.equal(calls, 0);
});
