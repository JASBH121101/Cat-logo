const WORKER_URL = "./jb-manager-sw.js?v=20261029-admin-webpush3";
const registrationPromises = new WeakMap();

function dependencies(overrides = {}) {
  const windowRef = overrides.windowRef ?? globalThis.window;
  return {
    windowRef,
    navigatorRef: overrides.navigatorRef ?? globalThis.navigator,
    NotificationApi: overrides.NotificationApi ?? windowRef?.Notification,
    supabase: overrides.supabase,
    currentUser: overrides.currentUser,
    publicKey: overrides.publicKey,
  };
}

function isSecureWindow(windowRef) {
  if (windowRef?.isSecureContext) return true;
  try {
    return ["localhost", "127.0.0.1", "::1"].includes(new URL(windowRef.location.href).hostname);
  } catch {
    return false;
  }
}

async function getRegistration(windowRef, navigatorRef, readyTimeoutMs = 12000) {
  const serviceWorker = navigatorRef?.serviceWorker;
  if (!serviceWorker) return null;
  let promise = registrationPromises.get(serviceWorker);
  if (!promise) {
    promise = (async () => {
      const baseUrl = new URL("./", windowRef.location.href);
      const workerUrl = new URL(WORKER_URL, windowRef.location.href);
      // Register the versioned script so a deployment can update the worker already installed.
      const requested = await serviceWorker.register(workerUrl.href, { scope: baseUrl.href });
      let timeoutId;
      let ready;
      try {
        ready = await Promise.race([
          serviceWorker.ready,
          new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error(
              "El navegador no terminó de activar el servicio de notificaciones. Actualizá JB Manager y volvé a intentarlo."
            )), Math.max(1, Number(readyTimeoutMs) || 12000));
          })
        ]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
      const registration = ready && typeof ready.showNotification === "function" ? ready : requested;
      if (!registration || typeof registration.showNotification !== "function") {
        throw new Error("El navegador no activó el Service Worker de notificaciones.");
      }
      return registration;
    })();
    registrationPromises.set(serviceWorker, promise);
  }
  try {
    return await promise;
  } catch (error) {
    registrationPromises.delete(serviceWorker);
    throw error;
  }
}

function notificationOptions(windowRef, body, conversationId) {
  return {
    body: String(body || "").slice(0, 180),
    icon: new URL("./favicon-collections.svg", windowRef.location.href).href,
    badge: new URL("./favicon-collections.svg", windowRef.location.href).href,
    tag: "jb-private-chat-" + String(conversationId || "inbox"),
    renotify: true,
    data: { url: new URL("./admin.html?open=messages", windowRef.location.href).href },
  };
}

function decodeBase64Url(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function registerPushSubscription({ registration, navigatorRef, windowRef, supabase, currentUser, publicKey }) {
  if (!registration?.pushManager || typeof registration.pushManager.subscribe !== "function") {
    return { ok: false, reason: "push-unsupported" };
  }
  if (!supabase || !currentUser?.id) return { ok: false, reason: "admin-session-required" };
  if (!publicKey) return { ok: false, reason: "push-config-missing" };

  const keyBytes = decodeBase64Url(publicKey);
  if (keyBytes.length !== 65 || keyBytes[0] !== 4) {
    return { ok: false, reason: "invalid-public-key" };
  }

  let subscription = typeof registration.pushManager.getSubscription === "function"
    ? await registration.pushManager.getSubscription()
    : null;
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes,
    });
  }
  const details = typeof subscription.toJSON === "function" ? subscription.toJSON() : subscription;
  const endpoint = String(details?.endpoint || subscription.endpoint || "");
  const p256dh = String(details?.keys?.p256dh || "");
  const auth = String(details?.keys?.auth || "");
  if (!endpoint.startsWith("https://") || !p256dh || !auth) {
    return { ok: false, reason: "invalid-subscription" };
  }

  const { error } = await supabase.from("admin_push_subscriptions").upsert({
    user_id: currentUser.id,
    endpoint,
    p256dh,
    auth_secret: auth,
    expiration_time: details.expirationTime ? new Date(details.expirationTime).toISOString() : null,
    user_agent: String(navigatorRef?.userAgent || windowRef?.navigator?.userAgent || "").slice(0, 300),
    updated_at: new Date().toISOString(),
  }, { onConflict: "endpoint" });
  if (error) {
    throw new Error("El permiso está concedido, pero no se pudo registrar este dispositivo para push: " + String(error.message || error));
  }
  return { ok: true, subscription };
}

export async function showAdminNotification(title, body, conversationId, overrides = {}) {
  const { windowRef, navigatorRef, NotificationApi } = dependencies(overrides);
  if (!windowRef || !NotificationApi) return { ok: false, reason: "unsupported" };
  if (!isSecureWindow(windowRef)) return { ok: false, reason: "insecure-context" };
  if (NotificationApi.permission !== "granted") return { ok: false, reason: "permission-not-granted" };

  const options = notificationOptions(windowRef, body, conversationId);
  if (navigatorRef?.serviceWorker) {
    try {
      const registration = await getRegistration(windowRef, navigatorRef, overrides.serviceWorkerReadyTimeoutMs);
      await registration.showNotification(String(title || "JB Manager"), options);
      return { ok: true, mode: "service-worker" };
    } catch (error) {
      return { ok: false, reason: "display-failed", message: String(error?.message || error || "Error desconocido") };
    }
  }

  try {
    const notification = new NotificationApi(String(title || "JB Manager"), options);
    return { ok: true, mode: "page", notification };
  } catch (error) {
    return { ok: false, reason: "display-failed", message: String(error?.message || error || "Error desconocido") };
  }
}

export async function enableAdminNotifications(overrides = {}) {
  const { windowRef, navigatorRef, NotificationApi, supabase, currentUser, publicKey } = dependencies(overrides);
  if (!windowRef || !NotificationApi) return { ok: false, reason: "unsupported" };
  if (!isSecureWindow(windowRef)) return { ok: false, reason: "insecure-context" };

  let permission = NotificationApi.permission;
  if (permission === "default") {
    if (typeof NotificationApi.requestPermission !== "function") {
      return { ok: false, reason: "permission-request-unavailable" };
    }
    try {
      permission = await NotificationApi.requestPermission();
    } catch (error) {
      return { ok: false, reason: "permission-request-failed", message: String(error?.message || error || "") };
    }
  }
  if (permission !== "granted") return { ok: false, reason: permission === "denied" ? "permission-denied" : "permission-not-granted" };
  if (!navigatorRef?.serviceWorker) return { ok: false, reason: "push-unsupported" };
  if (!supabase || !currentUser?.id) return { ok: false, reason: "admin-session-required" };
  if (!publicKey) return { ok: false, reason: "push-config-missing" };

  try {
    const registration = await getRegistration(windowRef, navigatorRef, overrides.serviceWorkerReadyTimeoutMs);
    const saved = await registerPushSubscription({
      registration, navigatorRef, windowRef, supabase, currentUser, publicKey,
    });
    if (!saved.ok) return saved;

    await registration.showNotification("JB Manager", notificationOptions(
      windowRef,
      "Notificaciones push registradas en este dispositivo. Esta es la prueba de funcionamiento.",
      "private-chat-enabled"
    ));
    return { ok: true, mode: "push" };
  } catch (error) {
    return { ok: false, reason: "push-setup-failed", message: String(error?.message || error || "Error desconocido") };
  }
}

/**
 * Returns notification-worthy chat changes and the state snapshot for the next poll.
 * Consent/route transitions are evaluated independently of message sender_type because
 * accepting a purchase request inserts a system message, not a customer message.
 */
export function detectPrivateChatNotificationEvents({
  conversations = [],
  previousStates = new Map(),
  baselineReady = false,
} = {}) {
  const events = [];
  const nextStates = new Map();

  for (const item of conversations) {
    const id = String(item?.id || "");
    if (!id) continue;
    const previous = previousStates.get(id);
    const latest = item?._latestMessage || null;
    const route = String(item?.contact_route || "");
    const consent = String(item?.consent_choice || "");
    const status = String(item?.status || "");
    const actionable = status === "pending_advisor" && !item?.claimed_by &&
      (route === "support" || (route === "buy" && consent === "yes"));
    const latestId = String(latest?.id || "");

    if (baselineReady && actionable && !previous?.actionable) {
      events.push({
        kind: "request",
        id,
        title: route === "buy" ? "Cliente confirmó que quiere comprar" : "Nueva solicitud de atención",
        body: (String(item?.product_name || "Consulta general") + ": el cliente está listo para continuar.").slice(0, 180),
      });
    } else if (
      baselineReady &&
      previous &&
      latest &&
      latest.sender_type === "customer" &&
      latestId &&
      previous.latestMessageId !== latestId &&
      !["closed", "declined_pending_delete"].includes(status)
    ) {
      events.push({
        kind: "message",
        id,
        title: "Nuevo mensaje de cliente",
        body: (String(item?.product_name || "JB Collections") + ": " + String(latest.content || "")).slice(0, 180),
      });
    }

    nextStates.set(id, {
      actionable,
      status,
      contactRoute: route,
      consentChoice: consent,
      claimedBy: String(item?.claimed_by || ""),
      latestMessageId: latestId,
    });
  }

  return { events, nextStates };
}
