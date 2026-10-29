/* JB Manager notification worker. Intentionally does not cache catalog/admin assets. */
self.addEventListener("install", event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text?.() || "" };
  }
  const title = String(payload.title || "JB Manager · Nueva solicitud");
  const body = String(payload.body || "Un cliente necesita atención en JB Collections.").slice(0, 180);
  const targetUrl = String(payload.url || new URL("admin.html?open=messages", self.registration.scope).href);
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: new URL("favicon-collections.svg", self.registration.scope).href,
    badge: new URL("favicon-collections.svg", self.registration.scope).href,
    tag: String(payload.tag || payload.conversationId || "jb-private-chat-inbox"),
    renotify: true,
    data: { url: targetUrl },
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const scopeUrl = self.registration.scope;
    const requestedUrl = event.notification.data?.url;
    const targetUrl = new URL(requestedUrl || "admin.html?open=messages", scopeUrl);
    if (targetUrl.origin !== self.location.origin) {
      targetUrl.href = new URL("admin.html?open=messages", scopeUrl).href;
    }
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const adminClient = windows.find(client => {
      try {
        const url = new URL(client.url);
        return url.origin === self.location.origin && /\/admin\.html$/.test(url.pathname);
      } catch {
        return false;
      }
    });

    if (adminClient) {
      await adminClient.focus();
      adminClient.postMessage({ type: "JB_MANAGER_OPEN_MESSAGES" });
      return;
    }
    await self.clients.openWindow(targetUrl.href);
  })());
});
