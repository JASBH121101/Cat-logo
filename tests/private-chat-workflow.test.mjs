import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const api = readFileSync(new URL("../functions/api/private-chat.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20261028210000_private_chat_secure_workflow.sql", import.meta.url), "utf8");
const privacyFix = readFileSync(new URL("../supabase/migrations/20261028213000_tighten_private_chat_sensitive_data.sql", import.meta.url), "utf8");
const singleNoticeFix = readFileSync(new URL("../supabase/migrations/20261028213000_private_chat_single_consent_notice.sql", import.meta.url), "utf8");
const lifecycleMigration = readFileSync(new URL("../supabase/migrations/20261028230000_private_chat_inbox_lifecycle.sql", import.meta.url), "utf8");
const customerHtml = readFileSync(new URL("../mensajes.html", import.meta.url), "utf8");
const customerJs = readFileSync(new URL("../private-chat.js", import.meta.url), "utf8");
const adminHtml = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
const adminJs = readFileSync(new URL("../admin.js", import.meta.url), "utf8");
const adminCss = readFileSync(new URL("../admin-private-chat.css", import.meta.url), "utf8");
const technology = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const perfumery = readFileSync(new URL("../perfumeria.js", import.meta.url), "utf8");

test("private chat API creates one-time hashed invite links and supports only documented actions", () => {
  assert.match(api, /async function sha256Hex/);
  assert.match(api, /action === "start"/);
  assert.match(api, /action === "redeem"/);
  assert.match(api, /action === "consent"/);
  assert.match(api, /action === "route"/);
  assert.match(api, /action === "send"/);
  assert.match(api, /private_chat_create/);
  assert.match(api, /private_chat_redeem/);
  assert.ok(api.includes("/mensajes.html?invite="));
  assert.match(api, /"Cache-Control": "no-store"/);
  assert.doesNotMatch(api, /service_role|SUPABASE_SERVICE_ROLE_KEY/i);
  assert.match(api, /Rate|rateLimit|RATE_LIMITS/);
});


test("database workflow restricts direct table access and protects admin actions", () => {
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /Admins can read private chat conversations/);
  assert.match(migration, /Admins can read private chat messages/);
  assert.match(migration, /revoke all on public\.private_chat_conversations, public\.private_chat_messages from anon/i);
  assert.match(migration, /revoke insert, update, delete on public\.private_chat_conversations, public\.private_chat_messages from authenticated/i);
  assert.match(migration, /function public\.private_chat_admin_claim/);
  assert.match(migration, /function public\.private_chat_admin_send/);
  assert.match(migration, /function public\.private_chat_admin_extend_after_purchase/);
  assert.match(migration, /function public\.private_chat_admin_close/);
  assert.match(migration, /exists \(select 1 from public\.admin_users au where au\.user_id = v_uid\)/);
  assert.match(migration, /interval '10 minutes'/);
  assert.match(migration, /interval '30 minutes'/);
  assert.match(migration, /interval '7 days'/);
});

test("customer private chat exposes a working light/dark theme toggle", () => {
  assert.match(customerHtml, /id="private-chat-theme-toggle"/);
  assert.match(customerHtml, /private-chat\.css\?v=20261028-chat-theme3/);
  assert.match(customerHtml, /private-chat\.js\?v=20261028-chat-theme3/);
  assert.match(customerJs, /function applyPrivateChatTheme\(theme\)/);
  assert.match(customerJs, /themeToggle\?\.addEventListener\("click"/);
  assert.match(customerJs, /localStorage\.setItem\("ct-catalog-theme"/);
  assert.match(readFileSync(new URL("../private-chat.css", import.meta.url), "utf8"), /:root\[data-theme="dark"\]/);
});

test("identity detection fix requires a digit for cédula/passport-like values", () => {
  assert.match(privacyFix, /\[A-Z0-9-\]\{0,15\}\[0-9\]\[A-Z0-9-\]\{4,\}/);
  assert.doesNotMatch(privacyFix, /\(c\[eé\]dula\|pasaporte\)\[\[:space:\]:#-\]\+\[A-Z0-9-\]\{6,\}/);
});

test("purchase consent is displayed only in the consent panel, not duplicated as a chat message", () => {
  assert.match(singleNoticeFix, /set contact_route='buy', consent_notice_version='2026-10-28-v2'/);
  assert.doesNotMatch(singleNoticeFix, /v_notice|values \(v_row\.id, 'assistant', v_notice\)/);
  assert.match(customerJs, /Before older conversations may still contain a duplicated database message|Older conversations may still contain a duplicated database message/);
  assert.match(adminCss, /html\[data-theme="light"\] \.private-chat-admin-message p/);
  assert.match(adminCss, /html\[data-theme="dark"\] \.private-chat-admin-message\.is-customer/);
  assert.match(adminCss, /position:static!important/);
});

test("customer page implements the two routes, separate purchase consent and optional 10-minute change of mind", () => {
  assert.match(customerHtml, /Atención al cliente/);
  assert.match(customerHtml, /Quiero comprar/);
  assert.match(customerHtml, /Sí, deseo continuar/);
  assert.match(customerHtml, /No deseo continuar/);
  assert.match(customerHtml, /Cambiar de opinión/);
  assert.match(customerHtml, /noindex,nofollow,noarchive/);
  assert.match(customerJs, /private_chat_choose_route|api\("route"/);
  assert.match(customerJs, /api\("consent"/);
  assert.match(customerJs, /startDeleteCountdown/);
  assert.match(customerJs, /sessionStorage/);
  assert.match(customerJs, /textContent = String\(item\.content/);
  assert.doesNotMatch(customerHtml, /type="tel"|type="email"|name="cedula"|name="identity/i);
});

test("JB Manager includes a private inbox with claim, manual reply, close and purchase extension", () => {
  assert.match(adminHtml, /data-admin-section="messages"/);
  assert.match(adminHtml, /data-dashboard-action="messages"/);
  assert.match(adminHtml, /dashboard-private-chat-shortcut-count/);
  assert.match(adminJs, /dashboard-private-chat-shortcut-count/);
  assert.match(adminHtml, /data-admin-panel="messages"/);
  assert.match(adminHtml, /id="private-chat-admin-claim"/);
  assert.match(adminHtml, /id="private-chat-admin-reply-form"/);
  assert.match(adminHtml, /id="private-chat-admin-purchase"/);
  assert.match(adminHtml, /id="private-chat-admin-close"/);
  assert.match(adminJs, /private_chat_admin_claim/);
  assert.match(adminJs, /private_chat_admin_send/);
  assert.match(adminJs, /private_chat_admin_extend_after_purchase/);
  assert.match(adminJs, /private_chat_admin_close/);
  assert.match(adminJs, /Notification\.requestPermission/);
  assert.match(adminCss, /\.private-chat-admin-layout/);
});

test("technology and perfume catalog buttons launch temporary chat rather than reusing the AI sidebar", () => {
  assert.match(technology, /function startPrivateChatFromTechnology/);
  assert.match(technology, /action: "start"/);
  assert.match(technology, /window\.location\.assign\(data\.inviteUrl\)/);
  assert.match(perfumery, /function startPerfumePrivateChat/);
  assert.match(perfumery, /action: "start"/);
  assert.match(perfumery, /catalogType: "perfumery"/);
  assert.match(perfumery, /window\.location\.assign\(data\.inviteUrl\)/);
});


test("admin inbox has Pendientes, Tomados and Finalizados filters with a mobile back action", () => {
  assert.match(adminHtml, /data-private-chat-filter="pending"/);
  assert.match(adminHtml, /data-private-chat-filter="taken"/);
  assert.match(adminHtml, /data-private-chat-filter="finalized"/);
  assert.match(adminHtml, /id="private-chat-admin-back"/);
  assert.match(adminJs, /function privateChatConversationBucket\(item, now = Date\.now\(\)\)/);
  assert.match(adminJs, /privateChatActiveFilter = "pending"/);
  assert.match(adminJs, /private_chat_admin_finalize_expired/);
  assert.match(adminCss, /\.private-chat-admin-panel \[hidden\].*display:none!important/s);
  assert.match(adminCss, /has-selected \.private-chat-admin-inbox/);
});

test("advisor expiry is tracked from claim and timed-out threads become read-only history", () => {
  assert.match(adminJs, /const fullClaimWindow = claimedAt \? claimedAt \+ 30 \* 60_000 : 0/);
  assert.match(adminJs, /El historial se conserva como máximo 7 días/);
  assert.match(adminJs, /if \(action === "claim"\) privateChatActiveFilter = "taken"/);
  assert.match(adminJs, /if \(action === "close"\) privateChatActiveFilter = "finalized"/);
});


test("private chat lifecycle migration aligns claim expiry, secure replies and finalization", () => {
  assert.match(lifecycleMigration, /session_expires_at = v_expiry/);
  assert.match(lifecycleMigration, /function public\.private_chat_admin_finalize_expired/);
  assert.match(lifecycleMigration, /interval '30 minutes'/);
  assert.match(lifecycleMigration, /c\.delete_after <= now\(\)/);
  assert.match(lifecycleMigration, /c\.session_expires_at > now\(\)/);
  assert.match(lifecycleMigration, /El acceso a este chat se cerrará en 10 minutos/);
  assert.match(lifecycleMigration, /historial puede conservarse por un máximo de 7 días/);
  assert.doesNotMatch(lifecycleMigration, /se cerrará y se eliminará en 10 minutos/);
});


test("customer still gets privacy, registration and seven-day retention context without duplicated purchase notice", () => {
  assert.match(customerHtml, /private-chat-privacy/);
  assert.match(customerHtml, /private-chat-consent-panel/);
  assert.match(customerHtml, /Go Partners solicita tu nombre completo, número de celular y cédula/);
  assert.match(customerHtml, /El historial se conserva (?:un máximo de|hasta) 7 días/);
  assert.match(customerJs, /Older conversations may still contain a duplicated database message/);
  assert.match(lifecycleMigration, /El registro de compra se completa mediante el procedimiento correspondiente de Go Partners/);
  assert.doesNotMatch(lifecycleMigration, /values \(v_row\.id, 'assistant', v_notice\)/);
});
