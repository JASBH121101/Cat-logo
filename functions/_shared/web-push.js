const utf8 = new TextEncoder();

function concatBytes(...parts) {
  const arrays = parts.map(part => part instanceof Uint8Array ? part : new Uint8Array(part));
  const size = arrays.reduce((sum, array) => sum + array.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const array of arrays) {
    result.set(array, offset);
    offset += array.length;
  }
  return result;
}

function decodeBase64Url(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function encodeBase64Url(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function hmacSha256(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, dataBytes));
}

async function hkdfExtract(salt, inputKeyMaterial) {
  return hmacSha256(salt, inputKeyMaterial);
}

async function hkdfExpand(pseudoRandomKey, info, length) {
  const output = [];
  let previous = new Uint8Array(0);
  let written = 0;
  for (let counter = 1; written < length; counter += 1) {
    if (counter > 255) throw new Error("HKDF output is too long.");
    previous = await hmacSha256(pseudoRandomKey, concatBytes(previous, info, Uint8Array.of(counter)));
    output.push(previous);
    written += previous.length;
  }
  return concatBytes(...output).slice(0, length);
}

function normalizeEcdsaSignature(signature) {
  const bytes = new Uint8Array(signature);
  if (bytes.length === 64) return bytes;
  if (bytes[0] !== 0x30) throw new Error("Unexpected ECDSA signature format.");
  let offset = 2;
  if (bytes[1] & 0x80) offset = 2 + (bytes[1] & 0x7f);
  if (bytes[offset++] !== 0x02) throw new Error("Invalid ECDSA r component.");
  const rLength = bytes[offset++];
  let r = bytes.slice(offset, offset + rLength);
  offset += rLength;
  if (bytes[offset++] !== 0x02) throw new Error("Invalid ECDSA s component.");
  const sLength = bytes[offset++];
  let s = bytes.slice(offset, offset + sLength);
  while (r.length > 32 && r[0] === 0) r = r.slice(1);
  while (s.length > 32 && s[0] === 0) s = s.slice(1);
  if (r.length > 32 || s.length > 32) throw new Error("Invalid ECDSA component length.");
  const jose = new Uint8Array(64);
  jose.set(r, 32 - r.length);
  jose.set(s, 64 - s.length);
  return jose;
}

function readPrivateJwk(value) {
  const jwk = typeof value === "string" ? JSON.parse(value) : value;
  if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.d || !jwk.x || !jwk.y) {
    throw new Error("The VAPID private JWK must be a P-256 EC private key.");
  }
  return jwk;
}

async function createVapidAuthorization(endpoint, config) {
  const endpointUrl = new URL(endpoint);
  if (endpointUrl.protocol !== "https:" || endpointUrl.username || endpointUrl.password) {
    throw new Error("The push subscription endpoint must be an HTTPS URL.");
  }
  const jwk = readPrivateJwk(config.privateJwk);
  const key = await crypto.subtle.importKey(
    "jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]
  );
  const now = Math.floor(Date.now() / 1000);
  const header = encodeBase64Url(utf8.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = encodeBase64Url(utf8.encode(JSON.stringify({
    aud: endpointUrl.origin,
    exp: now + 12 * 60 * 60,
    sub: config.subject || "https://jb-collections.pages.dev/",
  })));
  const signingInput = header + "." + claims;
  const signature = normalizeEcdsaSignature(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, utf8.encode(signingInput)
  ));
  const token = signingInput + "." + encodeBase64Url(signature);
  return "vapid t=" + token + ", k=" + String(config.publicKey || "");
}

async function encryptPayload(subscription, payload) {
  const userPublicKeyRaw = decodeBase64Url(subscription.p256dh);
  const authSecret = decodeBase64Url(subscription.auth);
  if (userPublicKeyRaw.length !== 65 || authSecret.length < 16) {
    throw new Error("The stored push subscription keys are invalid.");
  }

  const userPublicKey = await crypto.subtle.importKey(
    "raw", userPublicKeyRaw, { name: "ECDH", namedCurve: "P-256" }, false, []
  );
  const serverKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]
  );
  const serverPublicKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", serverKeyPair.publicKey));
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "ECDH", public: userPublicKey }, serverKeyPair.privateKey, 256
  ));

  const authPrk = await hkdfExtract(authSecret, sharedSecret);
  const keyInfo = concatBytes(utf8.encode("WebPush: info\0"), userPublicKeyRaw, serverPublicKeyRaw);
  const inputKeyMaterial = await hkdfExpand(authPrk, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hkdfExtract(salt, inputKeyMaterial);
  const contentKey = await hkdfExpand(prk, utf8.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(prk, utf8.encode("Content-Encoding: nonce\0"), 12);
  const aesKey = await crypto.subtle.importKey("raw", contentKey, { name: "AES-GCM" }, false, ["encrypt"]);
  const plaintext = concatBytes(utf8.encode(JSON.stringify(payload)), Uint8Array.of(2));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, plaintext
  ));

  const recordSize = Uint8Array.of(0, 0, 16, 0); // 4096-byte record size, big endian.
  const header = concatBytes(salt, recordSize, Uint8Array.of(serverPublicKeyRaw.length), serverPublicKeyRaw);
  return concatBytes(header, ciphertext);
}

/**
 * Sends one RFC 8291 aes128gcm Web Push message with an RFC 8292 VAPID token.
 * fetchImpl is injectable for deterministic tests.
 */
export async function sendWebPush(subscription, payload, config, fetchImpl = fetch) {
  try {
    if (!subscription?.endpoint || !subscription?.p256dh || !subscription?.auth) {
      return { ok: false, expired: false, status: 0, reason: "invalid-subscription" };
    }
    if (!config?.privateJwk || !config?.publicKey) {
      return { ok: false, expired: false, status: 0, reason: "missing-vapid-config" };
    }
    const endpoint = new URL(subscription.endpoint);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) {
      return { ok: false, expired: false, status: 0, reason: "invalid-endpoint" };
    }

    const authorization = await createVapidAuthorization(endpoint.href, config);
    const encryptedBody = await encryptPayload(subscription, payload);
    const response = await fetchImpl(endpoint.href, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: "60",
        Urgency: "high",
      },
      body: encryptedBody,
    });
    return {
      ok: response.status >= 200 && response.status < 300,
      expired: response.status === 404 || response.status === 410,
      status: response.status,
    };
  } catch (error) {
    return { ok: false, expired: false, status: 0, reason: String(error?.message || error || "web-push-failed") };
  }
}
