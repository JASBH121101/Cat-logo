import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const api = readFileSync(new URL("../functions/api/private-chat.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20261028204826_private_chat_secure_workflow_20261028.sql", import.meta.url), "utf8");
const orderDataMigration = readFileSync(new URL("../supabase/migrations/20261029034000_allow_order_contact_data_private_chat.sql", import.meta.url), "utf8");
const singleNoticeFix = readFileSync(new URL("../supabase/migrations/20261028212147_private_chat_single_consent_notice.sql", import.meta.url), "utf8");
const adminRpcPermissions = readFileSync(new URL("../supabase/migrations/20261028230836_revoke_anon_execute_from_private_chat_admin_rpcs.sql", import.meta.url), "utf8");
const customerRpcPermissions = readFileSync(new URL("../supabase/migrations/20261028231046_restrict_customer_chat_rpcs_to_anon.sql", import.meta.url), "utf8");
const chatRlsOptimization = readFileSync(new URL("../supabase/migrations/20261028230934_optimize_private_chat_rls_and_foreign_key_indexes.sql", import.meta.url), "utf8");
const duplicateNoticeRemoval = readFileSync(new URL("../supabase/migrations/20261028212309_remove_duplicate_private_chat_consent.sql", import.meta.url), "utf8");
const customerHtml = readFileSync(new URL("../mensajes.html", import.meta.url), "utf8");
const customerJs = readFileSync(new URL("../private-chat.js", import.meta.url), "utf8");
const adminHtml = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
const adminJs = readFileSync(new URL("../admin.js", import.meta.url), "utf8");
const adminNotifications = readFileSync(new URL("../admin-notifications.mjs", import.meta.url), "utf8");
const adminWorker = readFileSync(new URL("../jb-manager-sw.js", import.meta.url), "utf8");
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
  assert.ok(customerHtml.includes("private-chat.css?v=20261029-a11y-contrast1"));
  assert.ok(customerHtml.includes("private-chat.js?v=20261029-order-data-policy1"));
  assert.match(customerJs, /function applyPrivateChatTheme\(theme\)/);
  assert.match(customerJs, /themeToggle\?\.addEventListener\("click"/);
  assert.match(customerJs, /localStorage\.setItem\("ct-catalog-theme"/);
  assert.match(readFileSync(new URL("../private-chat.css", import.meta.url), "utf8"), /:root\[data-theme="dark"\]/);
});

test("Go Partners order data is allowed while unneeded contact and financial credentials remain blocked", () => {
  const validator = orderDataMigration
    .split("create or replace function public.private_chat_contains_sensitive")[1]
    ?.split("$function$;")[0] || "";
  assert.ok(validator.length > 0, "the private-chat validator is replaced by the new migration");
  assert.ok(!validator.includes("505"), "phone numbers are permitted for order registration");
  assert.ok(!/c[eé]dula|pasaporte|n[uú]mero de identidad/i.test(validator),
    "cédula values are permitted for order registration");
  assert.ok(validator.includes("@[A-Z0-9.-]+"), "unrequested email addresses remain blocked");
  assert.ok(validator.includes("@[A-Z0-9.-]+\\.[A-Z]{2,}"), "email matcher must escape the dot exactly once");
  assert.match(validator, /tarjeta/i, "full payment-card details remain blocked");
  assert.match(validator, /cuenta bancaria/i, "bank-account details remain blocked");
  assert.match(customerHtml, /podés compartir tu nombre completo, cédula y celular/i);
  assert.doesNotMatch(customerHtml, /No escribás aquí cédula, teléfono/i);
  assert.match(customerJs, /PRIVACY_NOTICE_VERSION = "2026-10-29-v3"/);
  assert.match(api, /p_notice_version: "2026-10-29-v3"/);
});

test("purchase consent is displayed only in the consent panel, not duplicated as a chat message", () => {
  assert.match(singleNoticeFix, /set contact_route='buy', consent_notice_version='2026-10-28-v2'/);
  assert.doesNotMatch(singleNoticeFix, /v_notice|values \(v_row\.id, 'assistant', v_notice\)/);
  assert.match(duplicateNoticeRemoval, /consent_notice_version='2026-10-28-v1'/);
  assert.doesNotMatch(duplicateNoticeRemoval, /values \(v_row\.id, 'assistant', v_notice\)/);
  assert.match(customerJs, /PRIVACY_NOTICE_VERSION = "2026-10-29-v3"/);
  assert.ok(customerJs.includes("/^¡Hola! Este es el canal privado de JB Collections\\./i.test(messageContent)"));
  assert.ok(customerJs.includes("/No compartás aquí cédula, teléfono, correo ni datos de pago/i.test(messageContent)"));
  assert.match(adminCss, /html\[data-theme="light"\] \.private-chat-admin-message p/);
  assert.match(adminCss, /html\[data-theme="dark"\] \.private-chat-admin-message\.is-customer/);
  assert.match(adminHtml, /Este chat permite gestionar pedidos y recibir los datos necesarios de Go Partners: nombre completo, cédula y celular/);
  assert.doesNotMatch(adminHtml, /No solicités ni envíes por aquí cédulas, teléfonos/);
  assert.match(adminJs, /Podés recibir nombre completo, cédula y celular para registrar la operación de Go Partners/);
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
  assert.match(customerJs, /localStorage\.setItem\(SESSION_KEY, token\)/);
  assert.match(customerJs, /function loadSessionToken\(\)/);
  assert.match(customerJs, /textContent = String\(item\.content/);
  assert.doesNotMatch(customerHtml, /type="tel"|type="email"|name="cedula"|name="identity/i);
});

test("JB Manager includes a private inbox with claim, manual reply, close and purchase extension", () => {
  assert.match(adminHtml, /data-admin-section="messages"/);
  assert.match(adminHtml, /data-dashboard-action="messages"/);
  assert.match(adminHtml, /dashboard-private-chat-shortcut-count/);
  assert.match(adminJs, /dashboard-private-chat-shortcut-count/);
  assert.match(adminHtml, /data-admin-panel="messages"/);
  assert.doesNotMatch(adminHtml, /id="private-chat-admin-empty"/);
  assert.match(adminHtml, /id="private-chat-admin-claim"[^>]*hidden/);
  assert.match(adminHtml, /id="private-chat-admin-close"[^>]*hidden/);
  assert.match(adminCss, /private-chat-admin-messages \{ flex:0 1 auto!important; min-height:0!important/);
  assert.match(adminHtml, /id="private-chat-admin-claim"/);
  assert.match(adminHtml, /id="private-chat-admin-reply-form"/);
  assert.match(adminHtml, /id="private-chat-admin-purchase"/);
  assert.match(adminHtml, /id="private-chat-admin-close"/);
  assert.match(adminJs, /private_chat_admin_claim/);
  assert.match(adminJs, /private_chat_admin_send/);
  assert.match(adminJs, /private_chat_admin_extend_after_purchase/);
  assert.match(adminJs, /private_chat_admin_close/);
  assert.match(adminJs, /enableAdminNotifications/);
  assert.match(adminNotifications, /NotificationApi\.requestPermission/);
  assert.match(adminNotifications, /serviceWorker\.register/);
  assert.match(adminWorker, /notificationclick/);
  assert.match(adminWorker, /JB_MANAGER_OPEN_MESSAGES/);
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

test("admin-only private chat RPCs revoke anonymous execution but retain authenticated admin access", () => {
  for (const signature of [
    "private_chat_admin_claim(uuid)",
    "private_chat_admin_close(uuid)",
    "private_chat_admin_extend_after_purchase(uuid)",
    "private_chat_admin_send(uuid, text)"
  ]) {
    assert.ok(adminRpcPermissions.includes("REVOKE EXECUTE ON FUNCTION public." + signature + " FROM PUBLIC, anon;"));
    assert.ok(adminRpcPermissions.includes("GRANT EXECUTE ON FUNCTION public." + signature + " TO authenticated;"));
  }
});

test("private-chat RLS uses statement-level auth lookup and foreign-key indexes", () => {
  assert.match(chatRlsOptimization, /private_chat_conversations_product_id_idx/);
  assert.match(chatRlsOptimization, /private_chat_conversations_claimed_by_idx/);
  assert.match(chatRlsOptimization, /WHERE au\.user_id = \(SELECT auth\.uid\(\)\)/);
  assert.match(chatRlsOptimization, /CREATE POLICY "Admins can read private chat conversations"/);
  assert.match(chatRlsOptimization, /CREATE POLICY "Admins can read private chat messages"/);
});

test("public customer-chat RPCs require the anonymous capability-token path, not an authenticated admin session", () => {
  for (const signature of [
    "private_chat_choose_route(text, text)",
    "private_chat_create(text, uuid, text, text, text, text)",
    "private_chat_public_messages(text)",
    "private_chat_public_send(text, text)",
    "private_chat_public_status(text)",
    "private_chat_record_consent(text, text, text)",
    "private_chat_redeem(text, text)"
  ]) {
    assert.ok(customerRpcPermissions.includes("REVOKE EXECUTE ON FUNCTION public." + signature + " FROM PUBLIC, authenticated;"));
    assert.ok(customerRpcPermissions.includes("GRANT EXECUTE ON FUNCTION public." + signature + " TO anon;"));
  }
});
