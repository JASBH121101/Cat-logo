import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const mobileDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(mobileDir, "..");
const webDir = join(mobileDir, "www");
const assetDir = join(mobileDir, "assets");

const excludedRootEntries = new Set([
  ".git",
  ".github",
  "mobile",
  "node_modules",
  "coverage",
  "dist",
  "android",
  "ios"
]);

await rm(webDir, { recursive: true, force: true });
await mkdir(webDir, { recursive: true });

for (const entry of await readdir(repoRoot, { withFileTypes: true })) {
  if (excludedRootEntries.has(entry.name)) continue;
  const source = join(repoRoot, entry.name);
  const destination = join(webDir, entry.name);
  await cp(source, destination, {
    recursive: true,
    force: true,
    filter: (candidate) => {
      const relativePath = relative(repoRoot, candidate);
      const firstSegment = relativePath.split(sep)[0];
      return !excludedRootEntries.has(firstSegment);
    }
  });
}

const adminPath = join(webDir, "admin.html");
let adminHtml = await readFile(adminPath, "utf8");

// Capacitor 8 edge-to-edge: keep the top inset inside the header instead of
// adding blank padding before the entire page. Older WebViews are padded natively
// by Capacitor and expose a zero CSS inset; newer WebViews expose the real inset.
adminHtml = adminHtml.replace(
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
);
const androidSafeAreaStyle = `
<style id="jb-manager-android-safe-area">
  :root {
    --jb-manager-safe-top: var(--safe-area-inset-top, env(safe-area-inset-top, 0px));
  }
  html { min-height: 100%; }
  body.admin-body {
    padding-top: 0 !important;
    box-sizing: border-box;
  }
  body.admin-body.admin-dashboard-active .site-header.admin-header {
    height: calc(var(--admin-header-height, 64px) + var(--jb-manager-safe-top, 0px)) !important;
    min-height: calc(var(--admin-header-height, 64px) + var(--jb-manager-safe-top, 0px)) !important;
    padding-top: var(--jb-manager-safe-top, 0px) !important;
    box-sizing: border-box !important;
    margin-top: 0 !important;
  }
  body.admin-body:not(.admin-dashboard-active) .site-header.admin-header {
    min-height: calc(68px + var(--jb-manager-safe-top, 0px)) !important;
    padding-top: calc(10px + var(--jb-manager-safe-top, 0px)) !important;
    box-sizing: border-box !important;
  }
  @media (max-width: 760px) {
    body.admin-body.admin-dashboard-active .admin-sidebar {
      top: calc(var(--admin-header-height, 64px) + var(--jb-manager-safe-top, 0px)) !important;
    }
    body.admin-body.admin-dashboard-active .admin-sidebar-backdrop:not([hidden]) {
      inset: calc(var(--admin-header-height, 64px) + var(--jb-manager-safe-top, 0px)) 0 0 !important;
    }
  }
  @media (max-width: 430px) {
    body.admin-body:not(.admin-dashboard-active) .site-header.admin-header {
      min-height: calc(62px + var(--jb-manager-safe-top, 0px)) !important;
      padding-top: calc(8px + var(--jb-manager-safe-top, 0px)) !important;
    }
  }
</style>
`;
// Android WebView can leave stale composited frames when the soft keyboard resizes
// the viewport. Keep this mitigation scoped to the packaged Android admin panel.
const androidKeyboardPaintFix = `
<style id="jb-manager-android-keyboard-paint-fix">
  html.jb-manager-keyboard-open, html.jb-manager-keyboard-open body {
    scroll-behavior: auto !important;
    overscroll-behavior: contain;
  }
  html.jb-manager-keyboard-open *, html.jb-manager-keyboard-open *::before,
  html.jb-manager-keyboard-open *::after {
    animation: none !important;
    transition: none !important;
    scroll-behavior: auto !important;
    -webkit-backdrop-filter: none !important;
    backdrop-filter: none !important;
  }
  html.jb-manager-keyboard-open body {
    -webkit-transform: none !important;
    transform: none !important;
  }
</style>
<script id="jb-manager-android-keyboard-paint-fix-script">
(() => {
  if (!window.Capacitor || !window.Capacitor.isNativePlatform || !window.Capacitor.isNativePlatform()) return;
  const root = document.documentElement;
  let raf = 0;
  let keyboardOpen = false;
  function repaint() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      // Toggle only a root class: force WebView to recalculate styles after IME resize.
      root.classList.toggle("jb-manager-keyboard-open", keyboardOpen);
      void root.offsetHeight;
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event("resize"));
        const active = document.activeElement;
        if (keyboardOpen && active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) {
          active.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
      });
    });
  }
  function syncKeyboard() {
    const vv = window.visualViewport;
    keyboardOpen = Boolean(vv && window.innerHeight - vv.height > 140 && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || ""));
    repaint();
  }
  window.visualViewport?.addEventListener("resize", syncKeyboard);
  window.visualViewport?.addEventListener("scroll", syncKeyboard);
  document.addEventListener("focusin", syncKeyboard, true);
  document.addEventListener("focusout", () => { setTimeout(syncKeyboard, 120); }, true);
  window.addEventListener("orientationchange", () => { setTimeout(syncKeyboard, 180); });
  syncKeyboard();
})();
</script>
`;
if (!adminHtml.includes('id="jb-manager-android-keyboard-paint-fix"')) {
  adminHtml = adminHtml.replace("</head>", androidKeyboardPaintFix + "\n</head>");
}
if (!adminHtml.includes('id="jb-manager-android-safe-area"')) {
  adminHtml = adminHtml.replace("</head>", androidSafeAreaStyle + "\n</head>");
}

const updaterBundlePath = join(webDir, "jb-manager-apk-updater.js");
await build({
  entryPoints: [join(mobileDir, "apk-updater.js")],
  outfile: updaterBundlePath,
  bundle: true,
  platform: "browser",
  format: "iife",
  target: ["es2020"],
  minify: true,
  legalComments: "none"
});
const systemBarsBundlePath = join(webDir, "jb-manager-system-bars.js");
await build({
  entryPoints: [join(mobileDir, "system-bars.js")],
  outfile: systemBarsBundlePath,
  bundle: true,
  platform: "browser",
  format: "iife",
  target: ["es2020"],
  minify: true,
  legalComments: "none"
});

const replacements = [
  [
    '<header class="site-header admin-header">',
    '<header id="app-top" class="site-header admin-header">'
  ],
  [
    '<a class="brand" href="./" aria-label="JB Manager — administración de catálogos">',
    '<a class="brand" href="#app-top" aria-label="JB Manager Collections — inicio del panel">'
  ],
  [
    '<a class="admin-sidebar-brand" href="./" aria-label="JB Manager, volver al catálogo tecnológico">',
    '<a class="admin-sidebar-brand" href="#app-top" aria-label="JB Manager Collections, volver al inicio">'
  ],
  [
    "<title>JB Manager | Panel de catálogos</title>",
    "<title>JB Manager Collections | Panel de catálogos</title>"
  ]
];

for (const [from, to] of replacements) {
  if (!adminHtml.includes(from)) {
    throw new Error(`Expected admin.html fragment was not found: ${from}`);
  }
  adminHtml = adminHtml.replace(from, to);
}

if (!adminHtml.includes('src="./jb-manager-apk-updater.js"')) {
  const scriptBodyEnd = adminHtml.toLowerCase().lastIndexOf("</body>");
  if (scriptBodyEnd < 0) throw new Error("Expected admin.html body end for native updater bridge.");
  adminHtml = adminHtml.slice(0, scriptBodyEnd)
    + '<script src="./jb-manager-apk-updater.js"></script>\n'
    + adminHtml.slice(scriptBodyEnd);
}

if (!adminHtml.includes('src="./jb-manager-system-bars.js"')) {
  const scriptBodyEnd = adminHtml.toLowerCase().lastIndexOf("</body>");
  if (scriptBodyEnd < 0) throw new Error("Expected admin.html body end for native system-bars bridge.");
  adminHtml = adminHtml.slice(0, scriptBodyEnd)
    + '<script src="./jb-manager-system-bars.js" defer></script>\n'
    + adminHtml.slice(scriptBodyEnd);
}
// Add a persistent update button and check GitHub Releases for a newer APK.
// Android still requires the user to confirm installation of a downloaded APK.
const appVersion = process.env.JB_MANAGER_VERSION || "1.0.0";
const updateChecker = `
<script data-jb-manager-updater>
(() => {
  const currentVersion = ${JSON.stringify(appVersion)};
  const releasesUrl = "https://api.github.com/repos/JASBH121101/Cat-logo/releases?per_page=30";
  let checking = false;
  let checkSequence = 0;
  let activeDownloadUrl = "";
  let activeDownloadVersion = "";
  let nativeMonitorTimer = null;
  let nativeMonitorBusy = false;
  let automaticInstallAttemptedFor = "";

  function downloadUrlFor(version) {
    return "https://jb-collections.pages.dev/api/download/apk?version=" + encodeURIComponent(String(version || ""));
  }

  function compareVersions(left, right) {
    const a = String(left).split(".").map(n => Number(n) || 0);
    const b = String(right).split(".").map(n => Number(n) || 0);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0) ? 1 : -1;
    }
    return 0;
  }

  function officialRelease(item) {
    if (!item || item.draft || item.prerelease === false) return null;
    const match = /^jb-manager-v(\\d+\\.\\d+\\.\\d+)$/i.exec(String(item.tag_name || ""));
    if (!match) return null;
    const asset = (item.assets || []).find(entry => entry.name === "JB-Manager-Collections.apk");
    const expected = new RegExp("^https://github\\.com/JASBH121101/Cat-logo/releases/download/jb-manager-v" + match[1].replace(/\\./g, "\\\\.") + "/JB-Manager-Collections\\.apk$", "i");
    if (!asset || !expected.test(String(asset.browser_download_url || ""))) return null;
    return { version: match[1], asset, downloadUrl: downloadUrlFor(match[1]) };
  }

  function showMessage(title, message, downloadUrl, downloadVersion) {
    let notice = document.getElementById("jb-manager-update-notice");
    if (!notice) {
      notice = document.createElement("aside");
      notice.id = "jb-manager-update-notice";
      notice.setAttribute("role", "status");
      Object.assign(notice.style, {
        position: "fixed", zIndex: "2147483001", left: "12px", right: "12px",
        bottom: "max(76px, calc(env(safe-area-inset-bottom) + 76px))",
        maxWidth: "520px", margin: "0 auto", padding: "15px",
        borderRadius: "16px", border: "1px solid #d9c18a",
        background: "#101827", color: "#ffffff",
        boxShadow: "0 12px 38px rgba(0,0,0,.32)", font: "14px/1.45 system-ui, sans-serif"
      });
      document.documentElement.append(notice);
    }
    notice.replaceChildren();
    const heading = document.createElement("strong");
    heading.textContent = title;
    heading.style.display = "block";
    heading.style.marginBottom = "5px";
    const detail = document.createElement("p");
    detail.textContent = message;
    detail.style.margin = "0 0 12px";
    const actions = document.createElement("div");
    Object.assign(actions.style, { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" });

    if (downloadUrl) {
      const download = document.createElement("button");
      download.type = "button";
      download.textContent = "Descargar e instalar";
      Object.assign(download.style, { padding: "10px 13px", borderRadius: "9px", border: "0", background: "#d9b56c", color: "#161616", fontWeight: "700", font: "inherit", cursor: "pointer" });
      download.addEventListener("click", async event => {
        event.preventDefault();
        const api = window.JBManagerApkUpdater;
        if (!api || !api.isNative) {
          window.open(downloadUrl, "_blank", "noopener,noreferrer");
          return;
        }
        activeDownloadUrl = downloadUrl;
        activeDownloadVersion = downloadVersion || "";
        download.disabled = true;
        download.textContent = "Preparando descarga…";
        try {
          const result = await api.downloadAndInstall({ url: downloadUrl, version: activeDownloadVersion });
          if (result && result.permissionRequired) {
            showMessage("Permiso necesario para instalar", "Android abrió Ajustes. Activá «Permitir desde esta fuente» y regresá a JB Manager Collections. La descarga se conserva.", downloadUrl, activeDownloadVersion);
          } else if (result && result.installerLaunched) {
            document.getElementById("jb-manager-update-notice")?.remove();
          } else {
            showMessage("Descarga iniciada", "Android gestiona la descarga con DownloadManager. El progreso, pausas y errores se consultan al sistema.");
            startNativeDownloadMonitor();
          }
        } catch (error) {
          showMessage("No se pudo iniciar la descarga", (error && error.message) || "Android no pudo iniciar la descarga. Podés volver a intentarlo.", downloadUrl, activeDownloadVersion);
        } finally {
          download.disabled = false;
          download.textContent = "Descargar e instalar";
        }
      });
      actions.append(download);
    }
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.textContent = "Cerrar";
    Object.assign(dismiss.style, { padding: "10px 13px", borderRadius: "9px", border: "1px solid #647084", background: "transparent", color: "#ffffff", font: "inherit" });
    dismiss.addEventListener("click", () => notice.remove());
    actions.append(dismiss);
    notice.append(heading, detail, actions);
  }

  function formatBytes(value) {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(0) + " KB";
    return (bytes / 1048576).toFixed(2) + " MB";
  }

  function failureReason(state) {
    if (state.error) return state.error;
    const reasons = {1001:"Android no pudo escribir el archivo.",1002:"El servidor respondió con un código HTTP no válido.",1004:"La conexión se interrumpió.",1005:"El servidor redirigió demasiadas veces.",1006:"No hay espacio suficiente.",1007:"Android no encontró el almacenamiento.",1008:"Android no pudo reanudar la descarga.",1009:"Ya existe un archivo con el mismo nombre.",1010:"Android bloqueó la descarga."};
    return reasons[Number(state.reason) || 0] || "Android no pudo completar la descarga (código " + (Number(state.reason) || 0) + ").";
  }

  function updateDownloadNotice(title, message, url, version) {
    const notice = document.getElementById("jb-manager-update-notice");
    if (!notice) { showMessage(title, message, url, version); return; }
    const heading = notice.querySelector("strong");
    const detail = notice.querySelector("p");
    if (heading) heading.textContent = title;
    if (detail) detail.textContent = message;
    if (url && !notice.querySelector("[data-jb-update-retry]")) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.dataset.jbUpdateRetry = "true";
      retry.textContent = "Reintentar / abrir instalador";
      Object.assign(retry.style, { padding:"10px 13px", borderRadius:"9px", border:"0", background:"#d9b56c", color:"#161616", font:"inherit", cursor:"pointer" });
      retry.addEventListener("click", async () => {
        const api = window.JBManagerApkUpdater;
        if (!api || !api.isNative) { window.open(url, "_blank", "noopener,noreferrer"); return; }
        try {
          const result = await api.downloadAndInstall({ url, version: version || "" });
          if (result && result.permissionRequired) showMessage("Permiso necesario para instalar", "Activá «Permitir desde esta fuente» y regresá.", url, version);
          else if (result && result.installerLaunched) document.getElementById("jb-manager-update-notice")?.remove();
          else { showMessage("Descarga iniciada", "Android aceptó o recuperó la descarga."); startNativeDownloadMonitor(); }
        } catch (error) { showMessage("No se pudo continuar", (error && error.message) || "Intentá nuevamente.", url, version); }
      });
      notice.querySelector("div")?.prepend(retry);
    }
  }

  async function pollNativeDownload() {
    if (nativeMonitorBusy) return;
    const api = window.JBManagerApkUpdater;
    if (!api || !api.isNative) return;
    nativeMonitorBusy = true;
    try {
      const state = await api.getDownloadStatus();
      if (!state || ["idle", "unsupported"].includes(state.status)) {
        if (nativeMonitorTimer) window.clearInterval(nativeMonitorTimer);
        nativeMonitorTimer = null;
        return;
      }
      if (state.version) {
        activeDownloadVersion = state.version;
        activeDownloadUrl = downloadUrlFor(state.version);
      }
      const total = Number(state.totalBytes) || 0;
      const downloaded = Number(state.bytesDownloaded) || 0;
      if (["pending", "running", "paused"].includes(state.status)) {
        const amount = total > 0 ? " · " + formatBytes(downloaded) + " / " + formatBytes(total) : "";
        const percent = total > 0 ? Math.min(100, Math.floor(downloaded * 100 / total)) + "%" : "calculando";
        updateDownloadNotice("Descargando actualización · v" + (state.version || activeDownloadVersion), "DownloadManager: " + percent + amount + (state.status === "paused" ? ". Android pausó la descarga temporalmente." : "."), activeDownloadUrl, activeDownloadVersion);
        return;
      }
      if (state.status === "successful") {
        if (nativeMonitorTimer) window.clearInterval(nativeMonitorTimer);
        nativeMonitorTimer = null;
        // Android persists download state across WebView reloads. Once the installer
        // has already been opened, never recreate a modal on every panel visit.
        if (state.installPrompted) {
          document.getElementById("jb-manager-update-notice")?.remove();
          return;
        }
        const attemptKey = String(state.downloadId || "") + ":" + String(state.version || "");
        if (automaticInstallAttemptedFor === attemptKey) {
          document.getElementById("jb-manager-update-notice")?.remove();
          return;
        }
        automaticInstallAttemptedFor = attemptKey;
        try {
          const result = await api.installDownloadedApk();
          if (result && result.permissionRequired) {
            showMessage("Permiso necesario para instalar", "Activá «Permitir desde esta fuente» y regresá. El APK ya está descargado.", activeDownloadUrl, activeDownloadVersion);
          } else if (result && result.installerLaunched) {
            // The Android installer is the confirmation UI; don't place a second
            // persistent dialog on top of the admin panel.
            document.getElementById("jb-manager-update-notice")?.remove();
          }
        } catch (error) {
          showMessage("APK descargado, instalación pendiente", (error && error.message) || "No se pudo abrir el instalador. El archivo se conserva para reintentar.", activeDownloadUrl, activeDownloadVersion);
        }
        return;
      }
      if (state.status === "failed") {
        if (nativeMonitorTimer) window.clearInterval(nativeMonitorTimer);
        nativeMonitorTimer = null;
        showMessage("Descarga interrumpida", failureReason(state) + " Pulsá «Reintentar / abrir instalador» para volver a intentarlo.", activeDownloadUrl, activeDownloadVersion);
        return;
      }
      if (state.status === "unknown") {
        if (nativeMonitorTimer) window.clearInterval(nativeMonitorTimer);
        nativeMonitorTimer = null;
        showMessage("No se pudo consultar la descarga", "Android no encontró la descarga anterior. Podés iniciar otra.", activeDownloadUrl, activeDownloadVersion);
      }
    } catch (error) {
      updateDownloadNotice("Comprobando descarga…", "Android sigue gestionando la descarga; se consultará de nuevo.", activeDownloadUrl, activeDownloadVersion);
      console.info("No se pudo consultar el estado nativo de la descarga.", error);
    } finally { nativeMonitorBusy = false; }
  }

  function startNativeDownloadMonitor() {
    if (nativeMonitorTimer) window.clearInterval(nativeMonitorTimer);
    void pollNativeDownload();
    nativeMonitorTimer = window.setInterval(() => void pollNativeDownload(), 1200);
  }

  async function resumeNativeDownloadIfNeeded() {
    const api = window.JBManagerApkUpdater;
    if (!api || !api.isNative) return;
    try {
      const state = await api.getDownloadStatus();
      if (!state) return;
      activeDownloadVersion = state.version || "";
      activeDownloadUrl = activeDownloadVersion ? downloadUrlFor(activeDownloadVersion) : "";
      if (["pending", "running", "paused"].includes(state.status)) {
        showMessage("Descarga de actualización en curso", "Se recuperó el estado persistente de Android. Podés consultar el progreso.", activeDownloadUrl, activeDownloadVersion);
        startNativeDownloadMonitor();
      } else if (state.status === "successful") {
        if (state.installPrompted) {
          document.getElementById("jb-manager-update-notice")?.remove();
          return;
        }
        // Download completed before the installer was opened (for example, if
        // the app was closed). Try the installer without recreating a modal.
        startNativeDownloadMonitor();
      } else if (state.status === "failed") {
        showMessage("La descarga anterior falló", failureReason(state) + " Podés reintentar.", activeDownloadUrl, activeDownloadVersion);
      }
    } catch (error) { console.info("No se pudo recuperar el estado de descarga.", error); }
  }

  async function checkForUpdates(interactive = false) {
    if (checking) return;
    checking = true;
    const sequence = ++checkSequence;
    const button = document.getElementById("jb-manager-check-updates");
    if (button) {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      button.style.opacity = ".76";
    }
    try {
      const response = await fetch(releasesUrl, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
      if (!response.ok) throw new Error("GitHub respondió " + response.status);
      const releases = await response.json();
      const latest = releases.map(officialRelease).filter(Boolean).sort((a, b) => compareVersions(b.version, a.version))[0];
      if (!latest) {
        if (interactive) showMessage("No hay versiones publicadas", "No se encontró una publicación válida de JB Manager Collections con APK.");
        return;
      }
      if (compareVersions(latest.version, currentVersion) > 0) {
        showMessage("Actualización disponible · v" + latest.version, "El APK se descargará con el administrador nativo. Al finalizar, Android validará el archivo y abrirá el instalador.", latest.downloadUrl, latest.version);
      } else if (interactive) {
        showMessage("JB Manager está actualizado", "Versión de esta compilación: v" + currentVersion + ". Última versión publicada: v" + latest.version + ".");
      }
    } catch (error) {
      if (interactive) showMessage("No se pudo comprobar", "Revisá la conexión e intentá de nuevo. " + (error && error.message ? error.message : ""));
      console.info("No se pudo consultar si hay una actualización disponible.", error);
    } finally {
      checking = false;
      if (button && sequence === checkSequence) {
        button.disabled = false;
        button.removeAttribute("aria-busy");
        button.style.opacity = "1";
      }
    }
  }

  function init() {
    if (!document.getElementById("jb-manager-check-updates")) {
      const button = document.createElement("button");
      button.id = "jb-manager-check-updates";
      button.type = "button";
      button.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M20 7v5h-5"></path><path d="M20 12a8 8 0 1 1-2.34-5.66L20 9"></path></svg>';
      button.title = "Buscar actualizaciones";
      button.setAttribute("aria-label", "Buscar actualizaciones de JB Manager Collections");
      button.setAttribute("aria-busy", "false");
      Object.assign(button.style, {
        appearance: "none", boxSizing: "border-box",
        position: "fixed", zIndex: "2147483000",
        right: "max(14px, env(safe-area-inset-right, 0px))",
        bottom: "max(64px, calc(env(safe-area-inset-bottom, 0px) + 20px))",
        width: "44px", height: "44px", minWidth: "44px",
        overflow: "hidden", transform: "translateZ(0)", willChange: "transform",
        padding: "0", display: "grid", placeItems: "center", borderRadius: "14px",
        border: "1px solid rgba(120,150,255,.8)",
        background: "linear-gradient(135deg, rgba(35,89,205,.98), rgba(94,61,204,.98))",
        color: "#f5f7ff", boxShadow: "0 5px 16px rgba(11,25,78,.3)",
        opacity: ".96", fontSize: "0", lineHeight: "0", cursor: "pointer"
      });
      const updateIcon = button.querySelector("svg");
      if (updateIcon) {
        updateIcon.style.display = "block";
        updateIcon.style.fill = "none";
        updateIcon.style.stroke = "currentColor";
        updateIcon.style.strokeWidth = "1.8";
        updateIcon.style.strokeLinecap = "round";
        updateIcon.style.strokeLinejoin = "round";
      }
      button.addEventListener("click", () => void checkForUpdates(true));
      document.documentElement.append(button);
    }
    void checkForUpdates(false);
    void resumeNativeDownloadIfNeeded();
    const updateButton = document.getElementById("jb-manager-check-updates");
    const syncUpdateButtonVisibility = () => {
      if (!updateButton) return;
      const active = document.activeElement;
      const isEditing = Boolean(active && (active.matches("input, textarea, select") || active.isContentEditable));
      const viewport = window.visualViewport;
      const keyboardIsVisible = Boolean(viewport && viewport.height < window.innerHeight * 0.78);
      updateButton.hidden = isEditing || keyboardIsVisible;
    };
    document.addEventListener("focusin", syncUpdateButtonVisibility);
    document.addEventListener("focusout", () => window.setTimeout(syncUpdateButtonVisibility, 100));
    if (window.visualViewport) window.visualViewport.addEventListener("resize", syncUpdateButtonVisibility);
    syncUpdateButtonVisibility();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void checkForUpdates(false);
      void resumeNativeDownloadIfNeeded();
    }
  });
})();
</script>
`;
if (!adminHtml.includes("data-jb-manager-updater")) {
  const bodyEnd = adminHtml.toLowerCase().lastIndexOf("</body>");
  if (bodyEnd < 0) throw new Error("Expected admin.html body end for update checker.");
  adminHtml = adminHtml.slice(0, bodyEnd) + updateChecker + "\n" + adminHtml.slice(bodyEnd);
}

// The app's first screen is the administration panel. Keep both routes available.
await writeFile(adminPath, adminHtml, "utf8");
await writeFile(join(webDir, "index.html"), adminHtml, "utf8");

// Build explicit icon layers from the existing JB logo. The full framed logo is
// kept for legacy launcher icons; Android adaptive icons use only the gold mark
// over the navy background so Android does not nest a second rounded-square frame.
await rm(assetDir, { recursive: true, force: true });
await mkdir(assetDir, { recursive: true });
const iconSource = await readFile(join(repoRoot, "favicon-collections.svg"), "utf8");
const sharp = (await import("sharp")).default;

const iconOnlyPng = await sharp(Buffer.from(iconSource))
  .resize(1024, 1024, { fit: "fill" })
  .png()
  .toBuffer();
await writeFile(join(assetDir, "icon-only.png"), iconOnlyPng);

const foregroundSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="108" height="108" viewBox="0 0 108 108">' +
  '<defs><linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">' +
  '<stop stop-color="#fff0c5"/><stop offset=".5" stop-color="#d1a45a"/><stop offset="1" stop-color="#fff0c5"/>' +
  '</linearGradient></defs>' +
  '<g transform="translate(2.8 13.2) scale(1.6)">' +
  '<path d="M32 6 L34.5 12.5 L41 15 L34.5 17.5 L32 24 L29.5 17.5 L23 15 L29.5 12.5 Z" fill="url(#gold)"/>' +
  '<text x="31" y="45" text-anchor="middle" fill="url(#gold)" font-family="Georgia,serif" font-size="29" font-weight="600" letter-spacing="-3">JB</text>' +
  '</g></svg>';
const foregroundPng = await sharp(Buffer.from(foregroundSvg))
  .resize(1024, 1024, { fit: "fill" })
  .png()
  .toBuffer();
await writeFile(join(assetDir, "icon-foreground.png"), foregroundPng);

const backgroundSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">' +
  '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">' +
  '<stop stop-color="#19100d"/><stop offset=".5" stop-color="#11172a"/><stop offset="1" stop-color="#07101f"/>' +
  '</linearGradient></defs><rect width="1024" height="1024" fill="url(#bg)"/></svg>';
const backgroundPng = await sharp(Buffer.from(backgroundSvg)).png().toBuffer();
await writeFile(join(assetDir, "icon-background.png"), backgroundPng);

// A restrained splash screen, using the original logo on the same navy gradient.
const splashBackgroundSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="2732" height="2732" viewBox="0 0 2732 2732">' +
  '<rect width="2732" height="2732" fill="#11172a"/></svg>';
const splashBackgroundPng = await sharp(Buffer.from(splashBackgroundSvg)).png().toBuffer();
const splashLogo = await sharp(iconOnlyPng).resize(520, 520).png().toBuffer();
const splashPng = await sharp(splashBackgroundPng)
  .composite([{ input: splashLogo, left: 1106, top: 1106 }])
  .png()
  .toBuffer();
await writeFile(join(assetDir, "splash.png"), splashPng);
await writeFile(join(assetDir, "splash-dark.png"), splashPng);

const internalLinkHandler = `
<script data-jb-manager-android-shell>
(() => {
  const isCatalogPath = (pathname = window.location.pathname) => {
    const clean = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
    return clean.endsWith("/tecnologia")
      || clean.endsWith("/perfumeria")
      || clean.endsWith("/tecnologia/index.html")
      || clean.endsWith("/perfumeria/index.html");
  };

  // Keep a history checkpoint on catalog routes. Native Android back handling
  // is implemented by the bundled Capacitor App plugin below. This popstate
  // fallback handles WebView/browser history without hijacking the return from
  // an in-catalog product detail to the catalog list.
  if (isCatalogPath() && !window.history.state?.__jbManagerCatalogBackGuard) {
    window.history.pushState({ __jbManagerCatalogBackGuard: true }, "", window.location.href);
  }
  window.addEventListener("popstate", (event) => {
    if (!isCatalogPath()) return;
    if (event.state?.__jbManagerCatalogBackGuard || window.history.state?.__jbManagerCatalogBackGuard) return;
    const currentUrl = new URL(window.location.href);
    const isProductDetail = currentUrl.searchParams.has("producto")
      || currentUrl.searchParams.has("fragancia")
      || /^#(producto|fragancia)=/.test(currentUrl.hash);
    if (isProductDetail) return;
    window.__jbManagerAllowCatalogNavigation = true;
    window.location.replace(new URL("/index.html?jb-manager-return=dashboard", window.location.origin).href);
  });

  // A catalog link is an intentional navigation: the editor's recovery draft
  // is saved while leaving, so don't let the unsaved-changes warning cancel it.
  window.addEventListener("beforeunload", (event) => {
    if (!window.__jbManagerAllowCatalogNavigation) return;
    event.stopImmediatePropagation();
    event.stopPropagation();
  }, true);

  document.addEventListener("click", (event) => {
    const anchor = event.target && event.target.closest
      ? event.target.closest("a[href]")
      : null;
    if (!anchor) return;
    if (anchor.matches(".admin-sidebar-catalog-link")) {
      window.__jbManagerAllowCatalogNavigation = true;
    }

    let destination;
    try {
      destination = new URL(anchor.href, document.baseURI);
    } catch {
      return;
    }

    // Android's bundled asset server can fall back to the app's root page when
    // navigating to a directory URL. Resolve catalog routes to their index file.
    if (destination.origin === window.location.origin) {
      const isDirectoryRoute =
        destination.pathname.endsWith("/") && destination.pathname !== "/";
      const cleanRoutePath = destination.pathname.endsWith("/") ? destination.pathname.slice(0, -1) : destination.pathname;
      const isCatalogRoute = cleanRoutePath.endsWith("/tecnologia") || cleanRoutePath.endsWith("/perfumeria") || cleanRoutePath.endsWith("/tecnologia/index.html") || cleanRoutePath.endsWith("/perfumeria/index.html");
      if (isDirectoryRoute) destination.pathname += "index.html";

      // Leaving the admin for either public catalog is intentional. The editor's
      // recovery draft is already saved locally, so suppress only this exit warning.
      if (isCatalogRoute) window.__jbManagerAllowCatalogNavigation = true;

      // Keep same-app links in the WebView; external links are left to Android.
      if (anchor.target === "_blank" || isDirectoryRoute) {
        event.preventDefault();
        window.location.assign(destination.href);
      }
    }
  }, true);
})();
</script>
`;

async function addExplicitCapacitorBase(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await addExplicitCapacitorBase(fullPath);
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".html")) continue;

    const relativePath = relative(webDir, fullPath).split(sep).join("/");
    const folder = dirname(relativePath);
    const routePath = folder === "." ? "/" : "/" + folder + "/";
    const baseTag = '<base href="https://localhost' + routePath + '">';
    let html = await readFile(fullPath, "utf8");
    if (/<base\s/i.test(html)) {
      html = html.replace(/<base\s+[^>]*>/i, baseTag);
    } else {
      html = html.replace(/<head([^>]*)>/i, '<head$1>\n  ' + baseTag);
    }
    await writeFile(fullPath, html, "utf8");
  }
}

// Bundle Capacitor's native back-button plugin locally so back navigation
// does not depend on downloading JavaScript at runtime.
const nativeBackBundlePath = join(webDir, "jb-manager-back-navigation.js");
await build({
  entryPoints: [join(mobileDir, "back-navigation.js")],
  outfile: nativeBackBundlePath,
  bundle: true,
  platform: "browser",
  format: "iife",
  target: ["es2020"],
  minify: true,
  legalComments: "none"
});

async function injectNavigationSupport(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await injectNavigationSupport(fullPath);
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".html")) continue;
    let html = await readFile(fullPath, "utf8");
    if (html.includes("data-jb-manager-android-shell")) continue;
    if (/<\/head>/i.test(html)) {
      html = html.replace(
        /<\/head>/i,
        `${internalLinkHandler}\n<script src="/jb-manager-back-navigation.js" defer data-jb-manager-native-back></script>\n</head>`
      );
      await writeFile(fullPath, html, "utf8");
    }
  }
}

await addExplicitCapacitorBase(webDir);
await injectNavigationSupport(webDir);

// The current main branch keeps its responsive rules in the page-specific stylesheets.
// The Android wrapper also ships a shared responsive guardrail stylesheet from its
// build-support branch. Add its reference to the generated app and both catalog pages.
const bundledResponsiveCss = join(webDir, "responsive-layout.css");
await readFile(bundledResponsiveCss, "utf8");
for (const relativePage of [
  "index.html",
  "admin.html",
  "tecnologia/index.html",
  "perfumeria/index.html"
]) {
  const pagePath = join(webDir, relativePage);
  let html = await readFile(pagePath, "utf8");
  if (!html.includes("responsive-layout.css")) {
    if (!html.toLowerCase().includes("</head>")) {
      throw new Error("Could not insert responsive stylesheet reference into " + relativePage + ".");
    }
    html = html.replace(
      "</head>",
      '<link rel="stylesheet" href="/responsive-layout.css">\\n</head>'
    );
  }
  if (!html.includes("jb-manager-back-navigation.js")) {
    if (!html.toLowerCase().includes("</head>")) {
      throw new Error("Could not insert native back handler into " + relativePage + ".");
    }
    html = html.replace(
      "</head>",
      '<script src="/jb-manager-back-navigation.js" defer data-jb-manager-native-back></script>\\n</head>'
    );
  }
  await writeFile(pagePath, html, "utf8");
}

// Validate the generated browser-side scripts before Android packages them.
const builtAdminHtml = await readFile(join(webDir, "admin.html"), "utf8");
const builtAdminScript = await readFile(join(webDir, "admin.js"), "utf8");
const builtThemeCss = await readFile(join(webDir, "theme-ui.css"), "utf8");

// Prevent future Android packaging from silently dropping login/session controls
// that exist in current main but were absent from an older mobile source branch.
for (const [label, source, fragments] of [
  ["admin.html", builtAdminHtml, ['id="login-remember-user"', 'id="remember-user-toggle"', 'id="remember-user-toggle-label"']],
  ["admin.js", builtAdminScript, ["REMEMBER_SESSION_KEY", "supabaseAuthStorage", "setRememberedSession", "getRememberedAdminEmail"]],
  ["theme-ui.css", builtThemeCss, [".login-remember-option", ".admin-sidebar-remember"]]
]) {
  for (const fragment of fragments) {
    if (!source.includes(fragment)) {
      throw new Error("Android bundle lost a required remember-session feature: " + label + " is missing " + fragment);
    }
  }
}

const updaterScript = builtAdminHtml.match(/<script\s+data-jb-manager-updater>([\s\S]*?)<\/script>/i);
if (!updaterScript) throw new Error("APK update button script was not generated.");
new Function(updaterScript[1]);

const builtCatalogHtml = await readFile(join(webDir, "tecnologia", "index.html"), "utf8");
const perfumeCatalogHtml = await readFile(join(webDir, "perfumeria", "index.html"), "utf8");
const builtAiAssistant = await readFile(join(webDir, "ai-assistant.js"), "utf8");
new Function(builtAiAssistant);
if (!builtAiAssistant.includes("/api/assistant")
  || !builtAiAssistant.includes("data.recommendations")
  || !builtAiAssistant.includes("Continuar por WhatsApp")) {
  throw new Error("The AI sales advisor bundle is incomplete.");
}
for (const [catalogPath, html] of [
  ["tecnologia/index.html", builtCatalogHtml],
  ["perfumeria/index.html", perfumeCatalogHtml]
]) {
  if (!html.includes("ai-assistant.js") || !html.includes("ai-assistant.css")) {
    throw new Error("The AI sales advisor is missing from " + catalogPath + ".");
  }
}
const responsiveAdminHtml = builtAdminHtml;
for (const [pagePath, html] of [
  ["admin.html", responsiveAdminHtml],
  ["tecnologia/index.html", builtCatalogHtml],
  ["perfumeria/index.html", perfumeCatalogHtml]
]) {
  if (!html.includes("responsive-layout.css")) {
    throw new Error("The responsive layout stylesheet is missing from " + pagePath + ".");
  }
}

const navigationScript = builtCatalogHtml.match(/<script\s+data-jb-manager-android-shell>([\s\S]*?)<\/script>/i);
if (!navigationScript) throw new Error("Android catalog navigation script was not generated.");
new Function(navigationScript[1]);

const builtNativeBackBundle = await readFile(nativeBackBundlePath, "utf8");
new Function(builtNativeBackBundle);
if (!builtNativeBackBundle.includes("backButton")
  || !builtNativeBackBundle.includes("jb-manager-return=dashboard")) {
  throw new Error("Native Android back-button behavior is missing from the local bundle.");
}
for (const [catalogPath, html] of [
  ["tecnologia/index.html", builtCatalogHtml],
  ["perfumeria/index.html", perfumeCatalogHtml]
]) {
  if (!html.includes('src="/jb-manager-back-navigation.js"')) {
    throw new Error(`Native back-button bundle is not loaded by ${catalogPath}.`);
  }
}
if (!builtAdminHtml.includes('src="/jb-manager-back-navigation.js"')) {
  throw new Error("Native back-button bundle is not loaded by the admin dashboard.");
}

const builtUpdaterBridge = await readFile(updaterBundlePath, "utf8");
new Function(builtUpdaterBridge);
if (!builtUpdaterBridge.includes("downloadAndInstall")
  || !builtUpdaterBridge.includes("getDownloadStatus")
  || !builtUpdaterBridge.includes("installDownloadedApk")) {
  throw new Error("The native APK updater bridge is incomplete.");
}

const builtSystemBarsBridge = await readFile(systemBarsBundlePath, "utf8");
new Function(builtSystemBarsBridge);
if (!builtSystemBarsBridge.includes("setStyle")
  || !builtAdminHtml.includes('src="./jb-manager-system-bars.js"')) {
  throw new Error("The Android system-bars bridge is incomplete.");
}
if (!builtAdminHtml.includes('src="./jb-manager-apk-updater.js"')) {
  throw new Error("The admin panel is missing the native APK download bridge.");
}

if (!builtAdminHtml.includes('src="./jb-manager-system-bars.js"')) {
  throw new Error("The admin panel is missing the Android system-bars bridge.");
}
if (!builtAdminHtml.includes('id="jb-manager-android-safe-area"')
  || !builtAdminHtml.includes("--jb-manager-safe-top")
  || builtAdminHtml.includes("padding-top: max(24px")) {
  throw new Error("The Android header must consume the safe-area inset without adding blank padding above the whole panel.");
}
if (!builtAdminHtml.includes("jb-manager-check-updates")) {
  throw new Error("The APK update button is missing from the admin panel.");
}
if (!updaterScript[1].includes("document.documentElement.append(button)")) {
  throw new Error("The update button is not attached to the fixed viewport root.");
}
if (!updaterScript[1].includes('button.innerHTML = \'<svg viewBox="0 0 24 24"')) {
  throw new Error("The Android update button is missing its stable SVG refresh icon.");
}
if (updaterScript[1].includes('button.textContent = "Comprobando…";')) {
  throw new Error("The Android update button must not replace its compact icon with overflowing status text.");
}
if (!updaterScript[1].includes("api.downloadAndInstall")) {
  throw new Error("The update button must use the native Android download flow inside the APK.");
}
if (!updaterScript[1].includes("state.installPrompted")
  || !updaterScript[1].includes('document.getElementById("jb-manager-update-notice")?.remove()')) {
  throw new Error("The Android updater must suppress stale install notices after opening the installer.");
}

if (!builtAdminHtml.includes('class="dashboard-public-link"')
  || !builtAdminHtml.includes('class="admin-sidebar-brand"')) {
  throw new Error("The admin panel must include dashboard and sidebar catalog navigation links.");
}

if (!builtAdminScript.includes('isPerfume ? "./perfumeria/" : "./tecnologia/"')) {
  throw new Error("The admin panel must switch its public catalog link between technology and perfumery.");
}

for (const catalogPath of ["tecnologia/index.html", "perfumeria/index.html"]) {
  const catalogHtml = await readFile(join(webDir, catalogPath), "utf8");
  const shellScript = catalogHtml.match(/<script\s+data-jb-manager-android-shell>([\s\S]*?)<\/script>/i);
  if (!shellScript) throw new Error("Android navigation script is missing from " + catalogPath + ".");
  new Function(shellScript[1]);
  if (!shellScript[1].includes("__jbManagerCatalogBackGuard")
    || !shellScript[1].includes("/index.html?jb-manager-return=dashboard")) {
    throw new Error("Android back gesture must return to the admin dashboard from " + catalogPath + ".");
  }
}

console.log("Prepared local Android web bundle from repository source.");
console.log("Start page: mobile/www/index.html (private admin panel)");
console.log("Icon source: custom PNG layers rendered from favicon-collections.svg");
