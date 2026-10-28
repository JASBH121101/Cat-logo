import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const customerHtml = readFileSync(new URL("../mensajes/index.html", import.meta.url), "utf8");
const customerJs = readFileSync(new URL("../mensajes/mensajes.js", import.meta.url), "utf8");
const customerCss = readFileSync(new URL("../mensajes/mensajes.css", import.meta.url), "utf8");
const edge = readFileSync(new URL("../supabase/functions/private-chat/index.ts", import.meta.url), "utf8");
const proxy = readFileSync(new URL("../functions/api/private-chat.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20261028201325_private_customer_messaging.sql", import.meta.url), "utf8");
const adminHtml = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
const adminJs = readFileSync(new URL("../admin.js", import.meta.url), "utf8");
const adminCss = readFileSync(new URL("../admin-private-chat.css", import.meta.url), "utf8");
const techHtml = readFileSync(new URL("../tecnologia/index.html", import.meta.url), "utf8");
const compactCss = readFileSync(new URL("../technology-detail-compact.css", import.meta.url), "utf8");

test("customer private chat explains consent, retention, data minimization, and decline", () => {
  assert.ok(customerHtml.includes("Sí, deseo continuar"));
  assert.ok(customerHtml.includes("No deseo continuar"));
  assert.ok(customerHtml.includes("máximo de 7 días"));
  assert.ok(customerHtml.includes("no autoriza a compartir esos datos"));
  assert.ok(customerHtml.includes("Cambiar de opinión"));
  assert.ok(customerJs.includes("sessionStorage.setItem(sessionKey"));
  assert.ok(customerJs.includes('api("decline_start"'));
  assert.ok(customerJs.includes('api("change_mind"'));
  assert.ok(customerJs.includes("hasNewProductContext"));
  assert.ok(customerJs.includes("showContext(result.conversation)"));
  assert.ok(customerJs.includes("startCountdown"));
});

test("private chat stores only hashed temporary tokens and requires explicit admin authentication", () => {
  assert.ok(edge.includes("invite_token_hash"));
  assert.ok(edge.includes("session_token_hash"));
  assert.ok(edge.includes("crypto.subtle.digest"));
  assert.ok(edge.includes("invite_redeemed_at"));
  assert.ok(edge.includes("function verifyAdmin"));
  assert.ok(edge.includes("admin_users"));
  assert.ok(edge.includes('status: "pending_advisor"'));
  assert.ok(edge.includes('action === "admin_send"'));
  assert.ok(edge.includes('action === "claim"'));
  assert.ok(edge.includes("function piiDetected"));
  assert.ok(!/national_id\s*:\s*text/i.test(migration));
  assert.ok(!/phone\s+text/i.test(migration));
  assert.ok(!/email\s+text/i.test(migration));
});

test("declined chats expire after ten minutes and all chat history is cleaned after seven days", () => {
  assert.ok(migration.includes("interval '7 days'"));
  assert.ok(migration.includes("'jb-collections-private-chat-cleanup'"));
  assert.ok(migration.includes("'* * * * *'"));
  assert.ok(edge.includes("addMinutes(now, 10)"));
  assert.ok(edge.includes("addMinutes(now, 7 * 24 * 60)"));
});

test("Cloudflare proxy exposes only POST/OPTIONS and keeps service credentials server-side", () => {
  assert.ok(proxy.includes("/functions/v1/private-chat"));
  assert.ok(proxy.includes("CF-Connecting-IP"));
  assert.ok(proxy.includes("Access-Control-Allow-Origin"));
  assert.ok(!proxy.includes("SUPABASE_SERVICE_ROLE_KEY"));
  assert.ok(!proxy.includes("SUPABASE_SECRET_KEYS"));
});

test("JB Manager has a human-controlled inbox and AI draft action", () => {
  assert.ok(adminHtml.includes('data-admin-section="messages"'));
  assert.ok(adminHtml.includes('data-admin-panel="messages"'));
  assert.ok(adminHtml.includes("Tomar conversación"));
  assert.ok(adminHtml.includes("Preparar borrador con IA"));
  assert.ok(adminJs.includes('callPrivateChat("admin_list")'));
  assert.ok(adminJs.includes('callPrivateChat("claim"'));
  assert.ok(adminJs.includes('callPrivateChat("admin_send"'));
  assert.ok(adminJs.includes("No lo envíes"));
  assert.ok(adminCss.includes(".private-chat-admin-layout"));
});

test("technology detail layout loads mobile compact CSS and retains touch-size controls", () => {
  assert.ok(techHtml.includes("technology-detail-compact.css?v=20261028-private-chat1"));
  assert.ok(compactCss.includes("@media (max-width: 760px)"));
  assert.ok(compactCss.includes("min-height: 33px !important"));
  assert.ok(compactCss.includes("grid-template-columns: minmax(0,1fr) minmax(0,.95fr) !important"));
});
