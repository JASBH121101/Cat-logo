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
    + '<script src="./jb-manager-apk-updater.js"></script>\\n'
    + adminHtml.slice(scriptBodyEnd);
}

// Add a persistent update button and check GitHub Releases for a newer APK.
// Android still requires the user to confirm installation of a downloaded APK.
const appVersion = process.env.JB_MANAGER_VERSION || "1.0.0";
const updateChecker = `
<script data-jb-manager-updater>
(() => {
  const currentVersion = ${JSON.stringify(appVersion)};
  const releasesUrl = "https://api.github.com/repos/JASBH121101/Cat-logo/releases?per_page=20";
  let checking = false;

  function versionParts(value) {
    return String(value).split(".").map(part => Number(part) || 0);
  }

  function isNewer(candidate, installed) {
    const a = versionParts(candidate), b = versionParts(installed);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const left = a[i] || 0, right = b[i] || 0;
      if (left !== right) return left > right;
    }
    return false;
  }

  function showMessage(title, message, downloadUrl, downloadVersion) {
    let notice = document.getElementById("jb-manager-update-notice");
    if (!notice) {
      notice = document.createElement("aside");
      notice.id = "jb-manager-update-notice";
      notice.setAttribute("role", "status");
      Object.assign(notice.style, {
        position: "fixed", zIndex: "99999", left: "12px", right: "12px",
        bottom: "max(76px, calc(env(safe-area-inset-bottom) + 76px))",
        maxWidth: "520px", margin: "0 auto", padding: "15px",
        borderRadius: "16px", border: "1px solid #d9c18a",
        background: "#101827", color: "#ffffff",
        boxShadow: "0 12px 38px rgba(0,0,0,.32)",
        font: "14px/1.45 system-ui, sans-serif"
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
      Object.assign(download.style, {
        display: "inline-block", padding: "10px 13px", borderRadius: "9px",
        border: "0", background: "#d9b56c", color: "#161616",
        fontWeight: "700", textDecoration: "none", font: "inherit", cursor: "pointer"
      });
      download.addEventListener("click", async event => {
        event.preventDefault();
        const api = window.JBManagerApkUpdater;
        if (!api || !api.isNative) { window.open(downloadUrl, "_blank", "noopener,noreferrer"); return; }
        activeDownloadUrl = downloadUrl;
        activeDownloadVersion = downloadVersion || "";
        download.disabled = true;
        download.textContent = "Preparando descarga…";
        try {
          const result = await api.downloadAndInstall({ url: downloadUrl, version: activeDownloadVersion });
          if (result && result.permissionRequired) {
            showMessage("Permiso necesario para instalar", "Android abrió Ajustes. Activá «Permitir desde esta fuente» para JB Manager Collections; luego regresá y pulsá Descargar e instalar otra vez.", downloadUrl, activeDownloadVersion);
            return;
          }
          if (result && result.installerLaunched) { showMessage("Instalador de Android abierto", "La descarga ya estaba completa. Confirmá la actualización en la pantalla del sistema."); return; }
          showMessage("Descarga iniciada", "Android está descargando el APK con el administrador nativo. El progreso real se actualizará aquí y, al terminar, se abrirá el instalador.");
          startNativeDownloadMonitor();
        } catch (error) {
          showMessage("No se pudo iniciar la descarga", (error && error.message ? error.message : "Android no pudo iniciar la descarga.") + " Podés volver a intentarlo.", downloadUrl, activeDownloadVersion);
        }
      });
      actions.append(download);
    }
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.textContent = "Cerrar";
    Object.assign(dismiss.style, {
      padding: "10px 13px", borderRadius: "9px", border: "1px solid #647084",
      background: "transparent", color: "#ffffff", font: "inherit"
    });
    dismiss.addEventListener("click", () => notice.remove());
    actions.append(dismiss);
    notice.append(heading, detail, actions);
  }

  let activeDownloadUrl = "";
  let activeDownloadVersion = "";
  let nativeMonitorTimer = null;
  let nativeMonitorBusy = false;
  function formatBytes(value) {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(0) + " KB";
    return (bytes / 1048576).toFixed(2) + " MB";
  }
  function failureReason(state) {
    if (state.error) return state.error;
    const reasons = {1001:"Android no pudo escribir el archivo.",1002:"El servidor respondió con un código HTTP no válido.",1004:"La conexión se interrumpió mientras se recibían los datos.",1005:"El servidor redirigió demasiadas veces.",1006:"No hay espacio suficiente para guardar la actualización.",1007:"Android no encontró el almacenamiento de destino.",1008:"Android no pudo reanudar la descarga.",1009:"Ya existe un archivo con el mismo nombre.",1010:"Android bloqueó la descarga."};
    const reason = Number(state.reason) || 0;
    return reasons[reason] || "Android no pudo completar la descarga (código " + reason + ").";
  }
  function updateDownloadNotice(title, message) {
    const notice = document.getElementById("jb-manager-update-notice");
    if (!notice) { showMessage(title, message); return; }
    const heading = notice.querySelector("strong"), detail = notice.querySelector("p");
    if (heading) heading.textContent = title;
    if (detail) detail.textContent = message;
  }
  async function pollNativeDownload() {
    if (nativeMonitorBusy) return;
    const api = window.JBManagerApkUpdater;
    if (!api || !api.isNative) return;
    nativeMonitorBusy = true;
    try {
      const state = await api.getDownloadStatus();
      if (!state || ["idle","unsupported"].includes(state.status)) {
        if (nativeMonitorTimer) window.clearInterval(nativeMonitorTimer);
        nativeMonitorTimer = null; return;
      }
      if (state.version) {
        activeDownloadVersion = state.version;
        if (!activeDownloadUrl) activeDownloadUrl = "https://github.com/JASBH121101/Cat-logo/releases/download/jb-manager-v" + state.version + "/JB-Manager-Collections.apk";
      }
      if (["pending","running","paused"].includes(state.status)) {
        const total = Number(state.totalBytes) || 0, downloaded = Number(state.bytesDownloaded) || 0;
        const amount = total > 0 ? " · " + formatBytes(downloaded) + " / " + formatBytes(total) : "";
        const percent = total > 0 ? Math.min(100, Math.round(downloaded * 100 / total)) + "%" : "calculando";
        updateDownloadNotice("Descargando actualización · v" + state.version, "Progreso real de Android: " + percent + amount + (state.status === "paused" ? ". Android pausó temporalmente la descarga." : "."));
        return;
      }
      if (state.status === "successful") {
        if (nativeMonitorTimer) window.clearInterval(nativeMonitorTimer);
        nativeMonitorTimer = null;
        if (state.installPrompted) {
          updateDownloadNotice("Descarga completa", "El instalador de Android ya se abrió. Si lo cerraste, pulsá Buscar actualizaciones y luego Descargar e instalar para volver a abrirlo.");
          return;
        }
        try {
          const result = await api.installDownloadedApk();
          if (result && result.permissionRequired) showMessage("Permiso necesario para instalar", "Android abrió Ajustes. Activá «Permitir desde esta fuente» y regresá a la app.", activeDownloadUrl, activeDownloadVersion);
          else showMessage("Descarga completa · v" + state.version, "Android verificó el APK y abrió el instalador. Confirmá la actualización en la pantalla del sistema.");
        } catch (error) {
          showMessage("APK descargado, instalación pendiente", (error && error.message ? error.message : "No se pudo abrir el instalador.") + " El archivo se conserva para reintentar.", activeDownloadUrl, activeDownloadVersion);
        }
        return;
      }
      if (state.status === "failed") {
        if (nativeMonitorTimer) window.clearInterval(nativeMonitorTimer);
        nativeMonitorTimer = null;
        showMessage("Descarga interrumpida", failureReason(state) + " Volvé a pulsar Descargar e instalar para reintentar.", activeDownloadUrl, activeDownloadVersion);
        return;
      }
      if (state.status === "unknown") {
        if (nativeMonitorTimer) window.clearInterval(nativeMonitorTimer);
        nativeMonitorTimer = null;
        showMessage("No se pudo consultar la descarga", "Android no encontró la descarga anterior. Pulsá Descargar e instalar para iniciar una nueva.", activeDownloadUrl, activeDownloadVersion);
      }
    } catch (error) {
      updateDownloadNotice("Comprobando descarga…", "Android sigue gestionando la descarga; se volverá a consultar automáticamente.");
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
      if (state && ["pending","running","paused","successful"].includes(state.status)) {
        activeDownloadVersion = state.version || "";
        activeDownloadUrl = activeDownloadVersion ? "https://github.com/JASBH121101/Cat-logo/releases/download/jb-manager-v" + activeDownloadVersion + "/JB-Manager-Collections.apk" : "";
        if (state.status === "successful" && state.installPrompted) return;
        showMessage(state.status === "successful" ? "Actualización descargada" : "Descarga de actualización en curso", "Se encontró una descarga que necesita terminar o instalarse. Consultando el estado con Android.");
        startNativeDownloadMonitor();
      } else if (state && state.status === "failed") {
        activeDownloadVersion = state.version || "";
        activeDownloadUrl = activeDownloadVersion ? "https://github.com/JASBH121101/Cat-logo/releases/download/jb-manager-v" + activeDownloadVersion + "/JB-Manager-Collections.apk" : "";
      }
    } catch (error) { console.info("No se pudo recuperar el estado de descarga.", error); }
  }

  async function checkForUpdates(interactive = false) {
    if (checking) return;
    checking = true;
    const button = document.getElementById("jb-manager-check-updates");
    if (button) {
      button.disabled = true;
      button.textContent = "Comprobando…";
      button.style.opacity = ".75";
    }
    try {
      const response = await fetch(releasesUrl, {
        headers: { Accept: "application/vnd.github+json" }, cache: "no-store"
      });
      if (!response.ok) throw new Error("GitHub respondió " + response.status);
      const releases = await response.json();
      const release = releases.find(item =>
        !item.draft && /^jb-manager-v\\d+\\.\\d+\\.\\d+$/i.test(item.tag_name || "")
      );
      if (!release) {
        if (interactive) showMessage("No hay versiones publicadas", "Todavía no hay una actualización disponible para JB Manager Collections.");
        return;
      }
      const match = release.tag_name.match(/^jb-manager-v(\\d+\\.\\d+\\.\\d+)$/i);
      const asset = (release.assets || []).find(item => item.name === "JB-Manager-Collections.apk");
      const validUrl = asset && /^https:\\/\\/github\\.com\\/JASBH121101\\/Cat-logo\\/releases\\/download\\//i.test(asset.browser_download_url || "");
      if (!match || !validUrl) throw new Error("La publicación no contiene una APK válida.");
      if (isNewer(match[1], currentVersion)) {
        showMessage(
          "Actualización disponible · v" + match[1],
          "Descargá la nueva APK y abrila. Android te pedirá confirmar la actualización; no hace falta desinstalar la versión actual.",
          asset.browser_download_url
        );
      } else if (interactive) {
        showMessage("JB Manager está actualizado", "Versión instalada: v" + currentVersion + ". No hay una versión más reciente.");
      }
    } catch (error) {
      if (interactive) showMessage("No se pudo comprobar", "Revisá tu conexión a internet e intentá nuevamente. " + (error && error.message ? error.message : ""));
      console.info("No se pudo consultar si hay una actualización disponible.", error);
    } finally {
      checking = false;
      if (button) {
        button.disabled = false;
        button.textContent = "Buscar actualizaciones";
        button.style.opacity = "1";
      }
    }
  }

  function init() {
    if (!document.getElementById("jb-manager-check-updates")) {
      const button = document.createElement("button");
      button.id = "jb-manager-check-updates";
      button.type = "button";
      button.textContent = "Buscar actualizaciones";
      button.setAttribute("aria-label", "Buscar actualizaciones de JB Manager Collections");
      Object.assign(button.style, {
        position: "fixed", zIndex: "2147483000",
        right: "max(14px, env(safe-area-inset-right, 0px))",
        bottom: "max(16px, calc(env(safe-area-inset-bottom, 0px) + 12px))",
        transform: "translateZ(0)", willChange: "transform",
        padding: "12px 15px", borderRadius: "999px",
        border: "1px solid #d9c18a", background: "#101827",
        color: "#ffffff", boxShadow: "0 6px 22px rgba(0,0,0,.24)",
        font: "600 13px/1.2 system-ui, sans-serif", cursor: "pointer"
      });
      button.addEventListener("click", () => void checkForUpdates(true));
      document.documentElement.append(button);
    }
    void checkForUpdates(false);
    void resumeNativeDownloadIfNeeded();
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

// Validate the generated browser-side scripts before Android packages them.
const builtAdminHtml = await readFile(join(webDir, "admin.html"), "utf8");
const updaterScript = builtAdminHtml.match(/<script\s+data-jb-manager-updater>([\s\S]*?)<\/script>/i);
if (!updaterScript) throw new Error("APK update button script was not generated.");
new Function(updaterScript[1]);

const builtCatalogHtml = await readFile(join(webDir, "tecnologia", "index.html"), "utf8");
const perfumeCatalogHtml = await readFile(join(webDir, "perfumeria", "index.html"), "utf8");
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
if (!builtAdminHtml.includes('src="./jb-manager-apk-updater.js"')) {
  throw new Error("The admin panel is missing the native APK download bridge.");
}
if (!builtAdminHtml.includes("jb-manager-check-updates")) {
  throw new Error("The APK update button is missing from the admin panel.");
}
if (!updaterScript[1].includes("document.documentElement.append(button)")) {
  throw new Error("The update button is not attached to the fixed viewport root.");
}
if (!builtAdminHtml.includes('data-admin-catalog-link="technology"')
  || !builtAdminHtml.includes('data-admin-catalog-link="perfumery"')) {
  throw new Error("The admin panel must include independent technology and perfumery catalog links.");
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
