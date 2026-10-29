/* JB Manager notification worker. Intentionally does not cache catalog/admin assets. */
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const scopeUrl = self.registration.scope;
    const targetUrl = new URL("admin.html?open=messages", scopeUrl).href;
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
    await self.clients.openWindow(targetUrl);
  })());
});
