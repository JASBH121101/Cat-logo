import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

(() => {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return;

  let navigationInProgress = false;

  function isCatalogPath(pathname = window.location.pathname) {
    const clean = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
    return clean.endsWith("/tecnologia")
      || clean.endsWith("/perfumeria")
      || clean.endsWith("/tecnologia/index.html")
      || clean.endsWith("/perfumeria/index.html");
  }

  function isProductDetailRoute() {
    const url = new URL(window.location.href);
    return Boolean(
      window.history.state?.productDetailRoute
      || url.searchParams.has("producto")
      || url.searchParams.has("fragancia")
      || /^#(producto|fragancia)=/.test(url.hash)
    );
  }

  function returnToAdminDashboard() {
    if (navigationInProgress) return;
    navigationInProgress = true;
    window.__jbManagerNativeBackNavigating = true;
    window.__jbManagerAllowCatalogNavigation = true;
    const dashboardUrl = new URL(
      "/index.html?jb-manager-return=dashboard",
      window.location.origin
    );
    window.location.replace(dashboardUrl.href);
  }

  async function handleBackButton(event) {
    if (isCatalogPath()) {
      // A product detail is a nested view: first return to the catalog list.
      // The next Android Back returns directly to the admin dashboard.
      if (isProductDetailRoute()) {
        if (event?.canGoBack || window.history.state?.productDetailRoute) {
          window.history.back();
          return;
        }
      }
      returnToAdminDashboard();
      return;
    }

    const url = new URL(window.location.href);
    // The dashboard reached from a catalog replaced the catalog route. Exit on
    // the next Back press rather than bouncing to a duplicate admin history entry.
    if (url.searchParams.get("jb-manager-return") === "dashboard") {
      await App.exitApp();
      return;
    }

    if (event?.canGoBack) {
      window.history.back();
      return;
    }
    await App.exitApp();
  }

  App.addListener("backButton", event => {
    void handleBackButton(event).catch(error => {
      console.warn("No se pudo gestionar el botón Atrás de Android.", error);
      if (isCatalogPath()) returnToAdminDashboard();
      else void App.exitApp().catch(() => {});
    });
  }).catch(error => {
    console.warn("No se pudo registrar el manejador Atrás de Android.", error);
  });
})();
