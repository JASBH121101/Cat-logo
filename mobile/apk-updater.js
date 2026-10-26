import { Capacitor, registerPlugin } from "@capacitor/core";
const NativeApkUpdater = registerPlugin("ApkUpdater");
window.JBManagerApkUpdater = {
  isNative: Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android",
  downloadAndInstall({ url, version } = {}) {
    if (!this.isNative) return Promise.reject(new Error("La descarga nativa solo está disponible en Android."));
    if (!/^\d+\.\d+\.\d+$/.test(String(version || ""))) return Promise.reject(new Error("La versión de actualización no es válida."));
    if (typeof url !== "string" || !url.startsWith("https://github.com/JASBH121101/Cat-logo/releases/download/")) return Promise.reject(new Error("El enlace no pertenece al repositorio oficial."));
    return NativeApkUpdater.downloadAndInstall({ url, version: String(version) });
  },
  getDownloadStatus() { return this.isNative ? NativeApkUpdater.getDownloadStatus() : Promise.resolve({ status: "unsupported" }); },
  installDownloadedApk() {
    if (!this.isNative) return Promise.reject(new Error("La instalación nativa solo está disponible en Android."));
    return NativeApkUpdater.installDownloadedApk();
  }
};
