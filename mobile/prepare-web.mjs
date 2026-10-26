import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
    '<a href="./" class="admin-sidebar-catalog-link">',
    '<a href="./tecnologia/" class="admin-sidebar-catalog-link">'
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

// Add a persistent update button and check GitHub Releases for a newer APK.
// Android still requires the user to confirm installation of a downloaded APK.
const appVersion = process.env.JB_MANAGER_VERSION || "1.0.0";
const updateChecker = \`
<script data-jb-manager-updater>
(() => {
  const currentVersion = \${JSON.stringify(appVersion)};
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

  function showMessage(title, message, downloadUrl) {
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
      document.body.append(notice);
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
      const download = document.createElement("a");
      download.href = downloadUrl;
      download.textContent = "Descargar e instalar";
      download.rel = "noopener noreferrer";
      Object.assign(download.style, {
        display: "inline-block", padding: "10px 13px", borderRadius: "9px",
        background: "#d9b56c", color: "#161616", fontWeight: "700",
        textDecoration: "none"
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
        position: "fixed", zIndex: "99998", right: "14px",
        bottom: "max(14px, env(safe-area-inset-bottom))",
        padding: "12px 15px", borderRadius: "999px",
        border: "1px solid #d9c18a", background: "#101827",
        color: "#ffffff", boxShadow: "0 6px 22px rgba(0,0,0,.24)",
        font: "600 13px/1.2 system-ui, sans-serif", cursor: "pointer"
      });
      button.addEventListener("click", () => void checkForUpdates(true));
      document.body.append(button);
    }
    void checkForUpdates(false);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkForUpdates(false);
  });
})();
</script>
\`;
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
  '<g transform="translate(-2 16.88) scale(1.75 1.28)">' +
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
      const isCatalogRoute = /\/(tecnologia|perfumeria)(?:\/index\.html)?\/?$/i.test(destination.pathname);
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
      html = html.replace(/<\/head>/i, `${internalLinkHandler}\n</head>`);
      await writeFile(fullPath, html, "utf8");
    }
  }
}

await addExplicitCapacitorBase(webDir);
await injectNavigationSupport(webDir);

console.log("Prepared local Android web bundle from repository source.");
console.log("Start page: mobile/www/index.html (private admin panel)");
console.log("Icon source: custom PNG layers rendered from favicon-collections.svg");
