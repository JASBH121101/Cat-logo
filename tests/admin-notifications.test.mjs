import assert from "node:assert/strict";
import test from "node:test";
import {
  detectPrivateChatNotificationEvents,
  enableAdminNotifications,
  showAdminNotification,
} from "../admin-notifications.mjs";

function base64url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function makeBrowser({ permission = "default", secure = true, serviceWorker = true, rejectShow = false, rejectSave = false, withSession = true } = {}) {
  const calls = [];
  const endpoint = "https://push.example.test/subscription-1";
  const subscription = {
    endpoint,
    toJSON() {
      return {
        endpoint,
        expirationTime: null,
        keys: { p256dh: base64url(Uint8Array.from({ length: 65 }, (_, i) => i === 0 ? 4 : i)), auth: base64url(new Uint8Array(16).fill(7)) },
      };
    },
  };
  const pushManager = {
    async getSubscription() { calls.push({ getSubscription: true }); return null; },
    async subscribe(options) { calls.push({ subscribe: true, options }); return subscription; },
  };
  const registration = {
    pushManager,
    async showNotification(title, options) {
      calls.push({ title, options });
      if (rejectShow) throw new Error("OS notification blocked");
    },
  };
  const worker = serviceWorker ? {
    async register(url, options) { calls.push({ registered: url, scope: options.scope }); return registration; },
    ready: Promise.resolve(registration),
  } : undefined;
  class FakeNotification {
    constructor(title, options) { calls.push({ title, options, fallback: true }); }
  }
  FakeNotification.permission = permission;
  FakeNotification.requestPermission = async () => {
    calls.push({ permissionRequest: true });
    FakeNotification.permission = "granted";
    return "granted";
  };
  const windowRef = {
    isSecureContext: secure,
    location: { href: "https://jb-collections.pages.dev/admin.html" },
    Notification: FakeNotification,
  };
  const navigatorRef = { serviceWorker: worker, userAgent: "Test Browser" };
  const supabase = {
    from(table) {
      return {
        async upsert(values, options) {
          calls.push({ upsert: true, table, values, options });
          return { error: rejectSave ? { message: "database offline" } : null };
        },
      };
    },
  };
  return {
    windowRef, navigatorRef, NotificationApi: FakeNotification, calls,
    supabase: withSession ? supabase : null,
    currentUser: withSession ? { id: "admin-user-1" } : null,
    publicKey: base64url(Uint8Array.from({ length: 65 }, (_, i) => i === 0 ? 4 : i)),
  };
}

test("activation registers background push, saves this admin device and shows a test notification", async () => {
  const browser = makeBrowser();
  const result = await enableAdminNotifications(browser);
  assert.equal(result.ok, true);
  assert.equal(result.mode, "push");
  assert.ok(browser.calls.some(call => call.permissionRequest));
  assert.ok(browser.calls.some(call => call.registered?.includes("jb-manager-sw.js")));
  assert.ok(browser.calls.some(call => call.subscribe));
  const save = browser.calls.find(call => call.upsert);
  assert.equal(save.table, "admin_push_subscriptions");
  assert.equal(save.values.user_id, "admin-user-1");
  assert.equal(save.values.endpoint, "https://push.example.test/subscription-1");
  assert.equal(save.options.onConflict, "endpoint");
  assert.equal(browser.calls.at(-1).title, "JB Manager");
  assert.match(browser.calls.at(-1).options.data.url, /admin\.html\?open=messages$/);
});

test("activation does not pretend denied permissions were enabled", async () => {
  const browser = makeBrowser({ permission: "denied" });
  const result = await enableAdminNotifications(browser);
  assert.deepEqual({ ok: result.ok, reason: result.reason }, { ok: false, reason: "permission-denied" });
  assert.equal(browser.calls.length, 0);
});

test("activation rejects insecure contexts, unsupported browsers and missing admin sessions", async () => {
  const insecure = makeBrowser({ secure: false });
  assert.equal((await enableAdminNotifications(insecure)).reason, "insecure-context");
  const unsupported = await enableAdminNotifications({
    windowRef: { isSecureContext: true, location: { href: "https://example.test/" } },
    navigatorRef: {},
  });
  assert.equal(unsupported.reason, "unsupported");
  const noPush = makeBrowser({ serviceWorker: false });
  assert.equal((await enableAdminNotifications(noPush)).reason, "push-unsupported");
  const noAdmin = makeBrowser({ withSession: false });
  assert.equal((await enableAdminNotifications(noAdmin)).reason, "admin-session-required");
});

test("push subscription database failures are surfaced instead of silently claiming success", async () => {
  const browser = makeBrowser({ rejectSave: true });
  const result = await enableAdminNotifications(browser);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "push-setup-failed");
  assert.match(result.message, /database offline/);
  assert.equal(browser.calls.some(call => call.title === "JB Manager"), false);
});

test("service-worker display errors are surfaced instead of swallowed", async () => {
  const browser = makeBrowser({ permission: "granted", rejectShow: true });
  const result = await showAdminNotification("Test", "Body", "chat-1", browser);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "display-failed");
  assert.match(result.message, /OS notification blocked/);
});

test("new purchase consent triggers an alert even when latest saved message is from the system", () => {
  const conversation = {
    id: "chat-1", status: "pending_consent", contact_route: "buy", consent_choice: null,
    claimed_by: null, product_name: "Phone X", _latestMessage: { id: "m1", sender_type: "assistant", content: "Confirmá para continuar" },
  };
  const baseline = detectPrivateChatNotificationEvents({ conversations: [conversation], baselineReady: false });
  const accepted = {
    ...conversation,
    status: "pending_advisor",
    consent_choice: "yes",
    _latestMessage: { id: "m2", sender_type: "assistant", content: "Gracias por confirmar" },
  };
  const update = detectPrivateChatNotificationEvents({ conversations: [accepted], previousStates: baseline.nextStates, baselineReady: true });
  assert.equal(update.events.length, 1);
  assert.equal(update.events[0].kind, "request");
  assert.match(update.events[0].title, /quiere comprar/);
  assert.match(update.events[0].body, /Phone X/);
});

test("support route transition triggers a single alert and does not repeat on later polls", () => {
  const pending = { id: "chat-2", status: "pending_consent", contact_route: null, consent_choice: null, product_name: "Tablet", _latestMessage: { id: "m1", sender_type: "assistant" } };
  const baseline = detectPrivateChatNotificationEvents({ conversations: [pending], baselineReady: false });
  const requested = { ...pending, status: "pending_advisor", contact_route: "support", _latestMessage: { id: "m2", sender_type: "assistant" } };
  const first = detectPrivateChatNotificationEvents({ conversations: [requested], previousStates: baseline.nextStates, baselineReady: true });
  assert.equal(first.events.length, 1);
  const second = detectPrivateChatNotificationEvents({ conversations: [requested], previousStates: first.nextStates, baselineReady: true });
  assert.equal(second.events.length, 0);
});

test("new customer messages trigger alerts while an active conversation is open", () => {
  const old = { id: "chat-3", status: "advisor_active", contact_route: "support", claimed_by: "admin-1", _latestMessage: { id: "m1", sender_type: "advisor", content: "Hola" } };
  const baseline = detectPrivateChatNotificationEvents({ conversations: [old], baselineReady: false });
  const updated = { ...old, _latestMessage: { id: "m2", sender_type: "customer", content: "¿Hay stock?" } };
  const result = detectPrivateChatNotificationEvents({ conversations: [updated], previousStates: baseline.nextStates, baselineReady: true });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].kind, "message");
  assert.match(result.events[0].body, /¿Hay stock/);
});

test("declined consent and stable existing requests do not send duplicate alerts", () => {
  const declined = { id: "chat-4", status: "declined_pending_delete", contact_route: "buy", consent_choice: "no", _latestMessage: { id: "m1", sender_type: "assistant" } };
  const baseline = detectPrivateChatNotificationEvents({ conversations: [declined], baselineReady: false });
  const next = detectPrivateChatNotificationEvents({ conversations: [declined], previousStates: baseline.nextStates, baselineReady: true });
  assert.equal(next.events.length, 0);
});
