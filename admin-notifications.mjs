const WORKER_URL = "./jb-manager-sw.js?v=20261029-admin-notifications2";

function dependencies(overrides = {}) {
  return {
    windowRef: overrides.windowRef ?? globalThis.window,
    navigatorRef: overrides.navigatorRef ?? globalThis.navigator,
    NotificationApi: overrides.NotificationApi ?? (overrides.windowRef ?? globalThis.window)?.Notification,
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

async function getRegistration(windowRef, navigatorRef) {
  const serviceWorker = navigatorRef?.serviceWorker;
  if (!serviceWorker) return null;
  const baseUrl = new URL("./", windowRef.location.href);
  const workerUrl = new URL(WORKER_URL, windowRef.location.href);
  // Always register the versioned URL so an existing worker can be updated after a deploy.
  const requested = await serviceWorker.register(workerUrl.href, { scope: baseUrl.href });
  const ready = await serviceWorker.ready;
  const registration = ready && typeof ready.showNotification === "function" ? ready : requested;
  if (!registration || typeof registration.showNotification !== "function") {
    throw new Error("El navegador no activó el Service Worker de notificaciones.");
  }
  return registration;
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

export async function showAdminNotification(title, body, conversationId, overrides = {}) {
  const { windowRef, navigatorRef, NotificationApi } = dependencies(overrides);
  if (!windowRef || !NotificationApi) return { ok: false, reason: "unsupported" };
  if (!isSecureWindow(windowRef)) return { ok: false, reason: "insecure-context" };
  if (NotificationApi.permission !== "granted") return { ok: false, reason: "permission-not-granted" };

  const options = notificationOptions(windowRef, body, conversationId);
  if (navigatorRef?.serviceWorker) {
    try {
      const registration = await getRegistration(windowRef, navigatorRef);
      await registration.showNotification(String(title || "JB Manager"), options);
      return { ok: true, mode: "service-worker" };
    } catch (error) {
      // Keep a visible failure result rather than silently losing the notification.
      return { ok: false, reason: "display-failed", message: String(error?.message || error || "Error desconocido") };
    }
  }

  try {
    // Desktop fallback only. Mobile browsers generally require showNotification on a Service Worker.
    const notification = new NotificationApi(String(title || "JB Manager"), options);
    return { ok: true, mode: "page", notification };
  } catch (error) {
    return { ok: false, reason: "display-failed", message: String(error?.message || error || "Error desconocido") };
  }
}

export async function enableAdminNotifications(overrides = {}) {
  const { windowRef, navigatorRef, NotificationApi } = dependencies(overrides);
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

  return showAdminNotification(
    "JB Manager",
    "Prueba de notificaciones completada. Este dispositivo puede mostrar avisos de mensajería.",
    "private-chat-enabled",
    { windowRef, navigatorRef, NotificationApi },
  );
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
