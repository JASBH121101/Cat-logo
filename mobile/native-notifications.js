import { LocalNotifications } from "@capacitor/local-notifications";

(() => {
  const capacitor = window.Capacitor;
  if (!capacitor || typeof capacitor.isNativePlatform !== "function" || !capacitor.isNativePlatform()) return;

  // admin-notifications.mjs remains shared by web and APK. This native-only
  // bridge exposes Capacitor's Local Notifications implementation without
  // changing the browser's existing Web Push path.
  window.JBManagerNativeNotifications = LocalNotifications;

  if (typeof LocalNotifications.addListener === "function") {
    void LocalNotifications.addListener("localNotificationActionPerformed", event => {
      const requestedUrl = event?.notification?.extra?.url;
      if (!requestedUrl) return;
      try {
        const destination = new URL(requestedUrl, window.location.href);
        if (destination.origin !== window.location.origin) return;
        if (!destination.pathname.endsWith("/admin.html")) return;
        window.location.assign(destination.href);
      } catch (error) {
        console.warn("No se pudo abrir la bandeja desde la notificación nativa.", error);
      }
    }).catch(error => {
      console.warn("No se pudo registrar el manejador de notificaciones nativas.", error);
    });
  }
})();
