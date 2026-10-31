import { Capacitor, SystemBars, SystemBarsStyle } from "@capacitor/core";

function syncAndroidStatusBarStyle() {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return;
  const darkTheme = document.documentElement.getAttribute("data-theme") === "dark";
  const style = darkTheme ? SystemBarsStyle.Dark : SystemBarsStyle.Light;
  SystemBars.setStyle({ style }).catch(error => {
    console.info("No se pudo sincronizar el estilo de la barra de estado.", error);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", syncAndroidStatusBarStyle, { once: true });
} else {
  syncAndroidStatusBarStyle();
}

new MutationObserver(syncAndroidStatusBarStyle).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["data-theme"]
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") syncAndroidStatusBarStyle();
});
