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

// Capacitor's icon generator accepts the existing artwork in SVG form.
// This is copied at build time so the art stays in sync with the main repository.
await mkdir(assetDir, { recursive: true });
const iconSource = await readFile(join(repoRoot, "favicon-collections.svg"), "utf8");
await writeFile(join(assetDir, "logo.svg"), iconSource, "utf8");

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
console.log("Icon source: mobile/assets/logo.svg (current JB Manager Collections icon)");
