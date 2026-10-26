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
const splashLogo = await sharp(iconOnlyPng).resize(820, 820).png().toBuffer();
const splashPng = await sharp(splashBackgroundPng)
  .composite([{ input: splashLogo, left: 956, top: 956 }])
  .png()
  .toBuffer();
await writeFile(join(assetDir, "splash.png"), splashPng);
await writeFile(join(assetDir, "splash-dark.png"), splashPng);

const internalLinkHandler = `
<script data-jb-manager-android-shell>
(() => {
  document.addEventListener("click", (event) => {
    const anchor = event.target && event.target.closest
      ? event.target.closest('a[target="_blank"]')
      : null;
    if (!anchor) return;
    let destination;
    try {
      destination = new URL(anchor.href, document.baseURI);
    } catch {
      return;
    }
    if (destination.origin === window.location.origin) {
      event.preventDefault();
      window.location.assign(destination.href);
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
