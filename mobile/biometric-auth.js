import { Capacitor, registerPlugin } from "@capacitor/core";

const NativeBiometricAuth = registerPlugin("JbBiometricAuth");
const isAndroidApp = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

const unavailable = {
  available: false,
  enabled: false,
  code: -1,
  message: "La huella solo está disponible en la APK Android."
};

// Keep the web admin independent from native Android packages.
window.JBManagerBiometric = {
  isNative: isAndroidApp,

  getStatus() {
    return isAndroidApp
      ? NativeBiometricAuth.getStatus()
      : Promise.resolve({ ...unavailable });
  },

  enable() {
    if (!isAndroidApp) return Promise.reject(new Error(unavailable.message));
    return NativeBiometricAuth.enable();
  },

  authenticate() {
    if (!isAndroidApp) return Promise.reject(new Error(unavailable.message));
    return NativeBiometricAuth.authenticate();
  },

  disable() {
    if (!isAndroidApp) return Promise.resolve({ enabled: false });
    return NativeBiometricAuth.disable();
  },

  openEnrollmentSettings() {
    if (!isAndroidApp) return Promise.reject(new Error(unavailable.message));
    return NativeBiometricAuth.openEnrollmentSettings();
  }
};
