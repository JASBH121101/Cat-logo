import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/* =========================================================
   JB MANAGER · ADMINISTRACIÓN
   Sesión temporal por pestaña + inventario + variantes
   ========================================================= */

const CONFIG = window.CATALOG_CONFIG || {};

const configured = Boolean(
  CONFIG.supabaseUrl &&
  CONFIG.supabaseAnonKey &&
  !String(CONFIG.supabaseUrl).includes("PON_AQUI") &&
  !String(CONFIG.supabaseAnonKey).includes("PON_AQUI")
);

/*
  sessionStorage conserva la sesión durante la vida de la pestaña.
  Al cerrar la pestaña, el almacenamiento de esa sesión desaparece.
*/
/*
  Una recarga confirmada cierra la sesión de administración.
  El formulario se respalda automáticamente en IndexedDB mientras se edita.
*/
const isPageReload = (() => {
  try {
    return performance.getEntriesByType("navigation")[0]?.type === "reload";
  } catch {
    return false;
  }
})();

if (isPageReload) {
  try {
    const projectRef = new URL(CONFIG.supabaseUrl).hostname.split(".")[0];
    const key = `sb-${projectRef}-auth-token`;
    window.sessionStorage.removeItem(key);
    window.localStorage.removeItem(key);
  } catch (error) {
    console.warn("No se pudo limpiar la sesión durante la recarga.", error);
  }
}

const supabase = configured
  ? createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
      auth: {
        storage: window.sessionStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;

const $ = selector => document.querySelector(selector);

/* Mostrar u ocultar la contraseña sin modificar el valor del campo. */
const passwordInput = $("#login-password");
const passwordVisibilityButton = $("#toggle-password-visibility");

passwordVisibilityButton?.addEventListener("click", () => {
  if (!passwordInput) return;
  const reveal = passwordInput.type === "password";
  passwordInput.type = reveal ? "text" : "password";
  passwordVisibilityButton.setAttribute("aria-label", reveal ? "Ocultar contraseña" : "Mostrar contraseña");
  passwordVisibilityButton.setAttribute("title", reveal ? "Ocultar contraseña" : "Mostrar contraseña");
  passwordVisibilityButton.setAttribute("aria-pressed", String(reveal));
  passwordVisibilityButton.innerHTML = reveal
    ? '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.2A10.8 10.8 0 0112 5c6.4 0 10 7 10 7a16 16 0 01-3.1 3.9M6.2 6.2C3.5 8 2 12 2 12s3.6 7 10 7a10 10 0 004-.8"></path></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
});

const loginPanel = $("#login-panel");
const dashboard = $("#dashboard");
const form = $("#product-form");

let currentUser = null;
let products = [];
let activeCatalogType = "technology";
let dashboardCatalogScope = "all";
const activeCatalogSelector = $("#active-catalog-selector");
const dashboardScopeSelector = $("#dashboard-scope-selector");

function normalizeCatalogType(value) {
  return value === "perfumery" ? "perfumery" : "technology";
}

const PRODUCT_WORKFLOW_STATES = new Set(["draft", "unpublished", "published", "trash"]);

function getProductWorkflowStatus(product) {
  const status = String(product?.workflow_status || "").trim().toLowerCase();
  if (PRODUCT_WORKFLOW_STATES.has(status)) return status;
  if (product?.deleted_at) return "trash";
  return product?.is_published ? "published" : "unpublished";
}

function workflowStatusLabel(status) {
  return ({
    draft: "Borrador",
    unpublished: "No publicado",
    published: "Publicado",
    trash: "En papelera"
  })[status] || "No publicado";
}

function setWorkflowButtonState(button, label, disabled = false) {
  if (!button) return;
  button.setAttribute("aria-label", label);
  button.setAttribute("title", label);
  button.disabled = disabled;
}

function setWorkflowActionsBusy(busy, activeButton = null) {
  document.querySelectorAll("#product-form [data-save-action], #cancel-edit-button").forEach(button => {
    button.disabled = Boolean(busy);
    if (button === activeButton && busy) {
      button.setAttribute("aria-busy", "true");
      button.title = "Guardando producto…";
    } else {
      button.removeAttribute("aria-busy");
    }
  });
}

function getActiveCatalogProducts() {
  return products.filter(product => normalizeCatalogType(product.catalog_type) === activeCatalogType);
}

function getDashboardProducts() {
  if (dashboardCatalogScope === "all") return products;
  return products.filter(product => normalizeCatalogType(product.catalog_type) === dashboardCatalogScope);
}

function updateDashboardScopeLabels() {
  const isAll = dashboardCatalogScope === "all";
  const isPerfume = dashboardCatalogScope === "perfumery";
  const title = document.getElementById("dashboard-catalog-title");
  const source = document.getElementById("dashboard-scope-source");
  if (title) title.textContent = isAll
    ? "Resumen general · Ambos catálogos"
    : isPerfume ? "Resumen de JB Parfums" : "Resumen de JB TECH";
  if (source) source.textContent = isAll ? "Datos de ambos catálogos" : isPerfume ? "Datos de perfumería" : "Datos de tecnología";

  const labels = {
    "dashboard-total-label": isAll ? "Artículos totales" : isPerfume ? "Fragancias totales" : "Productos totales",
    "dashboard-published-label": isAll ? "Publicados" : isPerfume ? "Fragancias publicadas" : "Productos publicados",
    "dashboard-drafts-label": isAll ? "Borradores" : isPerfume ? "Borradores de fragancias" : "Borradores",
    "dashboard-unpublished-label": isAll ? "No publicados" : isPerfume ? "Fragancias no publicadas" : "Productos no publicados",
    "dashboard-trash-label": isAll ? "Papelera" : isPerfume ? "Fragancias en papelera" : "Productos en papelera",
    "dashboard-review-label": isAll ? "Sin foto principal" : isPerfume ? "Fragancias sin fotografía" : "Por revisar"
  };
  for (const [id, label] of Object.entries(labels)) {
    const node = document.getElementById(id);
    if (node) node.textContent = label;
  }
}

dashboardScopeSelector?.addEventListener("change", () => {
  const value = dashboardScopeSelector.value;
  dashboardCatalogScope = value === "technology" || value === "perfumery" ? value : "all";
  updateDashboardScopeLabels();
  renderDashboardOverview();
  void loadCatalogAnalytics();
});
updateDashboardScopeLabels();

function perfumeFamilyLabel(value) {
  return ({
    arabes: "Árabes",
    nicho: "Nicho",
    disenador: "Diseñador"
  })[String(value || "").trim().toLowerCase()] || "Familia sin especificar";
}

function splitPerfumeNotes(value) {
  return String(value || "")
    .split(/[,;\n]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function updateProductFormMode() {
  const isPerfume = activeCatalogType === "perfumery";
  const category = $("#product-category");
  if (category) {
    const previous = category.value;
    const options = isPerfume
      ? [{ value: "Perfumería", label: "Perfumería" }]
      : [
          { value: "", label: "Seleccionar categoría…", disabled: true },
          { value: "Celulares", label: "Celulares" },
          { value: "Laptops", label: "Laptops" },
          { value: "Tablets", label: "Tablets" },
          { value: "Gaming", label: "Gaming" },
          { value: "Televisores", label: "Televisores" },
          { value: "Audio", label: "Audio" },
          { value: "Accesorios", label: "Accesorios" },
          { value: "Otros", label: "Otros" }
        ];
    category.replaceChildren(...options.map(option => {
      const node = document.createElement("option");
      node.value = option.value;
      node.textContent = option.label;
      if (option.disabled) node.disabled = true;
      return node;
    }));
    category.value = options.some(option => option.value === previous)
      ? previous
      : isPerfume ? "Perfumería" : "";
  }

  if ($("#product-perfume-family")) $("#product-perfume-family").required = isPerfume;
  $("#product-perfume-fields")?.classList.toggle("hidden", !isPerfume);
  $("#product-model-field")?.classList.toggle("hidden", isPerfume);
  $("#product-warranty-field")?.classList.toggle("hidden", isPerfume);
  $("#product-specs-field")?.classList.toggle("hidden", isPerfume);
  $("#product-price-usd-field")?.classList.toggle("hidden", !isPerfume);
  $("#product-price-nio-field")?.classList.toggle("hidden", !isPerfume);
  $("#base-color-manager")?.classList.toggle("hidden", isPerfume);
  $("#technology-variants-section")?.classList.toggle("hidden", isPerfume);
  $("#product-financing-field")?.classList.toggle("hidden", isPerfume);
  $("#technology-import-card")?.classList.toggle("hidden", isPerfume);

  const galleryTitle = $("#product-images-title");
  if (galleryTitle) galleryTitle.textContent = isPerfume
    ? "Fotografías generales de la fragancia"
    : "Fotografías generales del producto";
  const galleryDescription = $("#product-images-title")?.parentElement?.querySelector("p");
  if (galleryDescription) galleryDescription.textContent = isPerfume
    ? "La primera fotografía será la portada. Añadí imágenes de la botella, la caja y los detalles de la fragancia."
    : "La primera fotografía será la portada predeterminada. Cada color o variante puede mantener su propia galería.";

  const editing = Boolean($("#product-id")?.value);
  const formTitle = $("#form-title");
  if (formTitle && !editing) formTitle.textContent = isPerfume ? "Registrar fragancia" : "Agregar producto";
  if (!editing) {
    setWorkflowButtonState($("#save-draft-button"), "Guardar borrador");
    setWorkflowButtonState($("#save-product-button"), "Guardar producto completo sin publicar");
    setWorkflowButtonState($("#publish-product-button"), "Guardar y publicar");
    setWorkflowButtonState($("#publish-exclusive-button"), "Guardar y publicar como exclusivo");
  }

  const contextDescription = $("#admin-context-description");
  if (contextDescription) contextDescription.textContent = isPerfume
    ? "Gestioná fragancias, familias olfativas, presentaciones y precios."
    : "Gestioná equipos, configuraciones técnicas, colores, galerías y precios.";
  const contextHint = $("#admin-context-hint");
  if (contextHint) contextHint.textContent = isPerfume
    ? "Listas y formularios de JB Parfums. La vista del dashboard se elige por separado."
    : "Listas y formularios de JB TECH. La vista del dashboard se elige por separado.";
  updateDashboardScopeLabels();
  const dynamicLabels = {
    "admin-nav-add-label": isPerfume ? "Añadir fragancia" : "Añadir producto",
    "admin-nav-published-label": isPerfume ? "Fragancias publicadas" : "Productos publicados",
    "admin-nav-unpublished-label": isPerfume ? "Fragancias no publicadas" : "Productos no publicados",
    "admin-nav-drafts-label": isPerfume ? "Borradores de fragancias" : "Borradores",
    "admin-nav-trash-label": isPerfume ? "Fragancias en papelera" : "Papelera",
    "published-section-title": isPerfume ? "Fragancias publicadas" : "Productos publicados",
    "unpublished-section-title": isPerfume ? "Fragancias no publicadas" : "Productos no publicados",
    "draft-section-title": isPerfume ? "Borradores de fragancias" : "Borradores",
    "trash-section-title": isPerfume ? "Fragancias en papelera" : "Papelera"
  };
  for (const [id, label] of Object.entries(dynamicLabels)) {
    const node = document.getElementById(id);
    if (node) node.textContent = label;
  }
  const dashboardAddDescription = $("#dashboard-add-product-description");
  if (dashboardAddDescription) dashboardAddDescription.textContent = isPerfume ? "Registrar una fragancia nueva" : "Registrar un equipo nuevo";
  const dashboardQuickAdd = document.querySelector('[data-dashboard-action="add"] .quick-action-icon');
  if (dashboardQuickAdd) dashboardQuickAdd.textContent = isPerfume ? "✦" : "＋";

  const publicLink = document.querySelector(".dashboard-public-link");
  if (publicLink) publicLink.href = isPerfume ? "./perfumeria/" : "./tecnologia/";
  const sidebarCatalogLink = document.querySelector(".admin-sidebar-catalog-link");
  if (sidebarCatalogLink) sidebarCatalogLink.href = isPerfume ? "./perfumeria/" : "./tecnologia/";
}

function setActiveCatalogType(value) {
  activeCatalogType = normalizeCatalogType(value);
  if (activeCatalogSelector) activeCatalogSelector.value = activeCatalogType;
  updateProductFormMode();
  renderAdminList();
  renderDashboardOverview();
  void loadCatalogAnalytics();
}

const COLOR_PALETTE = [
  { name: "Negro", hex: "#242424", aliases: ["Black"] },
  { name: "Blanco", hex: "#F4F4F4", aliases: ["White"] },
  { name: "Plata", hex: "#C5C9D0", aliases: ["Plateado"] },
  { name: "Gris", hex: "#777E8B", aliases: ["Gray", "Grey"] },
  { name: "Grafito", hex: "#454952", aliases: ["Graphite"] },
  { name: "Azul", hex: "#315A91", aliases: ["Blue"] },
  { name: "Azul claro", hex: "#78A9E8", aliases: ["Light blue"] },
  { name: "Verde", hex: "#39785A", aliases: ["Green"] },
  { name: "Verde menta", hex: "#8ECDB8", aliases: ["Mint green"] },
  { name: "Dorado", hex: "#C8A45D", aliases: ["Gold"] },
  { name: "Champán", hex: "#D8C3A0", aliases: ["Champagne"] },
  { name: "Morado", hex: "#7952A8", aliases: ["Purple"] },
  { name: "Rosa", hex: "#D986A7", aliases: ["Pink"] },
  { name: "Rojo", hex: "#C13A4B", aliases: ["Red"] },
  { name: "Naranja", hex: "#DE783E", aliases: ["Orange"] },
  { name: "Amarillo", hex: "#E8C94B", aliases: ["Yellow"] },
  { name: "Burgundy", hex: "#800020", aliases: ["Burdeos", "Vino", "Granate"] },
  { name: "Glacier", hex: "#E8F2FF", aliases: ["Glaciar", "Hielo"] },
  { name: "Silver", hex: "#C7CCD4", aliases: ["Plateado claro"] },
  { name: "Titanio natural", hex: "#B8B6AE", aliases: ["Natural Titanium"] },
  { name: "Titanio desierto", hex: "#B7A38A", aliases: ["Desert Titanium"] },
  { name: "Titanio negro", hex: "#34363A", aliases: ["Black Titanium"] },
  { name: "Titanio blanco", hex: "#ECEBE6", aliases: ["White Titanium"] },
  { name: "Azul sierra", hex: "#9FB7CC", aliases: ["Sierra Blue"] },
  { name: "Verde alpino", hex: "#556A59", aliases: ["Alpine Green"] },
  { name: "Morado profundo", hex: "#5B4B72", aliases: ["Deep Purple"] },
  { name: "Naranja cósmico", hex: "#D36A3B", aliases: ["Cosmic Orange"] }
];

/* =========================================================
   UTILIDADES GENERALES
   ========================================================= */

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function message(selector, text, type = "") {
  const node = typeof selector === "string"
    ? $(selector)
    : selector;

  if (!node) return;

  node.textContent = text;
  node.className = `form-status${type ? ` ${type}` : ""}`;
}

function setStatus(text, type = "") {
  const node = $("#admin-status");
  if (!node) return;

  node.textContent = text;

  node.style.color =
    type === "error" ? "#b42318" :
    type === "success" ? "#087f5b" :
    "";
}

function slugify(value) {
  return String(value || "producto")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90) || "producto";
}

function parseJSON(value, fallback) {
  if (typeof value !== "string") {
    return value ?? fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function validHex(value, fallback = "#315A91") {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || ""))
    ? value
    : fallback;
}
/* Biblioteca de colores local: compartida entre productos en este navegador. */
const COLOR_LIBRARY_STORAGE_KEY = "cat-logo-color-library-v1";
function normalizeColorSearch(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("es");
}
function colorIdentity(color) {
  return normalizeColorSearch(color?.name) + "|" + validHex(color?.hex, "").toUpperCase();
}
function readColorLibraryData() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(COLOR_LIBRARY_STORAGE_KEY) || "{}");
    const clean = item => {
      if (!item || typeof item !== "object") return null;
      const name = String(item.name || "").trim();
      const hex = validHex(item.hex, "");
      if (!name || !hex) return null;
      return { name, hex: hex.toUpperCase(), aliases: Array.isArray(item.aliases) ? [...new Set(item.aliases.map(alias => String(alias || "").trim()).filter(Boolean))] : [], favorite: item.favorite === true, updatedAt: Number(item.updatedAt) || 0 };
    };
    return { items: Array.isArray(raw.items) ? raw.items.map(clean).filter(Boolean) : [], recent: Array.isArray(raw.recent) ? raw.recent.map(clean).filter(Boolean).slice(0, 10) : [] };
  } catch (error) {
    console.warn("No se pudo leer la biblioteca local de colores.", error);
    return { items: [], recent: [] };
  }
}
function writeColorLibraryData(data) {
  try {
    window.localStorage.setItem(COLOR_LIBRARY_STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (error) {
    console.warn("No se pudo guardar la biblioteca local de colores.", error);
    return false;
  }
}
function ensureColorInPalette(color) {
  const name = String(color?.name || "").trim(), hex = validHex(color?.hex, "");
  if (!name || !hex) return null;
  const aliases = Array.isArray(color.aliases) ? color.aliases : [];
  const identity = colorIdentity({ name, hex });
  const existing = COLOR_PALETTE.find(item => colorIdentity(item) === identity);
  if (existing) {
    existing.aliases = [...new Set([...(existing.aliases || []), ...aliases.map(String).map(v => v.trim()).filter(Boolean)])];
    return existing;
  }
  const entry = { name, hex: hex.toUpperCase(), aliases: [...new Set(aliases.map(String).map(v => v.trim()).filter(Boolean))] };
  COLOR_PALETTE.push(entry);
  return entry;
}
function hydrateColorLibraryPalette() {
  const data = readColorLibraryData();
  data.items.forEach(ensureColorInPalette);
  data.recent.forEach(ensureColorInPalette);
}
function findColorInPalette(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const hexMatch = raw.match(/#[0-9a-f]{6}/i);
  if (hexMatch) {
    const byHex = COLOR_PALETTE.find(item => item.hex.toLowerCase() === hexMatch[0].toLowerCase());
    if (byHex) return byHex;
  }
  const query = normalizeColorSearch(raw);
  return COLOR_PALETTE.find(item => normalizeColorSearch(item.name) === query || (item.aliases || []).some(alias => normalizeColorSearch(alias) === query)) || null;
}
function isColorSaved(color) {
  const identity = colorIdentity({ name: color?.name, hex: color?.hex });
  return readColorLibraryData().items.some(item => colorIdentity(item) === identity);
}
function isColorFavorite(color) {
  const identity = colorIdentity({ name: color?.name, hex: color?.hex });
  return readColorLibraryData().items.some(item => colorIdentity(item) === identity && item.favorite);
}
function saveColorToLibrary(color) {
  const name = String(color?.name || "").trim(), hex = validHex(color?.hex, "");
  if (!name || !hex) return { ok: false, message: "Ingresá un nombre y un código HEX válido antes de guardar." };
  const data = readColorLibraryData(), identity = colorIdentity({ name, hex });
  const existing = data.items.find(item => colorIdentity(item) === identity);
  const sameName = data.items.find(item => normalizeColorSearch(item.name) === normalizeColorSearch(name) && item.hex !== hex.toUpperCase());
  if (sameName) return { ok: false, message: "Ya existe ese nombre con otro HEX. Usá un nombre más específico para distinguir los tonos." };
  if (!existing) data.items.unshift({ name, hex: hex.toUpperCase(), aliases: [], favorite: false, updatedAt: Date.now() });
  else existing.updatedAt = Date.now();
  if (!writeColorLibraryData(data)) return { ok: false, message: "El navegador no permitió guardar la biblioteca local." };
  ensureColorInPalette({ name, hex });
  return { ok: true, message: name + " quedó guardado en la biblioteca de este navegador." };
}
function toggleColorFavorite(color) {
  const name = String(color?.name || "").trim(), hex = validHex(color?.hex, "");
  if (!name || !hex) return { ok: false, message: "Ingresá un nombre y un código HEX válido." };
  const data = readColorLibraryData(), identity = colorIdentity({ name, hex });
  let item = data.items.find(entry => colorIdentity(entry) === identity);
  if (!item) {
    item = { name, hex: hex.toUpperCase(), aliases: [], favorite: true, updatedAt: Date.now() };
    data.items.unshift(item);
  } else {
    item.favorite = !item.favorite;
    item.updatedAt = Date.now();
  }
  if (!writeColorLibraryData(data)) return { ok: false, message: "No se pudo actualizar el favorito en este navegador." };
  ensureColorInPalette(item);
  return { ok: true, favorite: item.favorite, message: item.name + (item.favorite ? " agregado a favoritos." : " quitado de favoritos.") };
}
function recordRecentColor(color) {
  const name = String(color?.name || "").trim(), hex = validHex(color?.hex, "");
  if (!name || !hex) return;
  const entry = { name, hex: hex.toUpperCase(), aliases: Array.isArray(color.aliases) ? color.aliases : [], favorite: false, updatedAt: Date.now() };
  const data = readColorLibraryData(), identity = colorIdentity(entry);
  data.recent = [entry, ...data.recent.filter(item => colorIdentity(item) !== identity)].slice(0, 10);
  if (writeColorLibraryData(data)) ensureColorInPalette(entry);
}
function renderColorLibraryDatalist() {
  const datalist = $("#catalog-color-library-options");
  if (!datalist) return;
  const options = [], seen = new Set();
  COLOR_PALETTE.forEach(color => [color.name, ...(color.aliases || [])].forEach(value => {
    const name = String(value || "").trim(), key = normalizeColorSearch(name) + "|" + color.hex.toUpperCase();
    if (!name || seen.has(key)) return;
    seen.add(key);
    options.push('<option value="' + escapeHtml(name) + '" label="' + escapeHtml(color.name + " · " + color.hex) + '"></option>');
  }));
  datalist.innerHTML = options.join("");
}
function syncColorLibraryRowControls(row) {
  if (!row) return;
  const color = { name: row.querySelector("[data-variant-color]")?.value.trim() || "", hex: validHex(row.querySelector("[data-variant-hex]")?.value, "") };
  const save = row.querySelector("[data-save-color-library]");
  if (save) {
    const saved = isColorSaved(color);
    save.textContent = saved ? "✓ Biblioteca" : "＋ Biblioteca";
    save.setAttribute("aria-pressed", String(saved));
    save.title = saved ? "Color guardado en la biblioteca local" : "Guardar este color";
  }
  const favorite = row.querySelector("[data-toggle-color-favorite]");
  if (favorite) {
    const marked = isColorFavorite(color);
    favorite.textContent = marked ? "★ Favorito" : "☆ Favorito";
    favorite.setAttribute("aria-pressed", String(marked));
    favorite.title = marked ? "Quitar de favoritos" : "Marcar como favorito";
    favorite.classList.toggle("is-favorite", marked);
  }
}
function applyColorToRow(row, color, options = {}) {
  if (!row || !color) return;
  const nameInput = row.querySelector("[data-variant-color]"), hexInput = row.querySelector("[data-variant-hex]"), hexText = row.querySelector("[data-variant-hex-text]"), palette = row.querySelector("[data-variant-palette]");
  const hex = validHex(color.hex, "#315A91").toUpperCase();
  if (nameInput) nameInput.value = String(color.name || hex).trim();
  if (hexInput) hexInput.value = hex;
  if (hexText) hexText.value = hex;
  if (palette) palette.value = COLOR_PALETTE.some(item => item.hex.toLowerCase() === hex.toLowerCase()) ? hex : "custom";
  row.querySelectorAll("[data-variant-swatch]").forEach(button => {
    const selected = button.dataset.variantSwatch?.toLowerCase() === hex.toLowerCase();
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  if (options.remember !== false) recordRecentColor({ name: String(color.name || hex).trim(), hex });
  updateVariantRowHeadings();
  syncColorLibraryRowControls(row);
  updateEditorDirtyState();
}
hydrateColorLibraryPalette();


function toOptionalNumber(value, label) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }

  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    throw new Error(
      `${label} debe ser un número igual o mayor que cero.`
    );
  }

  return number;
}

/*
  Valores válidos para public.products.availability:
  available, on_order, out_of_stock.
*/
function normalizeProductAvailability(value) {
  const normalized = String(value || "")
    .trim()
    .toLocaleLowerCase("es");

  if (
    ["out_of_stock", "agotado temporalmente", "agotado"]
      .includes(normalized)
  ) {
    return "out_of_stock";
  }

  if (["on_order", "por pedido"].includes(normalized)) {
    return "on_order";
  }

  return "available";
}

function normalizeVariantAvailability(value) {
 const v=String(value||"").trim().toLocaleLowerCase("es");
 if(["order","on_order","por pedido"].includes(v))return "order";
 if(["out_of_stock","unavailable","no disponible","agotado"].includes(v))return "out_of_stock";
 return "available";
}

/* =========================================================
   SESIÓN: ALMACENAMIENTO TEMPORAL POR PESTAÑA
   ========================================================= */

/*
  Supabase utiliza por defecto una clave parecida a:
  sb-<project-ref>-auth-token

  Eliminamos una posible sesión antigua almacenada en localStorage
  por una versión anterior del panel.
*/

function authStorageKey() {
  try {
    const projectRef = new URL(CONFIG.supabaseUrl)
      .hostname
      .split(".")[0];

    return `sb-${projectRef}-auth-token`;
  } catch {
    return null;
  }
}

function clearLegacyPersistentAuth() {
  try {
    const key = authStorageKey();

    if (key) {
      window.localStorage.removeItem(key);
    }
  } catch (error) {
    console.warn(
      "No se pudo limpiar una sesión persistente anterior.",
      error
    );
  }
}

/* No ejecuta nada si Supabase no está configurado. */
clearLegacyPersistentAuth();

function clearLocalAuthStorage() {
  try {
    const key = authStorageKey();

    if (key) {
      window.sessionStorage.removeItem(key);
      window.localStorage.removeItem(key);
    }
  } catch (error) {
    console.warn(
      "No se pudo limpiar el almacenamiento local de sesión.",
      error
    );
  }
}

async function signOutLocalSafely() {
  try {
    if (supabase) {
      const { error } = await supabase.auth.signOut({
        scope: "local"
      });

      if (error) {
        console.warn(
          "Supabase no confirmó el cierre de sesión local.",
          error.message
        );
      }
    }
  } catch (error) {
    console.warn(
      "No se pudo completar el cierre de sesión.",
      error
    );
  } finally {
    clearLocalAuthStorage();
  }
}

function clearLoginPassword() {
  const password = $("#login-password");

  if (password) {
    password.value = "";
    password.setCustomValidity("");
  }
}

function showLoginScreen(statusText = "", type = "") {
  currentUser = null;
  products = [];

  document.body.classList.remove("admin-dashboard-active");
  setMobileSidebarOpen(false);
  dashboard.classList.add("hidden");
  loginPanel.classList.remove("hidden");

  if (form) {
    form.reset();
  }

  clearEditor();

  $("#login-email").value = "";
  clearLoginPassword();

  setStatus("");
  message("#login-status", statusText, type);
}

/* =========================================================
   ESPECIFICACIONES E IMÁGENES
   ========================================================= */

function parseSpecs(text) {
  const result = {};

  String(text || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .forEach(line => {
      const colon = line.indexOf(":");

      if (colon > 0) {
        result[line.slice(0, colon).trim()] =
          line.slice(colon + 1).trim();
      } else {
        result[`Dato ${Object.keys(result).length + 1}`] = line;
      }
    });

  return result;
}

function specsText(specs) {
  specs = parseJSON(specs, {});

  if (Array.isArray(specs)) {
    return specs.map(item => {
      if (typeof item === "string") {
        return item;
      }

      if (item && typeof item === "object") {
        return `${item.label || item.name || "Dato"}: ${item.value || ""}`;
      }

      return String(item ?? "");
    }).join("\n");
  }

  if (specs && typeof specs === "object") {
    return Object.entries(specs)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");
  }

  return "";
}

function getImages(product) {
  const images = parseJSON(product?.images, []);
  const list = Array.isArray(images) ? images : [];

  return [...list, product?.image_url]
    .filter(value =>
      typeof value === "string" && value.trim()
    );
}

/* =========================================================
   COLORES Y VARIANTES
   ========================================================= */

function normalizeColors(value) {
  const colors = parseJSON(value, []);

  if (!Array.isArray(colors)) {
    return [];
  }

  return colors.map(item => {
    if (typeof item === "string") {
      return {
        name: item.trim(),
        type: "available",
        image_url: "",
        color_hex: "#315A91"
      };
    }

    if (!item || typeof item !== "object") {
      return null;
    }

    return {
      name: String(item.name || item.color || "").trim(),
      type: normalizeVariantAvailability(item.type),
      image_url: String(
        item.image_url || item.imageUrl || ""
      ).trim(),
      color_hex: validHex(item.color_hex || item.hex)
    };
  }).filter(item => item && item.name);
}

function normalizeVariants(value) {
  const variants = parseJSON(value, []);

  if (!Array.isArray(variants)) {
    return [];
  }

  return variants.map(item => {
    if (!item || typeof item !== "object") {
      return null;
    }

    const usd =
      item.price_usd === "" ||
      item.price_usd === undefined ||
      item.price_usd === null
        ? null
        : Number(item.price_usd);

    const nio =
      item.price_nio === "" ||
      item.price_nio === undefined ||
      item.price_nio === null
        ? null
        : Number(item.price_nio);

    return {
      storage: String(
        item.storage || item.capacity || ""
      ).trim(),

      ram: String(item.ram || "").trim(),

      color: String(
        item.color || item.name || ""
      ).trim(),

      color_hex: validHex(item.color_hex || item.hex),

      price_usd: Number.isFinite(usd) ? usd : null,
      price_nio: Number.isFinite(nio) ? nio : null,

      availability: normalizeVariantAvailability(
        item.availability
      ),

      images: Array.isArray(item.images) ? item.images.filter(url => typeof url === "string" && url.trim()) : [String(item.image_url || item.imageUrl || "").trim()].filter(Boolean),
      image_url: String((Array.isArray(item.images) && item.images[0]) || item.image_url || item.imageUrl || "").trim()
    };
  }).filter(item =>
    item &&
    (item.storage || item.ram || item.color)
  );
}

/*
  Compatibilidad: si un producto antiguo tiene colores, pero no
  tiene variantes, los mostramos en el editor para no perderlos.
*/
function legacyVariants(product) {
  const variants = normalizeVariants(product?.variants);

  if (variants.length) {
    return variants;
  }

  return normalizeColors(product?.colors).map(color => ({
    storage: "",
    ram: "",
    color: color.name,
    color_hex: color.color_hex,
    price_usd: product?.price_usd ?? null,
    price_nio: product?.price_nio ?? null,
    availability: color.type,
    image_url: color.image_url,
    images: color.image_url ? [color.image_url] : []
  }));
}

function colorPaletteOptions(variant) {
  const query = normalizeColorSearch(variant.color);
  const selectedHex = validHex(variant.color_hex).toLowerCase();
  const match = COLOR_PALETTE.find(item =>
    (normalizeColorSearch(item.name) === query ||
      (item.aliases || []).some(alias => normalizeColorSearch(alias) === query)) &&
    item.hex.toLowerCase() === selectedHex
  );

  const selectedValue = !variant.color
    ? ""
    : match
      ? match.hex
      : "custom";

  return `
    <option value="" ${selectedValue === "" ? "selected" : ""}>
      Seleccioná un color de la paleta…
    </option>

    ${COLOR_PALETTE.map(item => `
      <option
        value="${item.hex}"
        ${selectedValue === item.hex ? "selected" : ""}
      >${escapeHtml(item.name)}</option>
    `).join("")}

    <option
      value="custom"
      ${selectedValue === "custom" ? "selected" : ""}
    >Color personalizado</option>
  `;
}

function variantRowMarkup(variant = {}) {
  const images = Array.isArray(variant.images)
    ? variant.images.filter(Boolean)
    : [variant.image_url || variant.imageUrl || ""].filter(Boolean);
  const v = {
    color: String(variant.color || "").trim(),
    color_hex: validHex(variant.color_hex || variant.hex),
    images,
    image_url: images[0] || String(variant.image_url || variant.imageUrl || "").trim(),
    availability: normalizeVariantAvailability(variant.availability)
  };
  const librarySaved = isColorSaved({ name: v.color, hex: v.color_hex });
  const libraryFavorite = isColorFavorite({ name: v.color, hex: v.color_hex });

  return `
    <article class="variant-admin-row inline-color-card" data-variant-row>
      <div class="inline-color-main">
        <span class="inline-color-dot" data-variant-color-dot style="--inline-color:${v.color_hex}" aria-hidden="true"></span>
        <label class="inline-color-name-field">
          <span>Nombre del color</span>
          <input data-variant-color maxlength="60" required value="${escapeHtml(v.color)}" aria-label="Nombre del color" placeholder="Ej. Gris titanio">
        </label>
        <label class="inline-color-tone-field" title="Personalizar el tono">
          <span>Tono</span>
          <input data-variant-hex type="color" value="${v.color_hex}" aria-label="Personalizar el tono del color">
        </label>
        <button class="admin-mini-button danger inline-color-remove" type="button" data-remove-variant aria-label="Quitar color" title="Quitar color">×</button>
      </div>
      <details class="inline-color-details">
        <summary>Disponibilidad y fotografías</summary>
        <div class="variant-fields-grid variant-color-fields">
          <div class="variant-color-library-tools">
            <label>Buscar en biblioteca
              <input data-variant-library-search list="catalog-color-library-options" type="search" autocomplete="off" placeholder="Burgundy, Vino o #800020" aria-label="Buscar color guardado">
            </label>
            <div class="variant-color-library-actions">
              <button class="admin-mini-button" type="button" data-save-color-library aria-pressed="${String(librarySaved)}">${librarySaved ? "✓ Biblioteca" : "＋ Biblioteca"}</button>
              <button class="admin-mini-button" type="button" data-toggle-color-favorite aria-pressed="${String(libraryFavorite)}">${libraryFavorite ? "★ Favorito" : "☆ Favorito"}</button>
            </div>
          </div>
          <label>Código HEX del color<input data-variant-hex-text type="text" inputmode="text" maxlength="7" pattern="#[0-9a-fA-F]{6}" value="${v.color_hex}" placeholder="#0833A2" aria-label="Código HEX del color"></label>
          <label>Paleta de colores<select data-variant-palette>${colorPaletteOptions(v)}</select></label>
          <div class="variant-swatch-palette" role="group" aria-label="Muestras de colores">${COLOR_PALETTE.map(item => `<button type="button" class="variant-swatch ${item.hex.toLowerCase() === v.color_hex.toLowerCase() ? "is-selected" : ""}" data-variant-swatch="${item.hex}" data-variant-swatch-name="${escapeHtml(item.name)}" title="${escapeHtml(item.name)} · ${item.hex}" aria-label="${escapeHtml(item.name)} ${item.hex}" aria-pressed="${String(item.hex.toLowerCase() === v.color_hex.toLowerCase())}" style="--swatch-color:${item.hex}"></button>`).join("")}</div>
          <label>Disponibilidad de este color<select data-variant-availability>
            <option value="available" ${v.availability === "available" ? "selected" : ""}>Disponible</option>
            <option value="order" ${v.availability === "order" ? "selected" : ""}>Por pedido</option>
            <option value="out_of_stock" ${v.availability === "out_of_stock" ? "selected" : ""}>No disponible</option>
          </select></label>
          <label class="variant-image-label">Fotografías del color
            <input data-variant-image data-variant-image-input class="admin-file-input" type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple>
            <span class="admin-file-picker admin-file-picker-compact"><span class="admin-file-picker-icon" aria-hidden="true">＋</span><span>Añadir fotografías</span></span>
            <div class="variant-image-preview" data-variant-image-preview></div>
          </label>
        </div>
        <input data-variant-images type="hidden" value="${escapeHtml(JSON.stringify(v.images))}">
        <input data-variant-image-url type="hidden" value="${escapeHtml(v.image_url)}">
        <p class="color-row-status" data-variant-status role="status"></p>
      </details>
    </article>`;
}

function variantGroupKey(variant) {
  const storage = String(variant.storage || "").trim().toLocaleLowerCase("es");
  const ram = String(variant.ram || "").trim().toLocaleLowerCase("es");
  return `${storage}|${ram}`;
}

/* Masonry layout: an open color gallery no longer stretches neighboring cards. */
let variantColorLayoutFrame = 0;
function scheduleVariantColorLayout() {
  if (variantColorLayoutFrame) return;
  variantColorLayoutFrame = window.requestAnimationFrame(() => {
    variantColorLayoutFrame = 0;
    document.querySelectorAll("[data-variant-color-list]").forEach(list => {
      const rowGap = parseFloat(getComputedStyle(list).rowGap) || 12;
      const autoRow = 4;
      const cards = Array.from(list.querySelectorAll("[data-variant-row]"));
      /* Measure without the previous span so a collapsed card can shrink again. */
      cards.forEach(card => { card.style.gridRowEnd = "auto"; });
      const measured = cards.map(card => Math.max(1, card.scrollHeight + 2));
      cards.forEach((card, index) => {
        const span = Math.max(1, Math.ceil((measured[index] + rowGap) / (autoRow + rowGap)));
        card.style.gridRowEnd = "span " + span;
      });
    });
  });
}
form?.addEventListener("toggle", event => {
  if (event.target.matches?.(".inline-color-details")) scheduleVariantColorLayout();
}, true);
window.addEventListener("resize", scheduleVariantColorLayout);
if (form && "MutationObserver" in window) {
  const variantColorLayoutObserver = new MutationObserver(records => {
    if (records.some(record => record.target.closest?.("[data-variant-color-list]"))) {
      scheduleVariantColorLayout();
    }
  });
  variantColorLayoutObserver.observe(form, { childList: true, subtree: true });
}
if (document.fonts?.ready) document.fonts.ready.then(scheduleVariantColorLayout).catch(() => {});


function parseStorageValue(value) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^([0-9]+(?:[.,][0-9]+)?)\s*(TB|GB)?$/i);
  return {
    amount: match ? match[1].replace(",", ".") : raw.replace(/\s*(?:TB|GB)\s*/i, ""),
    unit: match?.[2]?.toUpperCase() === "TB" ? "TB" : "GB"
  };
}

function formatStorageLabel(amount, unit = "GB") {
  const value = String(amount ?? "").trim();
  const normalizedUnit = String(unit || "GB").toUpperCase() === "TB" ? "TB" : "GB";
  return value ? `${value} ${normalizedUnit}` : "";
}

function variantGroupMarkup(v = {}, isBase = false) {
  const parsedStorage = parseStorageValue(v.storage || "");
  const storage = parsedStorage.amount;
  const storageUnit = parsedStorage.unit;
  const ram = String(v.ram || "").trim().replace(/\s*GB\s*/i, "");
  const title = isBase
    ? "Configuración principal"
    : [formatStorageLabel(storage, storageUnit), ram ? ram + " GB RAM" : ""].filter(Boolean).join(" · ") || "Nueva configuración";
  const colorControls = `<div class="variant-color-section">
    <strong class="variant-color-section-title">Colores de esta configuración</strong>
    <div class="variant-color-list" data-variant-color-list></div>
    <button class="admin-mini-button variant-add-color" type="button" data-add-group-color aria-label="Añadir color a esta configuración">+ Color</button>
  </div>`;

  return `<section class="variant-config-group ${isBase ? "variant-base-group" : ""}" data-variant-group data-base-group="${isBase ? "true" : "false"}">
    <div class="variant-config-group-heading">
      <div><strong data-variant-group-title>${escapeHtml(title)}</strong><small>${isBase ? "Definí RAM, almacenamiento, precio y colores de la configuración principal." : "Definí el precio y los colores de esta configuración."}</small></div>
      ${isBase ? "" : '<button class="admin-mini-button danger" type="button" data-remove-group>Eliminar configuración</button>'}
    </div>
    <div class="variant-config-fields">
      <label class="variant-storage-label"><span class="variant-storage-label-row"><select class="variant-storage-unit" data-group-storage-unit aria-label="Unidad de almacenamiento"><option value="GB" ${storageUnit === "GB" ? "selected" : ""}>GB</option><option value="TB" ${storageUnit === "TB" ? "selected" : ""}>TB</option></select><span class="variant-storage-name">Almacenamiento</span></span><input data-group-storage type="number" min="1" step="1" inputmode="numeric" value="${escapeHtml(storage)}"></label>
      <label>GB de memoria RAM<input data-group-ram type="number" min="1" step="1" inputmode="numeric" value="${escapeHtml(ram)}"></label>
      <label>Precio en dólares<span class="admin-input-unit"><span>$</span><input data-group-price-usd type="number" min="0" step="0.01" inputmode="decimal" value="${escapeHtml(v.price_usd ?? "")}"></span></label>
      <label>Precio en córdobas<span class="admin-input-unit"><span>C$</span><input data-group-price-nio type="number" min="0" step="0.01" inputmode="decimal" value="${escapeHtml(v.price_nio ?? "")}"></span></label>
    </div>
    ${colorControls}
  </section>`;
}

function renderVariantRows(variants = []) {
  const container = $("#product-variants-list");
  const colorManager = $("#base-color-manager");
  if (!container || !colorManager) return;

  const normalized = normalizeVariants(variants);
  const groups = new Map();
  normalized.forEach(variant => {
    const key = variantGroupKey(variant);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(variant);
  });

  const makeColors = items => {
    const byName = new Map();
    (items || []).forEach(variant => {
      const name = String(variant.color || "").trim();
      if (!name) return;
      const key = name.toLocaleLowerCase("es");
      const images = Array.isArray(variant.images) && variant.images.length
        ? variant.images
        : [variant.image_url || ""].filter(Boolean);
      if (!byName.has(key)) {
        byName.set(key, {
          color: name,
          color_hex: validHex(variant.color_hex || variant.hex),
          availability: normalizeVariantAvailability(variant.availability),
          images: [...new Set(images)],
          image_url: images[0] || ""
        });
      } else {
        const current = byName.get(key);
        current.images = [...new Set([...(current.images || []), ...images])];
        current.image_url = current.images[0] || "";
      }
    });
    return [...byName.values()];
  };

  container.innerHTML = "";
  colorManager.innerHTML = "";

  // Show a primary configuration for new products or legacy products whose variants have no RAM/storage.
  // If saved variants all have technical configurations, don't add a misleading blank configuration.
  const shouldRenderPrimaryGroup = groups.size === 0 || groups.has("|");
  if (shouldRenderPrimaryGroup) {
    colorManager.insertAdjacentHTML("beforeend", variantGroupMarkup((groups.get("|") || [])[0] || {}, true));
    const baseGroup = colorManager.querySelector('[data-variant-group][data-base-group="true"]');
    const baseList = baseGroup?.querySelector("[data-variant-color-list]");
    const baseColors = makeColors(groups.get("|") || []);
    baseColors.forEach(color => baseList?.insertAdjacentHTML("beforeend", variantRowMarkup(color)));
    if (baseList && !baseColors.length) baseList.innerHTML = '<p class="variants-empty-hint">Añadí los colores disponibles para esta configuración.</p>';
  }

  groups.delete("|");
  groups.forEach(items => {
    const first = items[0] || {};
    container.insertAdjacentHTML("beforeend", variantGroupMarkup(first, false));
    const group = container.lastElementChild;
    const list = group?.querySelector("[data-variant-color-list]");
    const colors = makeColors(items);
    colors.forEach(color => list?.insertAdjacentHTML("beforeend", variantRowMarkup(color)));
    if (list && !colors.length) list.innerHTML = '<p class="variants-empty-hint">Añadí los colores disponibles para esta configuración.</p>';
  });
  if (!groups.size) container.innerHTML = '<p class="variants-empty-hint">La configuración principal está arriba. Añadí otra configuración solo si cambia la RAM o el almacenamiento.</p>';

  updateVariantRowHeadings();
  form?.querySelectorAll("[data-variant-row]").forEach(row => { renderVariantImagePreview(row); syncColorLibraryRowControls(row); });
}

function addVariantRow(variant = {}, targetGroup = null, options = {}) {
  const container = $("#product-variants-list");
  if (!container) return;
  let group = targetGroup;
  if (!group) {
    container.querySelector(".variants-empty-hint")?.remove();
    container.insertAdjacentHTML("beforeend", variantGroupMarkup(variant, false));
    group = container.lastElementChild;
  }
  const list = group.querySelector("[data-variant-color-list]");
  if (!list) return;
  list.querySelector(".variants-empty-hint")?.remove();
  list.insertAdjacentHTML("beforeend", variantRowMarkup(variant));
  renderVariantImagePreview(list.lastElementChild);
  updateVariantRowHeadings();
  const rows = list.querySelectorAll("[data-variant-row]");
  if (options.focus !== false) rows.item(rows.length - 1)?.querySelector("[data-variant-color]")?.focus();
}

function updateVariantRowHeadings() {
  document.querySelectorAll("[data-variant-group]").forEach(group => {
    const storage = group.querySelector("[data-group-storage]")?.value.trim();
    const ram = group.querySelector("[data-group-ram]")?.value.trim();
    const storageUnit = group.querySelector("[data-group-storage-unit]")?.value || "GB";
    const title = [formatStorageLabel(storage, storageUnit), ram ? ram + " GB RAM" : ""].filter(Boolean).join(" · ") || (group.dataset.baseGroup === "true" ? "Configuración principal" : "Nueva configuración");
    const heading = group.querySelector("[data-variant-group-title]");
    if (heading) heading.textContent = title;
    group.querySelectorAll("[data-variant-row]").forEach((row, index) => {
      const colorName = row.querySelector("[data-variant-color]")?.value.trim();
      const rowHeading = row.querySelector("[data-variant-row-heading]");
      if (rowHeading) rowHeading.textContent = colorName || "Color " + (index + 1);
      const hex = validHex(row.querySelector("[data-variant-hex]")?.value);
      const dot = row.querySelector("[data-variant-color-dot]");
      if (dot) dot.style.setProperty("--inline-color", hex);
      const removeButton = row.querySelector("[data-remove-variant]");
      if (removeButton) removeButton.setAttribute("aria-label", "Quitar " + (colorName || "color"));
    });
  });
}

/* Galerías editables: orden, portada y fotos múltiples por variante. */
const specsTextarea = $("#product-specs");
function resizeSpecsTextarea(){ if(!specsTextarea)return; specsTextarea.style.height="auto"; specsTextarea.style.height=`${Math.max(66,specsTextarea.scrollHeight)}px`; }
specsTextarea?.addEventListener("input",resizeSpecsTextarea);
requestAnimationFrame(resizeSpecsTextarea);

const variantsContainer = $("#product-variants-list");
const baseColorManager = $("#base-color-manager");
const mainImagesInput = $("#product-images"), mainImagesPreview = $("#product-images-preview"), mainImagesSummary = $("#product-images-summary");
let mainImageItems = [], draggingMainImageId = null, draggingVariantImage = null;
const imageId = () => crypto.randomUUID();
const imagePreviewUrl = item => item.kind === "new" ? item.previewUrl : item.url;
function disposeImageItems(items){items.forEach(item=>{if(item.kind==="new"&&item.previewUrl)URL.revokeObjectURL(item.previewUrl);});}
function clearMainImagePreviews(){disposeImageItems(mainImageItems);mainImageItems=[];mainImagesPreview?.replaceChildren();}
function setExistingMainImages(urls=[]){disposeImageItems(mainImageItems);mainImageItems=[...new Set(urls.filter(url=>typeof url==="string"&&url.trim()))].map(url=>({id:imageId(),kind:"existing",url}));renderMainImagePreviews();}
function renderMainImagePreviews(){
 if(!mainImagesInput||!mainImagesPreview||!mainImagesSummary)return;
 mainImagesPreview.replaceChildren();
 mainImagesSummary.textContent=mainImageItems.length?`${mainImageItems.length} fotografía${mainImageItems.length===1?"":"s"} · la primera será la portada`:"Ninguna fotografía seleccionada";
 mainImageItems.forEach((item,index)=>{
  const card=document.createElement("figure");card.className="admin-image-preview-card sortable-image-card";card.draggable=true;card.dataset.imageItemId=item.id;
  const img=document.createElement("img");img.src=imagePreviewUrl(item);img.alt=`Fotografía ${index+1} del producto`;img.loading="lazy";
  const badge=document.createElement("span");badge.className="admin-image-order-badge"+(index===0?" is-cover":"");badge.setAttribute("aria-label",index===0?"Fotografía de portada":"Fotografía "+(index+1));badge.title=index===0?"Fotografía de portada":"Fotografía "+(index+1);badge.innerHTML=index===0?'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 19h14l1-9-5 3-3-7-3 7-5-3 1 9Z"></path><path d="M7 22h10"></path></svg>':'<span>'+String(index+1)+'</span>';
  const caption=document.createElement("figcaption");caption.textContent=item.kind==="new"?item.file.name:"Imagen guardada";
  const controls=document.createElement("div");controls.className="admin-image-controls";
  for(const [label,offset,disabled] of [["↑",-1,index===0],["↓",1,index===mainImageItems.length-1]]){
   const b=document.createElement("button");b.type="button";b.className="admin-mini-button";b.textContent=label;b.disabled=disabled;b.dataset.mainImageMove=String(offset);b.title=offset<0?"Mover antes":"Mover después";controls.append(b);
  }
  const remove=document.createElement("button");remove.type="button";remove.className="admin-mini-button danger";remove.textContent="×";remove.dataset.mainImageRemove="true";remove.title="Quitar fotografía";
  controls.append(remove);card.append(badge,img,caption,controls);mainImagesPreview.append(card);
 });
}
function moveMainImage(id,offset){const from=mainImageItems.findIndex(i=>i.id===id),to=from+offset;if(from<0||to<0||to>=mainImageItems.length)return;const [item]=mainImageItems.splice(from,1);mainImageItems.splice(to,0,item);renderMainImagePreviews();updateEditorDirtyState();}
function removeMainImage(id){const from=mainImageItems.findIndex(i=>i.id===id);if(from<0)return;disposeImageItems([mainImageItems[from]]);mainImageItems.splice(from,1);renderMainImagePreviews();updateEditorDirtyState();}
mainImagesInput?.addEventListener("change",()=>{for(const file of Array.from(mainImagesInput.files||[]))mainImageItems.push({id:imageId(),kind:"new",file,previewUrl:URL.createObjectURL(file)});mainImagesInput.value="";renderMainImagePreviews();updateEditorDirtyState();scheduleLocalRecoverySave();});
mainImagesPreview?.addEventListener("click",e=>{const card=e.target.closest("[data-image-item-id]");if(!card)return;const m=e.target.closest("[data-main-image-move]");if(m)moveMainImage(card.dataset.imageItemId,Number(m.dataset.mainImageMove));else if(e.target.closest("[data-main-image-remove]"))removeMainImage(card.dataset.imageItemId);});
mainImagesPreview?.addEventListener("dragstart",e=>{const card=e.target.closest("[data-image-item-id]");if(!card)return;draggingMainImageId=card.dataset.imageItemId;card.classList.add("is-dragging");e.dataTransfer?.setData("text/plain",draggingMainImageId);if(e.dataTransfer)e.dataTransfer.effectAllowed="move";});
mainImagesPreview?.addEventListener("dragover",e=>{if(e.target.closest("[data-image-item-id]"))e.preventDefault();});
mainImagesPreview?.addEventListener("drop",e=>{const card=e.target.closest("[data-image-item-id]");if(!card||!draggingMainImageId)return;e.preventDefault();const from=mainImageItems.findIndex(i=>i.id===draggingMainImageId),to=mainImageItems.findIndex(i=>i.id===card.dataset.imageItemId);if(from>=0&&to>=0&&from!==to){const [item]=mainImageItems.splice(from,1);mainImageItems.splice(to,0,item);renderMainImagePreviews();updateEditorDirtyState();}draggingMainImageId=null;});
mainImagesPreview?.addEventListener("dragend",()=>{draggingMainImageId=null;mainImagesPreview.querySelectorAll(".is-dragging").forEach(n=>n.classList.remove("is-dragging"));});
function readVariantImageUrls(row){
  const legacyUrl = row?.querySelector("[data-variant-image-url]")?.value?.trim() || "";
  try {
    const parsed = JSON.parse(row?.querySelector("[data-variant-images]")?.value || "[]");
    if (Array.isArray(parsed)) {
      const urls = [...new Set(parsed
        .filter(url => typeof url === "string")
        .map(url => url.trim())
        .filter(Boolean))];
      return urls.length ? urls : (legacyUrl ? [legacyUrl] : []);
    }
  } catch {}
  return legacyUrl ? [legacyUrl] : [];
}
function initVariantImageItems(row){if(!row||Array.isArray(row._variantImageItems))return;row._variantImageItems=readVariantImageUrls(row).map(url=>({id:imageId(),kind:"existing",url}));}
function syncVariantImageFields(row){const items=row?._variantImageItems||[],urls=items.filter(i=>i.kind==="existing").map(i=>i.url),json=row?.querySelector("[data-variant-images]"),legacy=row?.querySelector("[data-variant-image-url]");if(json)json.value=JSON.stringify(urls);if(legacy)legacy.value=urls[0]||"";}
function renderVariantImagePreview(row){
 const preview=row?.querySelector("[data-variant-image-preview]");if(!preview)return;initVariantImageItems(row);preview.replaceChildren();const items=row._variantImageItems;
 if(!items.length){const empty=document.createElement("span");empty.className="variant-image-placeholder";empty.textContent="Añadí fotografías de este color";preview.append(empty);return;}
 items.forEach((item,index)=>{const card=document.createElement("figure");card.className="variant-gallery-item sortable-image-card";card.draggable=true;card.dataset.variantImageId=item.id;
  const img=document.createElement("img");img.src=imagePreviewUrl(item);img.alt=`Fotografía ${index+1} del color`;img.loading="lazy";
  const badge=document.createElement("span");badge.className="admin-image-order-badge"+(index===0?" is-cover":"");badge.setAttribute("aria-label",index===0?"Fotografía de portada":"Fotografía "+(index+1));badge.title=index===0?"Fotografía de portada":"Fotografía "+(index+1);badge.innerHTML=index===0?'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 19h14l1-9-5 3-3-7-3 7-5-3 1 9Z"></path><path d="M7 22h10"></path></svg>':'<span>'+String(index+1)+'</span>';
  const controls=document.createElement("div");controls.className="admin-image-controls";
  for(const [label,offset,disabled] of [["↑",-1,index===0],["↓",1,index===items.length-1]]){const b=document.createElement("button");b.type="button";b.className="admin-mini-button";b.textContent=label;b.disabled=disabled;b.dataset.variantImageMove=String(offset);b.title=offset<0?"Mover antes":"Mover después";controls.append(b);}
  const remove=document.createElement("button");remove.type="button";remove.className="admin-mini-button danger";remove.textContent="×";remove.dataset.variantImageRemove="true";remove.title="Quitar fotografía";controls.append(remove);card.append(badge,img,controls);preview.append(card);
 });
}
function moveVariantImage(row,id,offset){initVariantImageItems(row);const a=row._variantImageItems,from=a.findIndex(i=>i.id===id),to=from+offset;if(from<0||to<0||to>=a.length)return;const [item]=a.splice(from,1);a.splice(to,0,item);syncVariantImageFields(row);renderVariantImagePreview(row);updateEditorDirtyState();}
function removeVariantImage(row,id){initVariantImageItems(row);const a=row._variantImageItems,from=a.findIndex(i=>i.id===id);if(from<0)return;disposeImageItems([a[from]]);a.splice(from,1);syncVariantImageFields(row);renderVariantImagePreview(row);updateEditorDirtyState();}
form?.addEventListener("click",e=>{const card=e.target.closest("[data-variant-image-id]");if(!card)return;const row=card.closest("[data-variant-row]");if(!row)return;const m=e.target.closest("[data-variant-image-move]");if(m)moveVariantImage(row,card.dataset.variantImageId,Number(m.dataset.variantImageMove));else if(e.target.closest("[data-variant-image-remove]"))removeVariantImage(row,card.dataset.variantImageId);});
form?.addEventListener("dragstart",e=>{const card=e.target.closest("[data-variant-image-id]");if(!card)return;draggingVariantImage={id:card.dataset.variantImageId,row:card.closest("[data-variant-row]")};card.classList.add("is-dragging");e.dataTransfer?.setData("text/plain",draggingVariantImage.id);if(e.dataTransfer)e.dataTransfer.effectAllowed="move";});
form?.addEventListener("dragover",e=>{if(e.target.closest("[data-variant-image-id]"))e.preventDefault();});
form?.addEventListener("drop",e=>{const card=e.target.closest("[data-variant-image-id]");if(!card||!draggingVariantImage)return;const row=card.closest("[data-variant-row]");if(row!==draggingVariantImage.row)return;e.preventDefault();initVariantImageItems(row);const a=row._variantImageItems,from=a.findIndex(i=>i.id===draggingVariantImage.id),to=a.findIndex(i=>i.id===card.dataset.variantImageId);if(from>=0&&to>=0&&from!==to){const [item]=a.splice(from,1);a.splice(to,0,item);syncVariantImageFields(row);renderVariantImagePreview(row);updateEditorDirtyState();}draggingVariantImage=null;});
form?.addEventListener("dragend",()=>{draggingVariantImage=null;form.querySelectorAll(".is-dragging").forEach(n=>n.classList.remove("is-dragging"));});


/* Selector rápido: permite elegir el color junto al precio/garantía sin saltar de sección. */
const quickColorPalette = $("#quick-color-palette");
const quickColorButton = $("#add-base-color-button");
const quickColorStatus = $("#quick-color-status");

const quickColorSwatches = $("#quick-color-swatches");
const quickColorSearch = $("#quick-color-search");

let quickColorFilter = "all";

function renderQuickColorPalette(query = "") {
  if (!quickColorSwatches) return;
  const q = normalizeColorSearch(query);
  const data = readColorLibraryData();
  const favorites = new Set(data.items.filter(item => item.favorite).map(colorIdentity));
  const recent = new Set(data.recent.map(colorIdentity));
  const filtered = COLOR_PALETTE.filter(color => {
    const matchesQuery = !q ||
      normalizeColorSearch(color.name).includes(q) ||
      (color.aliases || []).some(alias => normalizeColorSearch(alias).includes(q)) ||
      color.hex.toLowerCase().includes(q);
    const identity = colorIdentity(color);
    const matchesFilter = quickColorFilter === "favorites" ? favorites.has(identity)
      : quickColorFilter === "recent" ? recent.has(identity) : true;
    return matchesQuery && matchesFilter;
  });
  const hexMatch = String(query).trim().match(/^#[0-9a-f]{6}$/i);
  const exactHex = hexMatch ? hexMatch[0].toUpperCase() : "";
  const exactIsKnown = exactHex && COLOR_PALETTE.some(item => item.hex.toLowerCase() === exactHex.toLowerCase());
  const customHexOption = exactHex && !exactIsKnown && quickColorFilter === "all"
    ? '<button class="quick-color-swatch quick-color-custom-swatch" type="button" data-quick-color="' + exactHex + '" data-quick-color-hex="' + exactHex + '" title="Seleccionar color personalizado ' + exactHex + '" aria-label="Seleccionar color personalizado ' + exactHex + '">' +
      '<span class="quick-color-dot" style="--quick-color:' + exactHex + '"></span><span class="quick-color-name">Personalizado</span><span class="quick-color-code">' + exactHex + '</span></button>'
    : "";
  const paletteButtons = filtered.map(color =>
    '<button class="quick-color-swatch" type="button" data-quick-color="' + escapeHtml(color.name) + '" data-quick-color-hex="' + color.hex + '" title="' + escapeHtml(color.name) + ' · ' + color.hex + '" aria-label="Seleccionar color ' + escapeHtml(color.name) + ' ' + color.hex + '">' +
      '<span class="quick-color-dot" style="--quick-color:' + color.hex + '"></span>' +
      '<span class="quick-color-name">' + escapeHtml(color.name) + '</span>' +
      '<span class="quick-color-code">' + color.hex + '</span>' +
      (favorites.has(colorIdentity(color)) ? '<span class="quick-color-favorite-mark" aria-hidden="true">★</span>' : '') +
    '</button>'
  ).join("");
  quickColorSwatches.innerHTML = paletteButtons + customHexOption ||
    '<p class="quick-color-no-results">Sin resultados para este filtro. Probá Todos o buscá otro nombre, alias o HEX.</p>';
}
renderColorLibraryDatalist();
renderQuickColorPalette();
quickColorSearch?.addEventListener("input", () => renderQuickColorPalette(quickColorSearch.value));

quickColorButton?.addEventListener("click", event => {
  event.preventDefault();
  const expanded = quickColorButton.getAttribute("aria-expanded") === "true";
  quickColorButton.setAttribute("aria-expanded", String(!expanded));
  quickColorPalette?.toggleAttribute("hidden", expanded);
});

quickColorPalette?.addEventListener("click", event => {
  const filterButton = event.target.closest("[data-color-library-filter]");
  if (filterButton) {
    quickColorFilter = filterButton.dataset.colorLibraryFilter || "all";
    quickColorPalette.querySelectorAll("[data-color-library-filter]").forEach(button => {
      const active = button.dataset.colorLibraryFilter === quickColorFilter;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    renderQuickColorPalette(quickColorSearch?.value || "");
    return;
  }
  const choice = event.target.closest("[data-quick-color]");
  if (!choice) return;
  const color = choice.dataset.quickColor || "";
  const hex = (choice.dataset.quickColorHex || "#242424").toUpperCase();
  recordRecentColor({ name: color || hex, hex });
  renderColorLibraryDatalist();
  const container = $("#product-variants-list");
  const colorManager = $("#base-color-manager");
  if (!container || !colorManager) return;

  let baseGroup = colorManager.querySelector('[data-variant-group][data-base-group="true"]');
  if (!baseGroup) {
    renderVariantRows([]);
    baseGroup = colorManager.querySelector('[data-variant-group][data-base-group="true"]');
  }
  if (!baseGroup) return;

  const duplicate = Array.from(baseGroup.querySelectorAll("[data-variant-row]")).some(row => {
    const existingName = row.querySelector("[data-variant-color]")?.value.trim().toLocaleLowerCase("es");
    const existingHex = row.querySelector("[data-variant-hex]")?.value.trim().toLowerCase();
    return existingName === color.toLocaleLowerCase("es") || existingHex === hex.toLowerCase();
  });
  if (duplicate) {
    if (quickColorStatus) {
      quickColorStatus.textContent = `${color} ya está añadido. Elegí otro color.`;
      quickColorStatus.dataset.state = "error";
    }
    return;
  }

  addVariantRow({color, color_hex:hex, image_url:"", availability:"available"}, baseGroup, {focus:false});
  updateEditorDirtyState();
  if (quickColorStatus) {
    quickColorStatus.textContent = "";
    delete quickColorStatus.dataset.state;
  }
  quickColorSwatches?.querySelectorAll("[data-quick-color]").forEach(button => {
    button.classList.toggle("is-selected", button.dataset.quickColorHex?.toUpperCase() === hex);
  });
});

$("#add-variant-button")?.addEventListener("click", event => {
  event.preventDefault();
  const container = $("#product-variants-list");
  if (!container) return;
  const groupHtml = variantGroupMarkup({ storage: "", ram: "", price_usd: "", price_nio: "" }, false);
  container.querySelector(".variants-empty-hint")?.remove();
  container.insertAdjacentHTML("beforeend", groupHtml);
  const newGroup = container.lastElementChild;
  if (!newGroup?.matches("[data-variant-group]")) {
    message("#product-form-status", "No se pudo crear la configuración. Recargá el panel e intentá nuevamente.", "error");
    return;
  }
  updateVariantRowHeadings();
  newGroup.querySelector("[data-group-storage]")?.focus();
  updateEditorDirtyState();
});

form?.addEventListener("click", event => {
  const saveLibraryButton = event.target.closest("[data-save-color-library]");
  if (saveLibraryButton) {
    const row = saveLibraryButton.closest("[data-variant-row]");
    const color = { name: row?.querySelector("[data-variant-color]")?.value.trim() || "", hex: validHex(row?.querySelector("[data-variant-hex]")?.value, "") };
    const result = saveColorToLibrary(color);
    const status = row?.querySelector("[data-variant-status]");
    if (status) {
      status.textContent = result.message;
      status.dataset.state = result.ok ? "success" : "error";
    }
    if (result.ok) {
      renderColorLibraryDatalist();
      renderQuickColorPalette(quickColorSearch?.value || "");
    }
    syncColorLibraryRowControls(row);
    return;
  }

  const favoriteButton = event.target.closest("[data-toggle-color-favorite]");
  if (favoriteButton) {
    const row = favoriteButton.closest("[data-variant-row]");
    const color = { name: row?.querySelector("[data-variant-color]")?.value.trim() || "", hex: validHex(row?.querySelector("[data-variant-hex]")?.value, "") };
    const result = toggleColorFavorite(color);
    const status = row?.querySelector("[data-variant-status]");
    if (status) {
      status.textContent = result.message;
      status.dataset.state = result.ok ? "success" : "error";
    }
    if (result.ok) {
      renderColorLibraryDatalist();
      renderQuickColorPalette(quickColorSearch?.value || "");
    }
    syncColorLibraryRowControls(row);
    return;
  }

  const swatch = event.target.closest("[data-variant-swatch]");
  if (swatch) {
    const row = swatch.closest("[data-variant-row]");
    if (!row) return;
    const hex = swatch.dataset.variantSwatch || "#242424";
    const name = swatch.dataset.variantSwatchName || hex.toUpperCase();
    recordRecentColor({ name, hex });
    row.querySelector("[data-variant-color]").value = name;
    row.querySelector("[data-variant-hex]").value = hex;
    const hexText = row.querySelector("[data-variant-hex-text]");
    if (hexText) hexText.value = hex.toUpperCase();
    const palette = row.querySelector("[data-variant-palette]");
    if (palette) palette.value = COLOR_PALETTE.some(item => item.hex.toLowerCase() === hex.toLowerCase()) ? hex : "custom";
    row.querySelectorAll("[data-variant-swatch]").forEach(button => {
      const selected = button.dataset.variantSwatch?.toLowerCase() === hex.toLowerCase();
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    updateVariantRowHeadings();
    updateEditorDirtyState();
    return;
  }

  const add = event.target.closest("[data-add-group-color]");
  if (add) {
    const group = add.closest("[data-variant-group]");
    if (group) {
      addVariantRow({color:"",color_hex:"#242424",image_url:"",availability:"available"}, group);
      updateEditorDirtyState();
    }
    return;
  }

  const removeGroup = event.target.closest("[data-remove-group]");
  if (removeGroup) {
    removeGroup.closest("[data-variant-group]")?.remove();
    if (!variantsContainer.querySelector("[data-variant-group]")) {
      if (!baseColorManager?.querySelector('[data-variant-group][data-base-group="true"]')) {
        renderVariantRows([]);
      } else {
        variantsContainer.innerHTML = '<p class="variants-empty-hint">La configuración principal está arriba. Añadí otra configuración solo si cambia la RAM o el almacenamiento.</p>';
      }
    }
    updateEditorDirtyState();
    return;
  }

  const remove = event.target.closest("[data-remove-variant]");
  if (!remove) return;
  const group = remove.closest("[data-variant-group]");
  const isBaseGroup = group?.dataset.baseGroup === "true";
  remove.closest("[data-variant-row]")?.remove();
  if (group && !group.querySelector("[data-variant-row]")) {
    if (isBaseGroup) {
      const list = group.querySelector("[data-variant-color-list]");
      if (list) list.innerHTML = '<p class="variants-empty-hint">Elegí un color para este producto.</p>';
    } else {
      group.remove();
    }
  }
  if (!form.querySelector("[data-variant-group]")) renderVariantRows([]);
  updateVariantRowHeadings();
  updateEditorDirtyState();
});

form?.addEventListener("change", event => {
  const librarySearch = event.target.closest("[data-variant-library-search]");
  if (librarySearch) {
    const row = librarySearch.closest("[data-variant-row]");
    const match = findColorInPalette(librarySearch.value);
    if (match && row) {
      applyColorToRow(row, match);
      librarySearch.value = match.name;
      renderColorLibraryDatalist();
      renderQuickColorPalette(quickColorSearch?.value || "");
      const status = row.querySelector("[data-variant-status]");
      if (status) {
        status.textContent = "Color aplicado desde la biblioteca.";
        status.dataset.state = "success";
      }
    } else if (row && librarySearch.value.trim()) {
      const status = row.querySelector("[data-variant-status]");
      if (status) {
        status.textContent = "No encontré ese color. Guardá primero el nombre y el HEX de esta tarjeta.";
        status.dataset.state = "error";
      }
    }
    return;
  }
  if (event.target.matches("[data-variant-hex-text]")) {
    const row = event.target.closest("[data-variant-row]");
    const hex = validHex(event.target.value.trim(), "");
    if (row && hex) {
      const currentName = row.querySelector("[data-variant-color]")?.value.trim() || "";
      recordRecentColor({ name: currentName || (findColorInPalette(hex)?.name || hex), hex });
      renderColorLibraryDatalist();
      renderQuickColorPalette(quickColorSearch?.value || "");
      syncColorLibraryRowControls(row);
    }
    return;
  }
  const imageInput = event.target.closest("[data-variant-image]");
  if (imageInput) {
    const row=imageInput.closest("[data-variant-row]"); if(!row)return;
    initVariantImageItems(row);
    for(const file of Array.from(imageInput.files||[]))row._variantImageItems.push({id:imageId(),kind:"new",file,previewUrl:URL.createObjectURL(file)});
    imageInput.value="";syncVariantImageFields(row);renderVariantImagePreview(row);updateEditorDirtyState();return;
  }
  const urlInput = event.target.closest("[data-variant-image-url]");
  if (urlInput) return;
  if (event.target.matches("[data-variant-images]")) return;
  const select = event.target.closest("[data-variant-palette]");
  if (!select) return;
  const row = select.closest("[data-variant-row]");
  if (!row || !select.value || select.value === "custom") return;
  const color = COLOR_PALETTE.find(item => item.hex === select.value);
  if (!color) return;
  applyColorToRow(row, color);
  renderColorLibraryDatalist();
  renderQuickColorPalette(quickColorSearch?.value || "");
});

form?.addEventListener("input", event => {
  if (event.target.matches("[data-variant-hex-text]")) {
    const row = event.target.closest("[data-variant-row]");
    const value = event.target.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(value) && row) {
      row.querySelector("[data-variant-hex]").value = value;
      const matching = findColorInPalette(value);
      row.querySelector("[data-variant-palette]").value = matching ? matching.hex : "custom";
      row.querySelector("[data-variant-color]").value = matching ? matching.name : value.toUpperCase();
      row.querySelectorAll("[data-variant-swatch]").forEach(button => {
        const selected = button.dataset.variantSwatch?.toLowerCase() === value.toLowerCase();
        button.classList.toggle("is-selected", selected);
        button.setAttribute("aria-pressed", String(selected));
      });
      updateVariantRowHeadings();
      updateEditorDirtyState();
    }
    return;
  }
  if (!event.target.matches("[data-variant-color], [data-variant-hex], [data-group-storage], [data-group-storage-unit], [data-group-ram]")) return;
  const row = event.target.closest("[data-variant-row]");
  if (event.target.matches("[data-group-storage], [data-group-storage-unit], [data-group-ram]")) {
    updateVariantRowHeadings();
    return;
  }
  if (!row) return;

  if (event.target.matches("[data-variant-hex]")) {
    const hexText = row.querySelector("[data-variant-hex-text]");
    if (hexText) hexText.value = event.target.value.toUpperCase();
    updateVariantRowHeadings();
    updateEditorDirtyState();
    return;
  }

  if (event.target.matches("[data-variant-color]")) {
    const colorName = event.target.value.trim();
    const matchingColor = findColorInPalette(colorName);
    if (matchingColor) {
      row.querySelector("[data-variant-color]").value = matchingColor.name;
      row.querySelector("[data-variant-hex]").value = matchingColor.hex;
      row.querySelector("[data-variant-hex-text]").value = matchingColor.hex;
      row.querySelector("[data-variant-palette]").value = matchingColor.hex;
      row.querySelectorAll("[data-variant-swatch]").forEach(button => {
        const selected = button.dataset.variantSwatch?.toLowerCase() === matchingColor.hex.toLowerCase();
        button.classList.toggle("is-selected", selected);
        button.setAttribute("aria-pressed", String(selected));
      });
    } else {
      row.querySelector("[data-variant-palette]").value = "custom";
      row.querySelectorAll("[data-variant-swatch]").forEach(button => {
        button.classList.remove("is-selected");
        button.setAttribute("aria-pressed", "false");
      });
    }
    syncColorLibraryRowControls(row);
  }

  updateVariantRowHeadings();
  form?.querySelectorAll("[data-variant-row]").forEach(syncColorLibraryRowControls);
  updateEditorDirtyState();
});

/* =========================================================
   AUTORIZACIÓN DE ADMINISTRADORES
   ========================================================= */

async function confirmAdmin(user) {
  if (!supabase || !user?.id) {
    throw new Error("No se pudo verificar la sesión.");
  }

  const { data, error } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error(
      "Tu usuario inició sesión, pero no está autorizado para administrar el catálogo."
    );
  }

  return true;
}

async function showDashboard(user) {
  await confirmAdmin(user);

  currentUser = user;

  loginPanel.classList.add("hidden");
  dashboard.classList.remove("hidden");
  document.body.classList.add("admin-dashboard-active");
  setMobileSidebarOpen(false);
  showAdminSection("home");

  const greeting = $("#admin-greeting");
  if (greeting) greeting.textContent = "¡Bienvenido de nuevo, Steven! 👋";

  setStatus("Sesión iniciada");
  window.setTimeout(() => { const status = $("#admin-status"); if (status?.textContent === "Sesión iniciada") status.textContent = ""; }, 4500);

  await loadProducts();
  await checkLocalRecoveryDraft();
}

async function handleSession() {
  if (!configured) {
    message(
      "#login-status",
      "Falta configurar la URL y la clave publicable de Supabase en config.js.",
      "error"
    );

    return;
  }

  const { data, error } = await supabase.auth.getSession();

  if (error) {
    throw error;
  }

  if (!data.session) {
    loginPanel.classList.remove("hidden");
    dashboard.classList.add("hidden");
    return;
  }

  try {
    await showDashboard(data.session.user);
  } catch (error) {
    await signOutLocalSafely();

    showLoginScreen(
      error.message ||
      "La sesión no está autorizada para administrar este catálogo.",
      "error"
    );
  }
}

/* =========================================================
   INICIO Y CIERRE DE SESIÓN
   ========================================================= */

$("#restore-local-draft")?.addEventListener("click", () => { void restoreLocalRecoveryDraft(); });
$("#delete-local-draft")?.addEventListener("click", () => { void deleteLocalRecoveryDraft(); });

$("#login-form")?.addEventListener("submit", async event => {
  event.preventDefault();

  if (!supabase) {
    message(
      "#login-status",
      "Configurá primero Supabase en config.js.",
      "error"
    );

    clearLoginPassword();
    return;
  }

  const button = event.currentTarget.querySelector(
    'button[type="submit"]'
  );

  button.disabled = true;
  button.textContent = "Verificando…";

  message("#login-status", "Comprobando acceso…");

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: $("#login-email").value.trim(),
      password: $("#login-password").value
    });

    if (error) {
      throw error;
    }

    await showDashboard(data.user);

    message(
      "#login-status",
      "Acceso autorizado.",
      "success"
    );
  } catch (error) {
    /*
      Limpia cualquier sesión local si las credenciales fallan
      o el usuario no está autorizado en admin_users.
    */
    await signOutLocalSafely();

    dashboard.classList.add("hidden");
    loginPanel.classList.remove("hidden");

    /*
      Conservamos el correo para que no tengás que escribirlo
      nuevamente, pero borramos la contraseña incorrecta.
    */
    clearLoginPassword();

    message(
      "#login-status",
      error.message || "No se pudo iniciar sesión. Revisá tus datos.",
      "error"
    );

    $("#login-password")?.focus();
  } finally {
    button.disabled = false;
    button.textContent = "Iniciar sesión";
  }
});

$("#logout-button")?.addEventListener("click", async event => {
  await saveLocalRecoveryDraft();
  const button = event.currentTarget;

  button.disabled = true;
  button.textContent = "Cerrando sesión…";

  await signOutLocalSafely();

  showLoginScreen(
    "Sesión cerrada correctamente.",
    "success"
  );

  button.disabled = false;
  button.textContent = "Cerrar sesión";
});

/* =========================================================
   INVENTARIO: CONSULTAR Y LISTAR PRODUCTOS
   ========================================================= */

function minimumPrice(variants, field) {
  const values = variants
    .map(variant => variant[field])
    .filter(value =>
      value !== null &&
      value !== undefined &&
      value !== "" &&
      Number.isFinite(Number(value))
    )
    .map(Number);

  return values.length ? Math.min(...values) : null;
}

function setMobileSidebarOpen(open) {
  const toggle = document.getElementById("admin-menu-toggle");
  const backdrop = document.getElementById("admin-sidebar-backdrop");
  const isMobile = window.matchMedia("(max-width: 760px)").matches;
  const shouldOpen = Boolean(open && isMobile);

  document.body.classList.toggle("admin-sidebar-open", shouldOpen);
  if (toggle) {
    toggle.setAttribute("aria-expanded", String(shouldOpen));
    toggle.setAttribute("aria-label", shouldOpen ? "Cerrar menú de administración" : "Abrir menú de administración");
    toggle.setAttribute("title", shouldOpen ? "Cerrar menú" : "Abrir menú");
    toggle.querySelector("span").textContent = shouldOpen ? "×" : "☰";
  }
  if (backdrop) backdrop.hidden = !shouldOpen;
}

document.getElementById("admin-menu-toggle")?.addEventListener("click", () => {
  setMobileSidebarOpen(!document.body.classList.contains("admin-sidebar-open"));
});
document.getElementById("admin-sidebar-backdrop")?.addEventListener("click", () => setMobileSidebarOpen(false));
window.addEventListener("keydown", event => {
  if (event.key === "Escape") setMobileSidebarOpen(false);
});
window.addEventListener("resize", () => {
  if (!window.matchMedia("(max-width: 760px)").matches) setMobileSidebarOpen(false);
});

function showAdminSection(section) {
  document.querySelectorAll("[data-admin-panel]").forEach(panel => panel.classList.toggle("hidden", panel.dataset.adminPanel !== section));
  document.querySelectorAll("[data-admin-section]").forEach(button => {
    const active = button.dataset.adminSection === section;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  setMobileSidebarOpen(false);
}
document.querySelectorAll("[data-admin-section]").forEach(button => button.addEventListener("click", () => showAdminSection(button.dataset.adminSection)));

async function loadProducts() {
  if (!supabase || !currentUser) return false;

  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    setStatus("No se pudo cargar el inventario: " + error.message, "error");
    return false;
  }

  products = (data || []).map(product => ({
    ...product,
    catalog_type: normalizeCatalogType(product.catalog_type),
    workflow_status: getProductWorkflowStatus(product),
    is_published: getProductWorkflowStatus(product) === "published",
    perfume_details: null
  }));

  const perfumeIds = products
    .filter(product => product.catalog_type === "perfumery")
    .map(product => product.id);

  if (perfumeIds.length) {
    const { data: perfumeDetails, error: perfumeError } = await supabase
      .from("perfume_details")
      .select("*")
      .in("product_id", perfumeIds);

    if (perfumeError) {
      console.warn("No se pudieron cargar los detalles de perfumería:", perfumeError.message);
      setStatus("Los productos cargaron, pero no se pudieron leer los detalles de perfumes. Revisá las políticas y los permisos de perfume_details.", "error");
    } else {
      const detailsById = new Map((perfumeDetails || []).map(item => [String(item.product_id), item]));
      products = products.map(product => ({
        ...product,
        perfume_details: detailsById.get(String(product.id)) || null
      }));
    }
  }

  updateProductFormMode();
  renderAdminList();
  renderDashboardOverview();
  await loadCatalogAnalytics();
  return true;
}
function formatAnalyticsCapacity(value) {
  const parsed = parseStorageValue(value);
  return parsed.amount ? formatStorageLabel(parsed.amount, parsed.unit) : "";
}

function renderAnalyticsRanking(node, rows, labelFor) {
  if (!node) return;
  if (!rows.length) {
    node.innerHTML = '<p class="dashboard-empty-state">Todavía no hay consultas con esta información.</p>';
    return;
  }
  const max = Math.max(...rows.map(row => row.count), 1);
  node.innerHTML = rows.map(row => {
    const label = escapeHtml(labelFor(row));
    const percentage = Math.max(3, Math.round((row.count / max) * 100));
    return `<div class="dashboard-interest-rank-row">
      <div class="dashboard-interest-rank-main">
        <strong title="${label}">${label}</strong>
        <span class="dashboard-interest-rank-track"><i style="width:${percentage}%"></i></span>
      </div>
      <b>${row.count.toLocaleString("es-NI")}</b>
    </div>`;
  }).join("");
}

function renderAnalyticsPie(node, legendNode, totalNode, rows) {
  if (!node || !legendNode) return;
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  if (totalNode) totalNode.textContent = total.toLocaleString("es-NI");
  if (!total) {
    node.style.background = "var(--interest-pie-empty)";
    node.setAttribute("aria-label", "Aún no hay clics de WhatsApp registrados.");
    legendNode.innerHTML = '<p class="dashboard-empty-state">El gráfico aparecerá cuando haya consultas por WhatsApp.</p>';
    node.classList.remove("is-animated");
    return;
  }

  const visibleRows = rows.slice(0, 5);
  const tailRows = rows.slice(5);
  if (tailRows.length) {
    visibleRows.push({
      label: "Otros",
      count: tailRows.reduce((sum, row) => sum + row.count, 0)
    });
  }
  const sum = visibleRows.reduce((acc, row) => acc + row.count, 0);
  let cumulative = 0;
  const stops = visibleRows.map((row, index) => {
    const startPercent = cumulative / sum * 100;
    cumulative += row.count;
    const endPercent = cumulative / sum * 100;
    return `var(--interest-slice-${index + 1}) ${startPercent.toFixed(2)}% ${endPercent.toFixed(2)}%`;
  });
  node.style.background = `conic-gradient(${stops.join(", ")})`;
  node.setAttribute("aria-label", `Distribución de ${sum} clics de WhatsApp por combinación solicitada.`);
  node.classList.remove("is-animated");
  void node.offsetWidth;
  node.classList.add("is-animated");

  legendNode.innerHTML = visibleRows.map((row, index) => {
    const percentage = Math.round((row.count / sum) * 100);
    return `<div class="dashboard-interest-legend-row">
      <i class="dashboard-interest-legend-dot interest-slice-${index + 1}" aria-hidden="true"></i>
      <span class="dashboard-interest-legend-label" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</span>
      <strong>${row.count.toLocaleString("es-NI")}</strong>
      <small>${percentage}%</small>
    </div>`;
  }).join("");
}

async function loadCatalogAnalytics() {
  const note = document.getElementById("dashboard-analytics-note");
  const topNode = document.getElementById("dashboard-top-products");
  const familyNode = document.getElementById("dashboard-interest-colors");
  const configNode = document.getElementById("dashboard-interest-configs");
  const pieNode = document.getElementById("dashboard-interest-pie");
  const legendNode = document.getElementById("dashboard-interest-legend");
  const pieTotalNode = document.getElementById("dashboard-interest-pie-total");
  const setText = (id, value) => { const node = document.getElementById(id); if (node) node.textContent = value; };

  const isAllCatalogs = dashboardCatalogScope === "all";
  const isPerfumeCatalog = dashboardCatalogScope === "perfumery";
  const catalogProducts = getDashboardProducts();
  const productsById = new Map(catalogProducts.map(product => [String(product.id), product]));

  setText("dashboard-interest-chart-title", isAllCatalogs
    ? "Qué productos consultan"
    : isPerfumeCatalog ? "Qué fragancias consultan" : "Qué versiones consultan");
  setText("dashboard-interest-family-eyebrow", isAllCatalogs ? "FAMILIA / CATEGORÍA" : isPerfumeCatalog ? "FAMILIA" : "COLOR");
  setText("dashboard-interest-family-title", isAllCatalogs
    ? "Intereses más consultados"
    : isPerfumeCatalog ? "Familias más consultadas" : "Colores más consultados");
  setText("dashboard-interest-config-eyebrow", isAllCatalogs ? "PRESENTACIÓN / VARIANTE" : isPerfumeCatalog ? "PERFIL OLFATIVO" : "RAM / ROM");
  setText("dashboard-interest-config-title", isAllCatalogs
    ? "Presentaciones y configuraciones"
    : isPerfumeCatalog ? "Concentraciones y tamaños" : "Configuraciones más pedidas");
  setText("dashboard-interest-products-title", isAllCatalogs
    ? "Productos con más interés · ambos catálogos"
    : isPerfumeCatalog ? "Fragancias con más interés" : "Teléfonos con más interés");

  if (!supabase || !currentUser) return;

  const { data, error } = await supabase.from("catalog_events")
    .select("product_id,event_type,created_at,variant_color,variant_ram,variant_storage")
    .order("created_at", { ascending: false }).limit(10000);
  if (error) {
    setText("dashboard-views-total", "—");
    setText("dashboard-whatsapp-total", "—");
    if (note) note.textContent = "No se pudieron cargar las estadísticas. Verificá las columnas de catalog_events y las políticas de lectura administrativa.";
    if (topNode) topNode.innerHTML = '<p class="dashboard-empty-state">No se pudieron cargar las estadísticas.</p>';
    if (familyNode) familyNode.innerHTML = '<p class="dashboard-empty-state">No disponibles hasta resolver la conexión.</p>';
    if (configNode) configNode.innerHTML = '<p class="dashboard-empty-state">No disponibles hasta resolver la conexión.</p>';
    renderAnalyticsPie(pieNode, legendNode, pieTotalNode, []);
    console.info("Analítica de catálogo no disponible:", error.message);
    return;
  }

  const catalogIds = new Set(catalogProducts.map(product => String(product.id)));
  const events = (data || []).filter(event => catalogIds.has(String(event.product_id)));
  const views = events.filter(event => event.event_type === "view");
  const clicks = events.filter(event => event.event_type === "whatsapp_click");
  setText("dashboard-views-total", views.length.toLocaleString("es-NI"));
  setText("dashboard-whatsapp-total", clicks.length.toLocaleString("es-NI"));

  if (note) {
    const scopeLabel = isAllCatalogs ? "ambos catálogos" : isPerfumeCatalog ? "JB Parfums" : "JB TECH";
    note.textContent = events.length
      ? "Eventos registrados para " + scopeLabel + ". Las visitas son aperturas de fichas, no personas únicas. Los clics expresan intención de consulta, no ventas confirmadas."
      : catalogProducts.length
        ? "Todavía no hay eventos para " + scopeLabel + ". Las estadísticas comenzarán cuando los clientes abran fichas o pulsen WhatsApp."
        : "Agregá productos a " + scopeLabel + " para comenzar a medir visitas y consultas.";
  }

  const byProduct = new Map();
  for (const event of events) {
    if (!event.product_id) continue;
    const stats = byProduct.get(String(event.product_id)) || { views: 0, clicks: 0 };
    if (event.event_type === "view") stats.views++;
    if (event.event_type === "whatsapp_click") stats.clicks++;
    byProduct.set(String(event.product_id), stats);
  }

  const rankedProducts = catalogProducts.filter(product => product.is_published).map(product => ({
    product, stats: byProduct.get(String(product.id)) || { views: 0, clicks: 0 }
  })).sort((a, b) => b.stats.views - a.stats.views || b.stats.clicks - a.stats.clicks).slice(0, 6);

  if (topNode) topNode.innerHTML = rankedProducts.length ? rankedProducts.map(({product, stats}, index) => {
    const name = escapeHtml(product.name || "Producto sin nombre");
    const type = normalizeCatalogType(product.catalog_type);
    const familyOrCategory = type === "perfumery"
      ? perfumeFamilyLabel(product.perfume_details && product.perfume_details.family)
      : (product.category || "Tecnología");
    const supportingLabel = isAllCatalogs
      ? (type === "perfumery" ? "JB Parfums · " : "JB TECH · ") + familyOrCategory
      : familyOrCategory;
    return '<div class="dashboard-top-product"><span class="dashboard-top-product-rank">' + (index + 1) + '</span><div class="dashboard-top-product-info"><strong>' + name + '</strong><small>' + escapeHtml(supportingLabel) + '</small></div><div class="dashboard-top-product-stats"><span>👁 <b>' + stats.views + '</b> visitas</span><span>↗ <b>' + stats.clicks + '</b> clics</span></div></div>';
  }).join("") : '<p class="dashboard-empty-state">Publicá productos para ver aquí su rendimiento.</p>';

  const rankedRows = counts => Array.from(counts, ([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "es")).slice(0, 5);
  const comboCounts = new Map();
  const familyCounts = new Map();
  const configCounts = new Map();

  // Classify each click from its product record so combined analytics don't mix perfume families with phone colors.
  for (const event of clicks) {
    const product = productsById.get(String(event.product_id));
    if (!product) continue;
    const type = normalizeCatalogType(product.catalog_type);
    const isPerfumeProduct = type === "perfumery";

    if (isPerfumeProduct) {
      const detail = product.perfume_details || {};
      const family = detail.family ? perfumeFamilyLabel(detail.family) : "";
      const concentration = String(detail.concentration || "").trim();
      const volume = detail.volume_ml !== null && detail.volume_ml !== undefined && detail.volume_ml !== ""
        ? Number(detail.volume_ml).toLocaleString("es-NI") + " ml" : "";
      const prefix = isAllCatalogs ? "JB Parfums · " : "";
      const comboLabel = [prefix + (product.name || "Fragancia"), family, concentration, volume].filter(Boolean).join(" · ");
      comboCounts.set(comboLabel, (comboCounts.get(comboLabel) || 0) + 1);
      if (family) {
        const familyLabel = prefix + family;
        familyCounts.set(familyLabel, (familyCounts.get(familyLabel) || 0) + 1);
      }
      const configLabel = [concentration, volume, detail.scent_family].filter(Boolean).join(" · ");
      if (configLabel) {
        const displayLabel = prefix + configLabel;
        configCounts.set(displayLabel, (configCounts.get(displayLabel) || 0) + 1);
      }
    } else {
      const color = String(event.variant_color || "").trim();
      const ram = String(event.variant_ram || "").trim();
      const storage = String(event.variant_storage || "").trim();
      const parts = [ram ? formatAnalyticsCapacity(ram) + " RAM" : "", storage ? formatAnalyticsCapacity(storage) : ""].filter(Boolean);
      const configurationLabel = parts.length ? parts.join(" / ") : "";
      const prefix = isAllCatalogs ? "JB TECH · " : "";
      const comboLabel = isAllCatalogs
        ? [prefix + (product.name || "Equipo"), configurationLabel, color].filter(Boolean).join(" · ") || "JB TECH · Sin variante registrada"
        : [configurationLabel, color].filter(Boolean).join(" · ") || "Sin variante registrada";
      comboCounts.set(comboLabel, (comboCounts.get(comboLabel) || 0) + 1);
      if (color) {
        const colorLabel = prefix + color;
        familyCounts.set(colorLabel, (familyCounts.get(colorLabel) || 0) + 1);
      }
      if (ram || storage) {
        const configLabel = [ram ? formatAnalyticsCapacity(ram) + " RAM" : "", storage ? formatAnalyticsCapacity(storage) : ""].filter(Boolean).join(" / ") || "Configuración estándar";
        const displayLabel = prefix + configLabel;
        configCounts.set(displayLabel, (configCounts.get(displayLabel) || 0) + 1);
      }
    }
  }

  const rankedCombos = Array.from(comboCounts, ([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "es"));
  renderAnalyticsPie(pieNode, legendNode, pieTotalNode, rankedCombos);
  renderAnalyticsRanking(familyNode, rankedRows(familyCounts), row => row.label);
  renderAnalyticsRanking(configNode, rankedRows(configCounts), row => row.label);
}
/* Actualizar actividad reciente y los indicadores a partir de los datos actuales. */
const dashboardActivityRefresh = document.getElementById("dashboard-activity-refresh");
dashboardActivityRefresh?.addEventListener("click", async () => {
  if (dashboardActivityRefresh.disabled) return;

  const status = document.getElementById("dashboard-activity-refresh-status");
  if (!supabase || !currentUser) {
    if (status) status.textContent = "Iniciá sesión para actualizar la actividad.";
    return;
  }

  dashboardActivityRefresh.disabled = true;
  dashboardActivityRefresh.classList.add("is-refreshing");
  dashboardActivityRefresh.setAttribute("aria-busy", "true");
  dashboardActivityRefresh.setAttribute("aria-label", "Actualizando actividad reciente");
  dashboardActivityRefresh.title = "Actualizando actividad…";
  if (status) status.textContent = "Actualizando actividad…";

  try {
    const refreshed = await loadProducts();
    if (status) {
      status.textContent = refreshed
        ? "Actividad actualizada."
        : "No se pudo actualizar la actividad. Revisá el aviso del panel.";
    }
  } catch (error) {
    if (status) status.textContent = "No se pudo actualizar la actividad. Revisá el aviso del panel.";
    console.warn("No se pudo actualizar la actividad reciente:", error);
  } finally {
    dashboardActivityRefresh.disabled = false;
    dashboardActivityRefresh.classList.remove("is-refreshing");
    dashboardActivityRefresh.removeAttribute("aria-busy");
    dashboardActivityRefresh.setAttribute("aria-label", "Actualizar actividad reciente");
    dashboardActivityRefresh.title = "Actualizar actividad reciente";
  }
});

function productNeedsMainImage(product) {
  const images = Array.isArray(product?.images) ? product.images : [];
  const gallery = Array.isArray(product?.gallery) ? product.gallery : [];
  return !(product?.image_url || product?.image || images.length || gallery.length);
}

function renderDashboardOverview() {
  const scopedProducts = getDashboardProducts();
  const catalogProducts = scopedProducts.filter(product => getProductWorkflowStatus(product) !== "trash");
  const published = catalogProducts.filter(product => getProductWorkflowStatus(product) === "published");
  const unpublished = catalogProducts.filter(product => getProductWorkflowStatus(product) === "unpublished");
  const drafts = catalogProducts.filter(product => getProductWorkflowStatus(product) === "draft");
  const trash = scopedProducts.filter(product => getProductWorkflowStatus(product) === "trash");
  const needsImage = catalogProducts.filter(productNeedsMainImage);
  const setText = (id, value) => { const node = document.getElementById(id); if (node) node.textContent = value; };
  const total = catalogProducts.length;
  const pendingPublication = unpublished.length + drafts.length;
  const percent = total ? Math.round((published.length / total) * 100) : 0;

  setText("dashboard-total", total);
  setText("dashboard-published", published.length);
  setText("dashboard-unpublished", unpublished.length);
  setText("dashboard-drafts", drafts.length);
  setText("dashboard-trash", trash.length);
  setText("dashboard-review", needsImage.length);
  setText("dashboard-chart-total", total);
  setText("dashboard-legend-published", published.length);
  setText("dashboard-legend-drafts", pendingPublication);
  setText("dashboard-task-drafts", drafts.length);
  setText("dashboard-task-unpublished", unpublished.length);
  setText("dashboard-task-images", needsImage.length);

  const updateTaskDescription = (action, items, emptyText, singular, plural) => {
    const node = document.querySelector('[data-dashboard-action="' + action + '"] small');
    if (!node) return;
    if (!items.length) {
      node.textContent = emptyText;
      return;
    }
    const catalogs = new Set(items.map(product => normalizeCatalogType(product.catalog_type)));
    const locationLabel = catalogs.size > 1 ? "ambos catálogos" : catalogs.has("perfumery") ? "JB Parfums" : "JB TECH";
    const countLabel = items.length === 1 ? singular : plural;
    node.textContent = dashboardCatalogScope === "all"
      ? items.length + " " + countLabel + " en " + locationLabel + " · tocá para revisar"
      : items.length + " " + countLabel + " en este catálogo · tocá para revisar";
  };
  updateTaskDescription("drafts", drafts, "No hay borradores en esta vista", "borrador", "borradores");
  updateTaskDescription("unpublished", unpublished, "No hay productos completos esperando publicación", "producto listo para publicar", "productos listos para publicar");

  const imagesTaskDescription = document.querySelector('[data-dashboard-action="review"] small');
  if (imagesTaskDescription) {
    if (!needsImage.length) {
      imagesTaskDescription.textContent = "No hay productos sin fotografía principal en esta vista";
    } else {
      const imageCatalogs = new Set(needsImage.map(product => normalizeCatalogType(product.catalog_type)));
      const locationLabel = imageCatalogs.size > 1 ? "ambos catálogos" : imageCatalogs.has("perfumery") ? "JB Parfums" : "JB TECH";
      const countLabel = needsImage.length === 1 ? "producto sin foto principal" : "productos sin foto principal";
      imagesTaskDescription.textContent = dashboardCatalogScope === "all"
        ? needsImage.length + " " + countLabel + " en " + locationLabel + " · tocá para completar"
        : needsImage.length + " " + countLabel + " · tocá para completar";
    }
  }

  setText("dashboard-publication-summary", total ? percent + "% del catálogo activo está publicado." : "Agregá tu primer producto para comenzar.");
  setText("dashboard-task-status", total ? "Inventario cargado correctamente" : "Todavía no hay productos fuera de la papelera");
  const ring = document.getElementById("dashboard-chart-ring");
  if (ring) ring.style.setProperty("--published-ratio", percent + "%");
  const progress = document.getElementById("dashboard-progress-published");
  if (progress) progress.style.width = percent + "%";
  const activity = document.getElementById("dashboard-activity-list");
  if (activity) {
    const recent = [...catalogProducts].sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0)).slice(0, 4);
    activity.innerHTML = recent.length ? recent.map(product => {
      const title = escapeHtml(product.name || "Producto sin nombre");
      const status = workflowStatusLabel(getProductWorkflowStatus(product));
      const catalogLabel = dashboardCatalogScope === "all"
        ? (normalizeCatalogType(product.catalog_type) === "perfumery" ? "JB Parfums · " : "JB TECH · ")
        : "";
      const dateValue = product.updated_at || product.created_at;
      const date = dateValue ? new Date(dateValue).toLocaleDateString("es-NI", { day: "2-digit", month: "short" }) : "Fecha no disponible";
      const state = getProductWorkflowStatus(product);
      const mark = state === "published" ? "✓" : state === "draft" ? "✎" : "▣";
      return '<div class="dashboard-activity-item"><span class="dashboard-activity-mark ' + (state === "published" ? "activity-mark-published" : "activity-mark-draft") + '">' + mark + '</span><div><strong>' + title + '</strong><small>' + escapeHtml(catalogLabel + status) + '</small></div><time>' + escapeHtml(date) + '</time></div>';
    }).join("") : '<p class="dashboard-empty-state">Todavía no hay actividad. Añadí un producto para comenzar.</p>';
  }
}

document.querySelectorAll("[data-dashboard-action]").forEach(button => {
  button.addEventListener("click", () => {
    const action = button.dataset.dashboardAction;
    const routeByAction = {
      published: { state: "published", section: "published", search: "published-search" },
      unpublished: { state: "unpublished", section: "unpublished", search: "unpublished-search" },
      drafts: { state: "draft", section: "drafts", search: "draft-search" },
      trash: { state: "trash", section: "trash", search: "trash-search" }
    };

    if (routeByAction[action]) {
      const route = routeByAction[action];
      const candidates = getDashboardProducts().filter(product => getProductWorkflowStatus(product) === route.state);
      const target = candidates.find(product => normalizeCatalogType(product.catalog_type) === activeCatalogType) || candidates[0];
      if (target && normalizeCatalogType(target.catalog_type) !== activeCatalogType) {
        setActiveCatalogType(normalizeCatalogType(target.catalog_type));
      }
      showAdminSection(route.section);
      const search = document.getElementById(route.search);
      if (search && target) {
        search.value = String(target.name || "");
        search.dispatchEvent(new Event("input"));
      }
      return;
    }

    if (action === "review") {
      const candidates = getDashboardProducts().filter(product =>
        getProductWorkflowStatus(product) !== "trash" && productNeedsMainImage(product)
      );
      const target = candidates.find(product => normalizeCatalogType(product.catalog_type) === activeCatalogType) || candidates[0];
      if (target && normalizeCatalogType(target.catalog_type) !== activeCatalogType) {
        setActiveCatalogType(normalizeCatalogType(target.catalog_type));
      }
      const status = target ? getProductWorkflowStatus(target) : "published";
      const section = status === "draft" ? "drafts" : status === "unpublished" ? "unpublished" : "published";
      const searchId = section === "drafts" ? "draft-search" : section === "unpublished" ? "unpublished-search" : "published-search";
      showAdminSection(section);
      const search = document.getElementById(searchId);
      if (search && target) {
        search.value = String(target.name || "");
        search.dispatchEvent(new Event("input"));
      }
      return;
    }

    showAdminSection(action === "add" ? "add" : action);
  });
});


/* =========================================================
   VISTA DE CONSULTA DEL PRODUCTO (solo lectura)
   ========================================================= */
const productPreviewDialog = $("#admin-product-preview-dialog");
const productPreviewContent = $("#admin-product-preview-content");

function previewMoney(value, currency) {
  if (value === null || value === undefined || value === "") return "Consultar";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "Consultar";
  const formatted = amount.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return (currency === "NIO" ? "C$" : "US$") + formatted;
}

function previewAvailability(value) {
  const normalized = String(value || "").trim().toLocaleLowerCase("es");
  if (["order", "on_order", "por pedido"].includes(normalized)) return "Por pedido";
  if (["out_of_stock", "unavailable", "no disponible", "agotado", "agotado temporalmente"].includes(normalized)) return "Agotado temporalmente";
  return "Disponible";
}

function previewUniqueImages(values) {
  return [...new Set((values || [])
    .filter(value => typeof value === "string")
    .map(value => value.trim())
    .filter(Boolean))];
}

function previewOpenPerfumeProduct(product) {
  if (!productPreviewDialog || !productPreviewContent) return;
  const detail = product.perfume_details || {};
  const images = previewUniqueImages(getImages(product));
  const title = escapeHtml(product.name || "Fragancia sin nombre");
  const family = perfumeFamilyLabel(detail.family);
  const concentration = String(detail.concentration || "").trim();
  const volume = detail.volume_ml !== null && detail.volume_ml !== undefined && detail.volume_ml !== ""
    ? Number(detail.volume_ml).toLocaleString("es-NI") + " ml"
    : "No especificado";
  const notes = (label, values) => {
    const entries = Array.isArray(values) ? values : [];
    return '<section class="admin-preview-note-group"><h4>' + label + '</h4>' +
      (entries.length
        ? '<ul class="admin-preview-spec-list">' + entries.map(value => '<li>' + escapeHtml(value) + '</li>').join("") + '</ul>'
        : '<p class="admin-preview-muted">Sin notas registradas.</p>') +
      '</section>';
  };
  const gallery = images.length
    ? '<div class="admin-preview-gallery-main"><img id="admin-preview-hero-image" src="' + escapeHtml(images[0]) + '" alt="' + title + '" loading="eager"></div>' +
      (images.length > 1
        ? '<div class="admin-preview-gallery-thumbs" aria-label="Fotografías de la fragancia">' +
          images.map((url, index) => '<button class="admin-preview-thumb ' + (index === 0 ? "is-active" : "") + '" type="button" data-preview-image="' + escapeHtml(url) + '" data-preview-alt="' + title + ' · fotografía ' + (index + 1) + '" aria-label="Ver fotografía ' + (index + 1) + '"><img src="' + escapeHtml(url) + '" alt="" loading="lazy"></button>').join("") +
        '</div>' : "")
    : '<div class="admin-preview-photo-placeholder"><span aria-hidden="true">▧</span><span>Sin fotografía</span></div>';
  const price = previewMoney(product.price_usd, "USD");
  const priceNio = previewMoney(product.price_nio, "NIO");
  const notesList = detail.scent_family ? '<p class="admin-preview-brand-model">Familia olfativa: ' + escapeHtml(detail.scent_family) + '</p>' : "";

  productPreviewContent.innerHTML =
    '<div class="admin-preview-layout">' +
      '<section class="admin-preview-media">' + gallery + '<div class="admin-preview-image-count">' + images.length + ' fotografía(s)</div></section>' +
      '<section class="admin-preview-overview">' +
        '<div class="admin-preview-title-row"><div><p class="admin-preview-eyebrow">' + escapeHtml(product.category || "Perfumería") + '</p><h3>' + title + '</h3>' +
          (product.brand ? '<p class="admin-preview-brand-model">' + escapeHtml(product.brand) + '</p>' : '') +
        '</div><span class="admin-preview-publish-state ' + (product.is_published ? "published" : "draft") + '">' + (product.is_published ? "Publicado" : "No publicado") + '</span></div>' +
        '<div class="admin-preview-price-summary"><span>Precio</span><strong>' + escapeHtml(price) + '</strong><small>' + escapeHtml(priceNio) + '</small></div>' +
        '<dl class="admin-preview-facts">' +
          '<div><dt>Familia</dt><dd>' + escapeHtml(family) + '</dd></div>' +
          '<div><dt>Concentración</dt><dd>' + escapeHtml(concentration || "No especificada") + '</dd></div>' +
          '<div><dt>Contenido</dt><dd>' + escapeHtml(volume) + '</dd></div>' +
          '<div><dt>Público</dt><dd>' + escapeHtml(detail.audience || "No especificado") + '</dd></div>' +
          '<div><dt>Original</dt><dd>' + (detail.is_original === true ? "Confirmado" : detail.is_original === false ? "No confirmado" : "No especificado") + '</dd></div>' +
          '<div><dt>Disponibilidad</dt><dd>' + escapeHtml(previewAvailability(product.availability)) + '</dd></div>' +
        '</dl>' +
        notesList +
        '<div class="admin-preview-description"><h4>Descripción</h4><p>' + escapeHtml(product.description || "Sin descripción registrada.") + '</p></div>' +
      '</section>' +
    '</div>' +
    '<section class="admin-preview-section"><h3>Notas olfativas</h3><div class="admin-preview-notes">' +
      notes("Salida", detail.top_notes) + notes("Corazón", detail.heart_notes) + notes("Fondo", detail.base_notes) +
    '</div></section>';
  if (typeof productPreviewDialog.showModal === "function") {
    if (!productPreviewDialog.open) productPreviewDialog.showModal();
  } else {
    productPreviewDialog.setAttribute("open", "open");
  }
}

function previewOpenProduct(product) {
  if (!productPreviewDialog || !productPreviewContent || !product) return;
  if (normalizeCatalogType(product.catalog_type) === "perfumery") {
    previewOpenPerfumeProduct(product);
    return;
  }

  const allVariants = normalizeVariants(product.variants);
  const variants = allVariants.length ? allVariants : legacyVariants(product);
  const hasTechnicalConfigurations = variants.some(variant => variant.storage || variant.ram);
  const mainImages = previewUniqueImages(getImages(product));
  const variantImages = previewUniqueImages(variants.flatMap(variant => [
    ...(Array.isArray(variant.images) ? variant.images : []),
    variant.image_url
  ]));
  const galleryImages = mainImages.length ? mainImages : variantImages;
  const heroUrl = galleryImages[0] || "";
  const title = escapeHtml(product.name || "Producto sin nombre");
  const brandModel = [product.brand, product.model].filter(Boolean).map(value => String(value).trim()).filter(Boolean).join(" · ");
  const publishedLabel = product.is_published ? "Publicado" : "No publicado";
  const availabilityLabel = previewAvailability(product.availability);
  const warranty = product.warranty_months === null || product.warranty_months === undefined || product.warranty_months === ""
    ? "No especificada"
    : escapeHtml(product.warranty_months) + " meses";

  const numericPrices = variants.map(variant => variant.price_usd).filter(value => typeof value === "number" && Number.isFinite(value));
  const previewPrice = numericPrices.length
    ? previewMoney(Math.min(...numericPrices), "USD")
    : previewMoney(product.price_usd, "USD");
  const previewPriceNio = product.price_nio !== null && product.price_nio !== undefined && product.price_nio !== ""
    ? previewMoney(product.price_nio, "NIO")
    : "";
  const specsTextValue = specsText(product.specifications);
  const specLines = String(specsTextValue || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const specsMarkup = specLines.length
    ? '<ul class="admin-preview-spec-list">' + specLines.map(line => "<li>" + escapeHtml(line) + "</li>").join("") + "</ul>"
    : '<p class="admin-preview-muted">Sin especificaciones registradas.</p>';

  const galleryMarkup = heroUrl
    ? '<div class="admin-preview-gallery-main"><img id="admin-preview-hero-image" src="' + escapeHtml(heroUrl) + '" alt="' + title + '" loading="eager"></div>' +
      (galleryImages.length > 1
        ? '<div class="admin-preview-gallery-thumbs" aria-label="Fotografías generales">' +
          galleryImages.map((url, index) =>
            '<button class="admin-preview-thumb ' + (index === 0 ? "is-active" : "") + '" type="button" data-preview-image="' + escapeHtml(url) + '" data-preview-alt="' + title + ' · fotografía ' + (index + 1) + '" aria-label="Ver fotografía ' + (index + 1) + '">' +
              '<img src="' + escapeHtml(url) + '" alt="" loading="lazy">' +
            '</button>'
          ).join("") +
        '</div>'
        : "")
    : '<div class="admin-preview-photo-placeholder"><span aria-hidden="true">▧</span><span>Sin fotografía</span></div>';

  const groups = new Map();
  variants.forEach(variant => {
    const storage = String(variant.storage || "").trim();
    const ram = String(variant.ram || "").trim();
    const key = storage.toLocaleLowerCase("es") + "|" + ram.toLocaleLowerCase("es");
    if (!groups.has(key)) {
      const label = storage && ram ? storage + " / " + ram : storage || ram ||
        (hasTechnicalConfigurations ? "Colores base (sin capacidad específica)" : "Configuración estándar");
      groups.set(key, { label, storage, ram, items: [] });
    }
    groups.get(key).items.push(variant);
  });

  const variantsMarkup = groups.size
    ? Array.from(groups.values()).map(group => {
        const cards = group.items.map(variant => {
          const images = previewUniqueImages([
            ...(Array.isArray(variant.images) ? variant.images : []),
            variant.image_url
          ]);
          const swatch = validHex(variant.color_hex);
          const status = previewAvailability(variant.availability);
          const statusClass = status === "Disponible" ? "available" : status === "Por pedido" ? "order" : "unavailable";
          const priceUSD = previewMoney(variant.price_usd ?? product.price_usd, "USD");
          const priceNIO = previewMoney(variant.price_nio ?? product.price_nio, "NIO");
          const photoMarkup = images.length
            ? '<div class="admin-preview-variant-photos">' + images.map((url, index) =>
                '<button class="admin-preview-variant-thumb" type="button" data-preview-image="' + escapeHtml(url) + '" data-preview-alt="' + escapeHtml(product.name || "Producto") + ' · ' + escapeHtml(variant.color || "Variante") + ' · fotografía ' + (index + 1) + '" aria-label="Ver foto ' + (index + 1) + ' de ' + escapeHtml(variant.color || "variante") + '">' +
                  '<img src="' + escapeHtml(url) + '" alt="" loading="lazy">' +
                '</button>'
              ).join("") + '</div>'
            : '<p class="admin-preview-muted admin-preview-no-photos">Sin fotografías para esta variante.</p>';
          return '<article class="admin-preview-variant-card">' +
            '<div class="admin-preview-variant-heading">' +
              '<span class="admin-preview-color-dot" style="--preview-swatch:' + swatch + '" aria-hidden="true"></span>' +
              '<div class="admin-preview-variant-color"><strong>' + escapeHtml(variant.color || "Color sin nombre") + '</strong><small>' + escapeHtml(variant.color_hex || swatch) + '</small></div>' +
              '<span class="admin-preview-status ' + statusClass + '">' + escapeHtml(status) + '</span>' +
            '</div>' +
            '<div class="admin-preview-variant-prices"><span><small>Precio USD</small><strong>' + escapeHtml(priceUSD) + '</strong></span><span><small>Precio córdobas</small><strong>' + escapeHtml(priceNIO) + '</strong></span></div>' +
            photoMarkup +
          '</article>';
        }).join("");
        return '<section class="admin-preview-config-group"><h4>' + escapeHtml(group.label) + '</h4><div class="admin-preview-variant-grid">' + cards + '</div></section>';
      }).join("")
    : '<p class="admin-preview-muted">Este producto no tiene variantes registradas.</p>';

  const description = String(product.description || "").trim();
  const financing = String(product.financing_note || "").trim();
  const shipping = String(product.shipping_note || "").trim();

  productPreviewContent.innerHTML =
    '<div class="admin-preview-layout">' +
      '<section class="admin-preview-media">' +
        galleryMarkup +
        '<div class="admin-preview-image-count">' + galleryImages.length + ' fotografía(s) generales</div>' +
      '</section>' +
      '<section class="admin-preview-overview">' +
        '<div class="admin-preview-title-row"><div><p class="admin-preview-eyebrow">' + escapeHtml(product.category || "Sin categoría") + '</p><h3>' + title + '</h3>' +
          (brandModel ? '<p class="admin-preview-brand-model">' + escapeHtml(brandModel) + '</p>' : '') +
        '</div><span class="admin-preview-publish-state ' + (product.is_published ? "published" : "draft") + '">' + publishedLabel + '</span></div>' +
        '<div class="admin-preview-price-summary"><span>Precio desde</span><strong>' + escapeHtml(previewPrice) + '</strong>' +
          (previewPriceNio ? '<small>' + escapeHtml(previewPriceNio) + '</small>' : '') +
        '</div>' +
        '<dl class="admin-preview-facts">' +
          '<div><dt>Disponibilidad</dt><dd>' + escapeHtml(availabilityLabel) + '</dd></div>' +
          '<div><dt>Garantía</dt><dd>' + warranty + '</dd></div>' +
          '<div><dt>Variantes</dt><dd>' + variants.length + '</dd></div>' +
          '<div><dt>Destacado</dt><dd>' + (product.featured ? "Sí" : "No") + '</dd></div>' +
        '</dl>' +
        '<div class="admin-preview-description"><h4>Descripción</h4><p>' + escapeHtml(description || "Sin descripción adicional.") + '</p></div>' +
      '</section>' +
    '</div>' +
    '<section class="admin-preview-section"><h3>Especificaciones</h3>' + specsMarkup + '</section>' +
    '<section class="admin-preview-section"><h3>Variantes, colores y fotografías</h3>' + variantsMarkup + '</section>' +
    '<section class="admin-preview-notes">' +
      '<div><h4>Financiamiento</h4><p>' + escapeHtml(financing || "Sin nota de financiamiento.") + '</p></div>' +
      '<div><h4>Entrega</h4><p>' + escapeHtml(shipping || "Sin nota de entrega.") + '</p></div>' +
    '</section>';

  if (typeof productPreviewDialog.showModal === "function") {
    if (!productPreviewDialog.open) productPreviewDialog.showModal();
  } else {
    productPreviewDialog.setAttribute("open", "open");
  }
}

productPreviewDialog?.addEventListener("click", event => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("[data-close-product-preview]")) {
    if (productPreviewDialog.open && typeof productPreviewDialog.close === "function") productPreviewDialog.close();
    else productPreviewDialog.removeAttribute("open");
    return;
  }
  if (event.target === productPreviewDialog) {
    if (productPreviewDialog.open && typeof productPreviewDialog.close === "function") productPreviewDialog.close();
    else productPreviewDialog.removeAttribute("open");
    return;
  }
  const thumbnail = target?.closest("[data-preview-image]");
  if (!thumbnail) return;
  const hero = productPreviewContent.querySelector("#admin-preview-hero-image");
  if (hero) {
    hero.src = thumbnail.dataset.previewImage;
    hero.alt = thumbnail.dataset.previewAlt || "Fotografía del producto";
  }
  productPreviewDialog.querySelectorAll("[data-preview-image]").forEach(button => {
    button.classList.toggle("is-active", button === thumbnail);
  });
});

function collectProductStoragePaths(product) {
  const bucket = String(CONFIG.storageBucket || "product-images").trim();
  let storageOrigin = "";
  try { storageOrigin = new URL(CONFIG.supabaseUrl).origin; } catch { return []; }
  const publicPrefix = "/storage/v1/object/public/" + bucket + "/";
  const paths = new Set();
  const visit = value => {
    if (typeof value === "string") {
      if (!value.startsWith("https://") && !value.startsWith("http://")) return;
      try {
        const imageUrl = new URL(value);
        if (imageUrl.origin !== storageOrigin || !imageUrl.pathname.startsWith(publicPrefix)) return;
        const encodedPath = imageUrl.pathname.slice(publicPrefix.length);
        const path = encodedPath.split("/").map(part => {
          try { return decodeURIComponent(part); } catch { return part; }
        }).join("/");
        if (!path || path.split("/").some(part => part === "." || part === "..")) return;
        paths.add(path);
      } catch { /* Ignorar URL malformada. */ }
      return;
    }
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(product);
  return [...paths];
}

async function moveProductToTrash(product) {
  if (!supabase || !currentUser) throw new Error("La sesión administrativa no está disponible.");
  const previousStatus = getProductWorkflowStatus(product);
  if (previousStatus === "trash") return;
  const now = new Date().toISOString();
  const { data, error } = await supabase.from("products").update({
    workflow_status: "trash",
    is_published: false,
    deleted_at: now,
    trash_previous_status: previousStatus,
    updated_at: now,
    updated_by: currentUser.id
  }).eq("id", product.id).select("id");
  if (error) throw error;
  if (!Array.isArray(data) || !data.some(row => String(row.id) === String(product.id))) {
    throw new Error("Supabase no confirmó el envío a la papelera.");
  }
}

async function restoreProductFromTrash(product) {
  if (!supabase || !currentUser) throw new Error("La sesión administrativa no está disponible.");
  const previous = ["draft", "unpublished", "published"].includes(product.trash_previous_status)
    ? product.trash_previous_status
    : "unpublished";
  const { data, error } = await supabase.from("products").update({
    workflow_status: previous,
    is_published: previous === "published",
    deleted_at: null,
    trash_previous_status: null,
    updated_at: new Date().toISOString(),
    updated_by: currentUser.id
  }).eq("id", product.id).select("id");
  if (error) throw error;
  if (!Array.isArray(data) || !data.some(row => String(row.id) === String(product.id))) {
    throw new Error("Supabase no confirmó la restauración.");
  }
  return previous;
}

async function archiveProductAnalytics(product) {
  const { data: events, error } = await supabase
    .from("catalog_events")
    .select("*")
    .eq("product_id", product.id);
  if (error) {
    if (/404|not found|does not exist|PGRST205/i.test(String(error.message || ""))) return 0;
    throw new Error("No se pudieron leer las estadísticas del producto: " + error.message);
  }
  if (!events?.length) return 0;

  const archivedAt = new Date().toISOString();
  const rows = events.map(event => ({
    ...event,
    archived_product_name: product.name || "Producto eliminado",
    archived_catalog_type: product.catalog_type || "technology",
    archived_at: archivedAt
  }));
  const { error: archiveError } = await supabase
    .from("catalog_events_archive")
    .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
  if (archiveError) {
    throw new Error("No se pudo preservar el historial de consultas; el producto no se eliminará. " + archiveError.message);
  }

  const { error: deleteEventsError } = await supabase
    .from("catalog_events")
    .delete()
    .eq("product_id", product.id);
  if (deleteEventsError) {
    throw new Error("El historial se archivó, pero no se pudieron desvincular sus eventos: " + deleteEventsError.message);
  }
  return events.length;
}

async function permanentlyDeleteProduct(product) {
  if (!supabase || !currentUser) throw new Error("La sesión administrativa no está disponible.");
  const bucket = String(CONFIG.storageBucket || "product-images");
  const imagePaths = collectProductStoragePaths(product);

  // Register potential cleanup before removing the database row. The cron skips
  // queued files while their source product still exists, so a failed DB delete
  // cannot erase images for a product that remains in the trash.
  if (imagePaths.length) {
    const queueRows = imagePaths.map(object_path => ({
      bucket,
      object_path,
      source_product_id: String(product.id),
      attempts: 0,
      last_attempt_at: null,
      last_error: "Esperando confirmación de eliminación definitiva del producto."
    }));
    const { error: queueError } = await supabase
      .from("storage_cleanup_queue")
      .upsert(queueRows, { onConflict: "bucket,object_path" });
    if (queueError) {
      throw new Error("No se pudo preparar la limpieza segura de fotografías. El producto permanece en la papelera. " + queueError.message);
    }
  }

  const archivedEvents = await archiveProductAnalytics(product);

  const { error: detailError } = await supabase
    .from("perfume_details")
    .delete()
    .eq("product_id", product.id);
  if (detailError && !/404|not found|does not exist|PGRST205/i.test(String(detailError.message || ""))) {
    throw new Error("No se pudieron eliminar los detalles relacionados de perfumería: " + detailError.message);
  }

  const { data, error } = await supabase
    .from("products")
    .delete()
    .eq("id", product.id)
    .select("id");
  if (error) {
    throw new Error("La base de datos impidió la eliminación definitiva. El producto permanece en la papelera; revisá sus relaciones: " + error.message);
  }
  if (!Array.isArray(data) || !data.some(row => String(row.id) === String(product.id))) {
    throw new Error("Supabase no confirmó la eliminación definitiva.");
  }

  let storageErrorMessage = "";
  if (imagePaths.length) {
    const { error: storageError } = await supabase.storage.from(bucket).remove(imagePaths);
    if (storageError) {
      storageErrorMessage = String(storageError.message || "Error de Storage sin detalle.");
      const { error: queueUpdateError } = await supabase
        .from("storage_cleanup_queue")
        .update({
          attempts: 1,
          last_attempt_at: new Date().toISOString(),
          last_error: storageErrorMessage.slice(0, 1000)
        })
        .eq("source_product_id", String(product.id))
        .eq("bucket", bucket);
      if (queueUpdateError) {
        // The pre-created queue entry is still safe: the cron will now see that
        // the product row is gone and retry this object on a future run.
        console.warn("No se pudo actualizar la cola de fotografías; el reintento sigue registrado.", queueUpdateError.message);
      }
    } else {
      const { error: queueDeleteError } = await supabase
        .from("storage_cleanup_queue")
        .delete()
        .eq("source_product_id", String(product.id))
        .eq("bucket", bucket);
      if (queueDeleteError) {
        console.warn("Las fotografías se eliminaron, pero quedaron filas de cola que la siguiente ejecución intentará limpiar.", queueDeleteError.message);
      }
    }
  }

  return { imageCount: imagePaths.length, archivedEvents, storageErrorMessage };
}

function renderAdminList() {
  const catalogProducts = getActiveCatalogProducts();
  const byState = state => catalogProducts.filter(product => getProductWorkflowStatus(product) === state);
  const published = byState("published");
  const unpublished = byState("unpublished");
  const drafts = byState("draft");
  const trash = byState("trash");
  const searchable = product => [
    product.name, product.brand, product.model, product.category,
    product.perfume_details && product.perfume_details.scent_family
  ].join(" ").toLocaleLowerCase("es");
  const filter = (items, selector) => {
    const query = ($(selector)?.value || "").trim().toLocaleLowerCase("es");
    return items.filter(product => searchable(product).includes(query));
  };
  const cards = (items, emptyText, state) => items.map(product => {
    const image = getImages(product)[0];
    const thumb = image
      ? '<img class="admin-product-thumb" src="' + escapeHtml(image) + '" alt="" loading="lazy">'
      : '<div class="admin-product-thumb" style="display:grid;place-items:center;color:#9aa6b9">▧</div>';
    const variants = normalizeVariants(product.variants);
    const isPerfume = product.catalog_type === "perfumery";
    const detail = product.perfume_details || {};
    const variantLabel = isPerfume
      ? [detail.family ? perfumeFamilyLabel(detail.family) : "", detail.concentration, detail.volume_ml ? detail.volume_ml + " ml" : ""].filter(Boolean).join(" · ")
      : variants.length ? variants.length + " variante" + (variants.length === 1 ? "" : "s") : "";
    const price = minimumPrice(variants, "price_usd") ?? product.price_usd;
    const formattedPrice = price === null || price === undefined || price === ""
      ? "Consultar"
      : "US$" + Number(price).toLocaleString("en-US", { maximumFractionDigits: 2 });
    const status = getProductWorkflowStatus(product);
    const stateBadge = '<span class="admin-product-state-badge state-' + status + '">' + escapeHtml(workflowStatusLabel(status)) + '</span>';
    let actions = '';
    if (state === "trash") {
      actions =
        '<button class="admin-mini-button admin-icon-button action-restore" type="button" data-restore-product="' + escapeHtml(product.id) + '" aria-label="Restaurar producto" title="Restaurar producto"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"></path><path d="M3 3v5h5M8 12l3 3 5-6"></path></svg></button>' +
        '<button class="admin-mini-button admin-icon-button danger" type="button" data-permanent-delete-product="' + escapeHtml(product.id) + '" aria-label="Eliminar definitivamente" title="Eliminar definitivamente"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6M10 10v6M14 10v6"></path></svg></button>';
    } else {
      actions =
        '<button class="admin-mini-button admin-icon-button admin-preview-open-button" type="button" data-preview-product="' + escapeHtml(product.id) + '" aria-label="Ver producto" title="Ver producto"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"></path><circle cx="12" cy="12" r="3"></circle></svg></button>' +
        '<button class="admin-mini-button admin-icon-button" type="button" data-edit="' + escapeHtml(product.id) + '" aria-label="Editar producto" title="Editar producto"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m15 5 4 4M4 20l4.2-.8L19 8.4a2.1 2.1 0 0 0-3-3L5.2 16.2 4 20Z"></path></svg></button>';
      if (state === "published") {
        actions += '<button class="admin-mini-button admin-icon-button action-unpublish" type="button" data-toggle-publication="' + escapeHtml(product.id) + '" aria-label="Despublicar producto" title="Despublicar producto"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m3 3 18 18M2 12s3.6-7 10-7c2 0 3.7.6 5.2 1.5M6.2 6.2C3.5 8 2 12 2 12s3.6 7 10 7a10.8 10.8 0 0 0 4.1-.8"></path></svg></button>';
      } else if (state === "unpublished") {
        actions += '<button class="admin-mini-button admin-icon-button action-publish" type="button" data-toggle-publication="' + escapeHtml(product.id) + '" aria-label="Publicar producto" title="Publicar producto"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"></path><path d="m8 12 2.5 2.5L16 9"></path></svg></button>';
      }
      actions += '<button class="admin-mini-button admin-icon-button danger" type="button" data-move-to-trash="' + escapeHtml(product.id) + '" aria-label="Mover a la papelera" title="Mover a la papelera (15 días para recuperar)"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6M10 10v6M14 10v6"></path></svg></button>';
    }
    return '<article class="admin-product-row">' + thumb + '<div><div class="admin-product-name-line"><p class="admin-product-name">' + escapeHtml(product.name || "Producto sin nombre") + '</p>' + stateBadge + '</div><div class="admin-product-meta">' + escapeHtml(product.category || "Sin categoría") + ' · ' + escapeHtml(formattedPrice) + (variantLabel ? ' · ' + escapeHtml(variantLabel) : '') + '</div><div class="admin-product-buttons">' + actions + '</div></div></article>';
  }).join("") || '<p class="form-status">' + escapeHtml(emptyText) + '</p>';

  $("#published-product-list").innerHTML = cards(filter(published, "#published-search"), "Todavía no hay productos publicados.", "published");
  $("#unpublished-product-list").innerHTML = cards(filter(unpublished, "#unpublished-search"), "No hay productos completos esperando publicación.", "unpublished");
  $("#draft-product-list").innerHTML = cards(filter(drafts, "#draft-search"), "No hay borradores guardados en Supabase.", "draft");
  $("#trash-product-list").innerHTML = cards(filter(trash, "#trash-search"), "La papelera está vacía.", "trash");

  $("#published-count").textContent = published.length + (published.length === 1 ? " producto publicado" : " productos publicados");
  $("#unpublished-count").textContent = unpublished.length + (unpublished.length === 1 ? " producto completo sin publicar" : " productos completos sin publicar");
  $("#draft-count").textContent = drafts.length + (drafts.length === 1 ? " borrador" : " borradores");
  $("#trash-count").textContent = trash.length + (trash.length === 1 ? " producto en papelera · recuperación durante 15 días" : " productos en papelera · recuperación durante 15 días");
  $("#published-nav-count").textContent = published.length;
  $("#unpublished-nav-count").textContent = unpublished.length;
  $("#draft-nav-count").textContent = drafts.length;
  $("#trash-nav-count").textContent = trash.length;
}

["published-search", "unpublished-search", "draft-search", "trash-search"].forEach(id => {
  document.getElementById(id)?.addEventListener("input", renderAdminList);
});

document.querySelectorAll("#published-product-list, #unpublished-product-list, #draft-product-list, #trash-product-list").forEach(list => {
  list.addEventListener("click", async event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const previewButton = target.closest("[data-preview-product]");
    const editButton = target.closest("[data-edit]");
    const publishButton = target.closest("[data-toggle-publication]");
    const trashButton = target.closest("[data-move-to-trash]");
    const restoreButton = target.closest("[data-restore-product]");
    const permanentButton = target.closest("[data-permanent-delete-product]");

    if (previewButton) {
      const product = products.find(item => String(item.id) === String(previewButton.dataset.previewProduct));
      if (product) previewOpenProduct(product);
      return;
    }
    if (editButton) {
      const product = products.find(item => String(item.id) === String(editButton.dataset.edit));
      if (product) {
        fillEditor(product);
        showAdminSection("add");
      }
      return;
    }

    const actionButton = publishButton || trashButton || restoreButton || permanentButton;
    if (!actionButton) return;
    const productId = actionButton.dataset.togglePublication || actionButton.dataset.moveToTrash
      || actionButton.dataset.restoreProduct || actionButton.dataset.permanentDeleteProduct;
    const product = products.find(item => String(item.id) === String(productId));
    if (!product || !currentUser || !supabase) {
      setStatus("No se pudo identificar el producto o la sesión administrativa venció.", "error");
      return;
    }
    actionButton.disabled = true;

    try {
      if (publishButton) {
        const nextStatus = getProductWorkflowStatus(product) === "published" ? "unpublished" : "published";
        const { data, error } = await supabase.from("products").update({
          workflow_status: nextStatus,
          is_published: nextStatus === "published",
          updated_at: new Date().toISOString(),
          updated_by: currentUser.id
        }).eq("id", product.id).select("id");
        if (error) throw error;
        if (!Array.isArray(data) || !data.some(row => String(row.id) === String(product.id))) {
          throw new Error("Supabase no confirmó el cambio de publicación.");
        }
        setStatus(nextStatus === "published" ? "Producto publicado." : "Producto guardado como no publicado.", "success");
      } else if (trashButton) {
        const status = getProductWorkflowStatus(product);
        const deadline = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
        const details = "El producto dejará de mostrarse en el catálogo y podrás restaurarlo durante 15 días, hasta aproximadamente el " +
          deadline.toLocaleDateString("es-NI") + ".";
        if (!window.confirm("¿Mover \"" + String(product.name || "este producto") + "\" a la papelera?\n\n" + details)) return;
        await moveProductToTrash(product);
        if (String($("#product-id")?.value || "") === String(product.id)) {
          if (editorIsDirty && !window.confirm("El producto está abierto en el formulario. ¿También querés descartar los cambios sin guardar?")) {
            await restoreProductFromTrash({ ...product, workflow_status: "trash", trash_previous_status: status });
            await loadProducts();
            return;
          }
          await recoveryAction("readwrite", store => store.delete(RECOVERY_KEY)).catch(() => {});
          clearEditor();
        }
        setStatus("Producto movido a la papelera. Se puede restaurar durante 15 días.", "success");
      } else if (restoreButton) {
        if (!window.confirm("¿Restaurar \"" + String(product.name || "este producto") + "\" a su estado anterior?")) return;
        const previous = await restoreProductFromTrash(product);
        setStatus("Producto restaurado como: " + workflowStatusLabel(previous) + ".", "success");
      } else if (permanentButton) {
        if (!window.confirm("¿Eliminar definitivamente \"" + String(product.name || "este producto") + "\"?\n\nSe borrarán el registro del producto, sus detalles y las fotografías. Se conservará el historial agregado de consultas. Esta acción no se puede deshacer.")) return;
        const result = await permanentlyDeleteProduct(product);
        if (String($("#product-id")?.value || "") === String(product.id)) {
          await recoveryAction("readwrite", store => store.delete(RECOVERY_KEY)).catch(() => {});
          clearEditor();
        }
        setStatus("Producto eliminado definitivamente. Historial archivado: " + result.archivedEvents + " eventos; fotografías procesadas: " + result.imageCount + ".", "success");
      }

      await loadProducts();
    } catch (error) {
      setStatus("No se pudo completar la acción: " + String(error.message || error), "error");
      actionButton.disabled = false;
    }
  });
});


/* =========================================================
   PROTECCIÓN ANTE RECARGA CON CAMBIOS SIN GUARDAR
   ========================================================= */

let editorBaseline = "";
let editorIsDirty = false;

function getEditorSnapshot(){
 if(!form)return "";
 const fields=Array.from(form.elements).map(f=>{if(!f||(!f.name&&!f.id&&!f.matches?.("[data-variant-row],[data-variant-group]")))return null;if(f.type==="file")return [f.id||f.getAttribute("data-variant-image")||"file",Array.from(f.files||[]).map(x=>[x.name,x.size,x.lastModified])];if(f.type==="checkbox"||f.type==="radio")return [f.id||f.name,f.checked];return [f.id||f.name||f.getAttribute("data-variant-color")||f.getAttribute("data-group-storage")||f.getAttribute("data-group-ram")||f.getAttribute("data-group-price-usd")||f.getAttribute("data-group-price-nio")||f.getAttribute("data-variant-availability")||f.getAttribute("data-variant-image-url")||f.tagName,f.value];}).filter(Boolean);
 const variants=Array.from(form.querySelectorAll("[data-variant-group]")).map(g=>({base:g.dataset.baseGroup==="true",storage:g.querySelector("[data-group-storage]")?.value||"",unit:g.querySelector("[data-group-storage-unit]")?.value||"GB",ram:g.querySelector("[data-group-ram]")?.value||"",usd:g.querySelector("[data-group-price-usd]")?.value||"",nio:g.querySelector("[data-group-price-nio]")?.value||"",colors:Array.from(g.querySelectorAll("[data-variant-row]")).map(r=>({color:r.querySelector("[data-variant-color]")?.value||"",hex:r.querySelector("[data-variant-hex]")?.value||"",availability:r.querySelector("[data-variant-availability]")?.value||"",url:r.querySelector("[data-variant-image-url]")?.value||"",images:(r._variantImageItems||[]).map(i=>({id:i.id,kind:i.kind,url:i.url||"",name:i.file?.name||"",size:i.file?.size||0,lastModified:i.file?.lastModified||0}))}))}));
 const mainGallery=mainImageItems.map(i=>({id:i.id,kind:i.kind,url:i.url||"",name:i.file?.name||"",size:i.file?.size||0,lastModified:i.file?.lastModified||0}));
 const variantGalleries=Array.from(form.querySelectorAll("[data-variant-row]")).map(row=>({color:row.querySelector("[data-variant-color]")?.value||"",images:(row._variantImageItems||[]).map(i=>({id:i.id,kind:i.kind,url:i.url||"",name:i.file?.name||"",size:i.file?.size||0,lastModified:i.file?.lastModified||0}))}));
 return JSON.stringify({fields,variants,mainGallery,variantGalleries});
}

/* Borrador local de recuperación: campos y fotos pendientes en IndexedDB. */
const RECOVERY_DB = 'cat-logo-recovery-v1', RECOVERY_STORE = 'drafts', RECOVERY_KEY = 'product-editor';
let recoveryTimer = null, restoringRecovery = false;
function recoveryOpenDB() { return new Promise((resolve,reject) => { if (!window.indexedDB) return reject(new Error('IndexedDB no está disponible.')); const req=indexedDB.open(RECOVERY_DB,1); req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(RECOVERY_STORE))req.result.createObjectStore(RECOVERY_STORE,{keyPath:'key'});}; req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error||new Error('No se pudo abrir el almacenamiento local.')); }); }
async function recoveryAction(mode, action) {
  const db = await recoveryOpenDB();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(RECOVERY_STORE, mode);
      const store = transaction.objectStore(RECOVERY_STORE);
      let request = null;
      let requestResult;
      let settled = false;

      const fail = error => {
        if (settled) return;
        settled = true;
        reject(error || new Error("No se pudo guardar el borrador local."));
      };

      transaction.oncomplete = () => {
        if (settled) return;
        settled = true;
        resolve(request ? requestResult : true);
      };
      transaction.onerror = () => fail(transaction.error || request?.error);
      transaction.onabort = () => fail(transaction.error || request?.error || new Error("No se pudo guardar el borrador local."));

      try {
        request = action(store) || null;
      } catch (error) {
        fail(error);
        try { transaction.abort(); } catch {}
        return;
      }

      if (request) {
        request.onsuccess = () => { requestResult = request.result; };
        request.onerror = () => fail(request.error || new Error("No se pudo completar el acceso al borrador local."));
      }
    });
  } finally {
    db.close();
  }
}
function recoveryItem(i) { return {id:i.id,kind:i.kind,url:i.url||'',name:i.file?.name||'',type:i.file?.type||'',lastModified:i.file?.lastModified||0,blob:i.kind==='new'&&i.file?i.file:null,uploadError:i.uploadError||''}; }
function recoveryVariantState() { return Array.from(form.querySelectorAll('[data-variant-group]')).map(g=>({base:g.dataset.baseGroup==='true',storage:g.querySelector('[data-group-storage]')?.value||'',unit:g.querySelector('[data-group-storage-unit]')?.value||'GB',ram:g.querySelector('[data-group-ram]')?.value||'',usd:g.querySelector('[data-group-price-usd]')?.value||'',nio:g.querySelector('[data-group-price-nio]')?.value||'',colors:Array.from(g.querySelectorAll('[data-variant-row]')).map(r=>({color:r.querySelector('[data-variant-color]')?.value||'',hex:r.querySelector('[data-variant-hex]')?.value||'',availability:r.querySelector('[data-variant-availability]')?.value||'available',images:(r._variantImageItems||[]).map(recoveryItem)}))})); }

function makePersistentDraftPayload() {
  const fields = Array.from(form.elements)
    .filter(field => field && field.id && field.type !== "file" &&
      !["password", "submit", "button", "reset"].includes(field.type) &&
      !["product-active", "product-featured"].includes(field.id))
    .map(field => ({
      id: field.id,
      value: field.type === "checkbox" || field.type === "radio" ? null : field.value,
      checked: field.type === "checkbox" || field.type === "radio" ? field.checked : null
    }));
  const variants = recoveryVariantState().map(group => ({
    ...group,
    colors: (group.colors || []).map(color => ({
      color: color.color,
      hex: color.hex,
      availability: color.availability,
      images: (color.images || [])
        .filter(item => item && item.kind === "existing" && item.url)
        .map(item => ({ kind: "existing", url: item.url, name: item.name || "" }))
    }))
  }));
  const mainGallery = mainImageItems
    .filter(item => item && item.kind === "existing" && item.url)
    .map(item => ({ kind: "existing", url: item.url }));
  return { version: 1, savedAt: new Date().toISOString(), fields, variants, mainGallery };
}

function restorePersistentDraftPayload(product) {
  const payload = product?.draft_payload;
  if (!payload || Number(payload.version) !== 1) return false;

  for (const field of Array.isArray(payload.fields) ? payload.fields : []) {
    const node = document.getElementById(field.id);
    if (!node || node.type === "file" || ["product-active", "product-featured", "product-id", "catalog-key"].includes(field.id)) continue;
    if (node.type === "checkbox" || node.type === "radio") node.checked = Boolean(field.checked);
    else if (field.value !== null && field.value !== undefined) node.value = field.value;
  }

  const groupStates = Array.isArray(payload.variants) ? payload.variants : [];
  if (groupStates.length && activeCatalogType !== "perfumery") {
    const colorManager = $("#base-color-manager");
    const container = $("#product-variants-list");
    if (colorManager && container) {
      colorManager.innerHTML = "";
      container.innerHTML = "";
      let foundBase = false;
      let extraCount = 0;

      for (const state of groupStates) {
        const isBase = state.base === true;
        const targetContainer = isBase ? colorManager : container;
        if (!isBase) extraCount++;
        if (isBase) foundBase = true;
        const markupState = {
          storage: state.storage ? formatStorageLabel(state.storage, state.unit || "GB") : "",
          ram: state.ram || "",
          price_usd: state.usd === "" || state.usd == null || !Number.isFinite(Number(state.usd)) ? "" : Number(state.usd),
          price_nio: state.nio === "" || state.nio == null || !Number.isFinite(Number(state.nio)) ? "" : Number(state.nio)
        };
        targetContainer.insertAdjacentHTML("beforeend", variantGroupMarkup(markupState, isBase));
        const group = isBase ? colorManager.lastElementChild : container.lastElementChild;
        const colorList = group?.querySelector("[data-variant-color-list]");
        const colors = Array.isArray(state.colors) ? state.colors : [];
        colors.forEach(color => {
          const images = (color.images || []).filter(item => item && item.url).map(item => item.url);
          colorList?.insertAdjacentHTML("beforeend", variantRowMarkup({
            color: color.color || "",
            color_hex: color.hex,
            availability: color.availability,
            images,
            image_url: images[0] || ""
          }));
        });
        if (colorList && !colors.length) colorList.innerHTML = '<p class="variants-empty-hint">Añadí los colores disponibles para esta configuración.</p>';
      }

      if (!foundBase) {
        colorManager.innerHTML = variantGroupMarkup({}, true);
      }
      if (!extraCount) {
        container.innerHTML = '<p class="variants-empty-hint">La configuración principal está arriba. Añadí otra configuración solo si cambia la RAM o el almacenamiento.</p>';
      }
      updateVariantRowHeadings();
      form.querySelectorAll("[data-variant-row]").forEach(row => {
        renderVariantImagePreview(row);
        syncColorLibraryRowControls(row);
      });
    }
  }
  return true;
}
async function saveLocalRecoveryDraft() { if(restoringRecovery||!form||!dashboard||dashboard.classList.contains('hidden'))return; const hasData=Boolean(editorIsDirty||$('#product-id')?.value||$('#product-name')?.value.trim()||mainImageItems.length||Array.from(form.querySelectorAll('[data-variant-row]')).some(r=>r.querySelector('[data-variant-color]')?.value.trim())); if(!hasData)return; const fields=Array.from(form.elements).filter(f=>f&&f.id&&f.type!=='file'&&!['password','submit','button','reset'].includes(f.type)).map(f=>({id:f.id,value:(f.type==='checkbox'||f.type==='radio')?null:f.value,checked:(f.type==='checkbox'||f.type==='radio')?f.checked:null})); const draft={key:RECOVERY_KEY,savedAt:new Date().toISOString(),fields,variants:recoveryVariantState(),mainGallery:mainImageItems.map(recoveryItem)}; try{await recoveryAction('readwrite',s=>s.put(draft));const st=$('#local-recovery-status');if(st)st.textContent='Borrador local guardado automáticamente: '+new Date(draft.savedAt).toLocaleString();const rb=$('#restore-local-draft');if(rb)rb.hidden=false;const db=$('#delete-local-draft');if(db)db.hidden=false;}catch(e){console.warn('No se pudo guardar el borrador local.',e);const st=$('#local-recovery-status');if(st)st.textContent='No se pudo guardar el borrador local. Revisá el almacenamiento del navegador.';} }
function scheduleLocalRecoverySave(delay = 120) {
  if (restoringRecovery) return;
  clearTimeout(recoveryTimer);
  recoveryTimer = window.setTimeout(() => {
    void saveLocalRecoveryDraft();
  }, Math.max(0, delay));
}
async function recoveryRestoreItem(i){if(i.kind!=='new'||!i.blob)return{id:i.id||imageId(),kind:'existing',url:i.url||''};const file=new File([i.blob],i.name||'imagen-pendiente',{type:i.type||i.blob.type||'application/octet-stream',lastModified:i.lastModified||Date.now()});return{id:i.id||imageId(),kind:'new',file,previewUrl:URL.createObjectURL(file),uploadError:i.uploadError||''};}
async function restoreLocalRecoveryDraft(){let d;try{d=await recoveryAction('readonly',s=>s.get(RECOVERY_KEY));}catch(e){message('#product-form-status',e.message||'No se pudo leer el borrador.','error');return;}if(!d){const st=$('#local-recovery-status');if(st)st.textContent='No hay borrador local guardado.';return;}if(!confirm('Hay un borrador local guardado el '+new Date(d.savedAt).toLocaleString()+'. ¿Deseás recuperarlo?'))return;restoringRecovery=true;try{clearEditor();for(const f of d.fields||[]){const n=document.getElementById(f.id);if(!n||n.type==='file')continue;if(n.type==='checkbox'||n.type==='radio')n.checked=Boolean(f.checked);else if(f.value!==null)n.value=f.value;}const vs=[];for(const g of d.variants||[])for(const c of g.colors||[])vs.push({storage:g.base?'':formatStorageLabel(g.storage,g.unit),ram:g.base?'':(g.ram?g.ram+' GB':''),price_usd:g.usd===''?null:Number(g.usd),price_nio:g.nio===''?null:Number(g.nio),color:c.color,color_hex:c.hex,availability:c.availability,images:(c.images||[]).filter(i=>i.kind==='existing'&&i.url).map(i=>i.url),image_url:(c.images||[]).find(i=>i.kind==='existing'&&i.url)?.url||''});renderVariantRows(vs);mainImageItems=[];for(const i of d.mainGallery||[])mainImageItems.push(await recoveryRestoreItem(i));renderMainImagePreviews();const rows=Array.from(form.querySelectorAll('[data-variant-row]')),saved=(d.variants||[]).flatMap(g=>g.colors||[]);for(let x=0;x<rows.length&&x<saved.length;x++){const items=[];for(const i of saved[x].images||[])items.push(await recoveryRestoreItem(i));rows[x]._variantImageItems=items;syncVariantImageFields(rows[x]);renderVariantImagePreview(rows[x]);}$('#form-title').textContent=$('#product-id').value?'Continuar edición recuperada':'Continuar borrador recuperado';setWorkflowButtonState($('#save-draft-button'), 'Guardar borrador');
setWorkflowButtonState($('#save-product-button'), $('#product-id').value?'Guardar cambios sin publicar':'Guardar producto completo sin publicar');
setWorkflowButtonState($('#publish-product-button'), $('#product-id').value?'Guardar cambios y publicar':'Guardar y publicar');
setWorkflowButtonState($('#publish-exclusive-button'), $('#product-id').value?'Guardar cambios y publicar como exclusivo':'Guardar y publicar como exclusivo');message('#product-form-status','Borrador recuperado. Revisá los datos y las fotografías antes de guardar.','success');showAdminSection('add');markEditorClean();updateEditorDirtyState();window.scrollTo({top:0,behavior:'smooth'});}catch(e){console.error('No se pudo restaurar el borrador.',e);message('#product-form-status','El borrador no se pudo restaurar por completo: '+(e.message||'error desconocido'),'error');}finally{restoringRecovery=false;}}
async function deleteLocalRecoveryDraft(){if(!confirm('¿Eliminar el borrador local? Esto no elimina productos guardados en la base de datos.'))return;try{await recoveryAction('readwrite',s=>s.delete(RECOVERY_KEY));const st=$('#local-recovery-status');if(st)st.textContent='No hay borrador local guardado.';$('#restore-local-draft').hidden=true;$('#delete-local-draft').hidden=true;}catch(e){const st=$('#local-recovery-status');if(st)st.textContent=e.message||'No se pudo eliminar el borrador.';}}
async function checkLocalRecoveryDraft(){try{const d=await recoveryAction('readonly',s=>s.get(RECOVERY_KEY));const st=$('#local-recovery-status');if(st)st.textContent=d?'Borrador local disponible desde '+new Date(d.savedAt).toLocaleString()+'.':'No hay borrador local guardado.';if($('#restore-local-draft'))$('#restore-local-draft').hidden=!d;if($('#delete-local-draft'))$('#delete-local-draft').hidden=!d;}catch(e){console.warn('No se pudo comprobar el borrador local.',e);}}

function markEditorClean() {
  editorBaseline = getEditorSnapshot();
  editorIsDirty = false;
}

function updateEditorDirtyState() {
  editorIsDirty = getEditorSnapshot() !== editorBaseline;
}

form?.addEventListener("input", () => {
  updateEditorDirtyState();
  scheduleLocalRecoverySave();
});
form?.addEventListener("change", () => {
  updateEditorDirtyState();
  scheduleLocalRecoverySave();
});

/* Botones, galería, colores y variantes también deben disparar el respaldo. */
form?.addEventListener("click", event => {
  const action = event.target.closest("button, [role='button']");
  if (!action || action.type === "submit") return;
  queueMicrotask(() => {
    updateEditorDirtyState();
    if (editorIsDirty) scheduleLocalRecoverySave(0);
  });
});
form?.addEventListener("drop", event => {
  if (!event.target.closest("[data-variant-image-id], [data-main-image-id], .sortable-image-card")) return;
  queueMicrotask(() => {
    updateEditorDirtyState();
    if (editorIsDirty) scheduleLocalRecoverySave(0);
  });
});

function hasUnsavedEditorChanges() {
  if (!form || !dashboard || dashboard.classList.contains("hidden")) return false;
  updateEditorDirtyState();
  return editorIsDirty;
}

function requestRecoveryBeforeExit() {
  if (!hasUnsavedEditorChanges()) return false;
  clearTimeout(recoveryTimer);
  /*
    Iniciar el guardado antes de que el navegador muestre su confirmación nativa.
    El respaldo automático ya viene escribiéndose durante la edición; esta llamada
    fuerza además una última escritura del estado más reciente.
  */
  void saveLocalRecoveryDraft();
  return true;
}

window.addEventListener("beforeunload", event => {
  if (!requestRecoveryBeforeExit()) return;
  event.preventDefault();
  event.returnValue = "";
});

/* Safari/Chrome móvil pueden suspender la pestaña sin completar beforeunload. */
window.addEventListener("pagehide", () => {
  if (!hasUnsavedEditorChanges()) return;
  clearTimeout(recoveryTimer);
  void saveLocalRecoveryDraft();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "hidden" || !hasUnsavedEditorChanges()) return;
  clearTimeout(recoveryTimer);
  void saveLocalRecoveryDraft();
});

/* =========================================================
   FORMULARIO DE PRODUCTOS
   ========================================================= */

function clearEditor() {
  if (!form) {
    return;
  }

  form.reset();

  $("#product-id").value = "";
  $("#catalog-key").value = "";
  $("#product-description").value = "";
  $("#product-active").checked = false;
  $("#product-featured").checked = false;

  $("#product-financing").value =
    "Financiamiento mediante crédito o tarjeta. Consultá requisitos y condiciones de aprobación.";

  $("#product-images").value = "";
  clearMainImagePreviews();
  renderMainImagePreviews();

  renderVariantRows([]);

  $("#product-perfume-family").value = "";
  $("#product-perfume-concentration").value = "";
  $("#product-perfume-volume").value = "";
  $("#product-perfume-audience").value = "";
  $("#product-perfume-scent-family").value = "";
  $("#product-perfume-top-notes").value = "";
  $("#product-perfume-heart-notes").value = "";
  $("#product-perfume-base-notes").value = "";
  $("#product-perfume-original").checked = false;

  updateProductFormMode();
  $("#form-title").textContent = activeCatalogType === "perfumery" ? "Registrar fragancia" : "Agregar producto";
  setWorkflowButtonState($("#save-draft-button"), "Guardar borrador");
  setWorkflowButtonState($("#save-product-button"), "Guardar producto completo sin publicar");
  setWorkflowButtonState($("#publish-product-button"), "Guardar y publicar");
  setWorkflowButtonState($("#publish-exclusive-button"), "Guardar y publicar como exclusivo");

  message("#product-form-status", "");
  markEditorClean();
}

function fillEditor(product) {
  activeCatalogType = normalizeCatalogType(product.catalog_type);
  if (activeCatalogSelector) activeCatalogSelector.value = activeCatalogType;
  updateProductFormMode();

  $("#product-id").value = product.id || "";
  $("#catalog-key").value = product.catalog_key || "";
  $("#product-name").value = product.name || "";
  $("#product-brand").value = product.brand || "";
  $("#product-model").value = product.model || "";
  $("#product-category").value = activeCatalogType === "perfumery" ? "Perfumería" : (product.category || "Otros");
  $("#product-description").value = product.description || "";
  $("#product-availability").value = normalizeProductAvailability(product.availability);
  $("#product-price-usd").value = product.price_usd ?? "";
  $("#product-price-nio").value = product.price_nio ?? "";
  $("#product-warranty").value = activeCatalogType === "perfumery" ? "" : (product.warranty_months ?? "");
  $("#product-specs").value = activeCatalogType === "perfumery" ? "" : specsText(product.specifications);
  $("#product-financing").value = product.financing_note ||
    "Financiamiento mediante crédito o tarjeta. Consultá requisitos y condiciones de aprobación.";
  $("#product-shipping").value = product.shipping_note || "";

  const detail = product.perfume_details || {};
  $("#product-perfume-family").value = detail.family || "";
  $("#product-perfume-concentration").value = detail.concentration || "";
  $("#product-perfume-volume").value = detail.volume_ml ?? "";
  $("#product-perfume-audience").value = detail.audience || "";
  $("#product-perfume-scent-family").value = detail.scent_family || "";
  $("#product-perfume-top-notes").value = Array.isArray(detail.top_notes) ? detail.top_notes.join(", ") : "";
  $("#product-perfume-heart-notes").value = Array.isArray(detail.heart_notes) ? detail.heart_notes.join(", ") : "";
  $("#product-perfume-base-notes").value = Array.isArray(detail.base_notes) ? detail.base_notes.join(", ") : "";
  $("#product-perfume-original").checked = Boolean(detail.is_original);

  $("#product-images").value = "";
  setExistingMainImages(getImages(product));
  renderVariantRows(activeCatalogType === "perfumery" ? [] : legacyVariants(product));
  const restoredDraftPayload = getProductWorkflowStatus(product) === "draft" && restorePersistentDraftPayload(product);
  if (!restoredDraftPayload && activeCatalogType !== "perfumery") {
    const primaryGroup = baseColorManager?.querySelector('[data-variant-group][data-base-group="true"]');
    const primaryUSD = primaryGroup?.querySelector("[data-group-price-usd]");
    const primaryNIO = primaryGroup?.querySelector("[data-group-price-nio]");
    if (primaryUSD && !primaryUSD.value && product.price_usd != null) primaryUSD.value = String(product.price_usd);
    if (primaryNIO && !primaryNIO.value && product.price_nio != null) primaryNIO.value = String(product.price_nio);
  }

  $("#product-featured").checked = Boolean(product.featured);
  $("#product-active").checked = Boolean(product.is_published);

  $("#form-title").textContent = activeCatalogType === "perfumery" ? "Editar fragancia" : "Editar producto";
  setWorkflowButtonState($("#save-draft-button"), "Guardar como borrador");
  setWorkflowButtonState($("#save-product-button"), "Guardar cambios sin publicar");
  setWorkflowButtonState($("#publish-product-button"), "Guardar cambios y publicar");
  setWorkflowButtonState($("#publish-exclusive-button"), "Guardar cambios y publicar como exclusivo");
  message("#product-form-status", "Editando: " + product.name);

  renderAdminList();
  renderDashboardOverview();
  void loadCatalogAnalytics();

  window.scrollTo({ top: 0, behavior: "smooth" });
  markEditorClean();
}
$("#new-product-button")?.addEventListener("click", () => {
  if (editorIsDirty && !window.confirm("Hay cambios sin guardar. ¿Querés descartarlos y comenzar un producto nuevo?")) return;
  clearEditor();
});
$("#cancel-edit-button")?.addEventListener("click", () => {
  const editingExisting = Boolean($("#product-id")?.value);
  if (editorIsDirty) {
    const prompt = editingExisting
      ? "Hay cambios sin guardar. La X los descarta y cierra esta edición, pero NO elimina el producto guardado. ¿Continuar?"
      : "¿Descartar todos los datos y las fotografías pendientes de este formulario?";
    if (!window.confirm(prompt)) return;
  } else if (!editingExisting && !$("#product-name")?.value.trim()) {
    clearEditor();
    return;
  }
  clearEditor();
  message("#product-form-status", "Formulario limpio. Ningún producto guardado fue eliminado.", "success");
});

activeCatalogSelector?.addEventListener("change", () => {
  const requested = normalizeCatalogType(activeCatalogSelector.value);
  if (requested === activeCatalogType) return;

  const hasOpenProduct = Boolean($("#product-id")?.value);
  if (hasOpenProduct || editorIsDirty) {
    const requestedLabel = requested === "perfumery" ? "JB Parfums · Perfumería" : "JB TECH · Tecnología";
    const warning = hasOpenProduct
      ? "Hay un producto abierto en edición. Si cambiás de catálogo ahora, se descartarán los cambios que no hayas guardado. ¿Querés continuar a " + requestedLabel + "?"
      : "Hay cambios sin guardar en el formulario. Si cambiás de catálogo, se descartarán. ¿Querés continuar a " + requestedLabel + "?";

    if (!window.confirm(warning)) {
      activeCatalogSelector.value = activeCatalogType;
      return;
    }
  }

  // Reset the current editor only after the user has explicitly accepted discarding it.
  activeCatalogType = requested;
  clearEditor();
  updateProductFormMode();
  renderAdminList();
  renderDashboardOverview();
  void loadCatalogAnalytics();
  message("#product-form-status", requested === "perfumery"
    ? "Formulario de JB Parfums · Perfumería listo."
    : "Formulario de JB TECH · Tecnología listo.", "success");
});

/* =========================================================
   ALMACENAMIENTO DE IMÁGENES
   ========================================================= */

function inferImageMime(file) {
  const extension = (file?.name?.split(".").pop() || "").toLowerCase();
  const inferred = ({
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    avif: "image/avif",
    heic: "image/heic",
    heif: "image/heif"
  })[extension] || "";
  return file?.type?.startsWith("image/") ? file.type : inferred;
}

function loadImageForOptimization(file) {
  return new Promise(resolve => {
    let objectUrl = "";
    const finish = source => resolve(source);
    try {
      objectUrl = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => finish({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        release: () => URL.revokeObjectURL(objectUrl)
      });
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        finish(null);
      };
      image.src = objectUrl;
    } catch {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      finish(null);
    }
  });
}

/*
 * Optimiza fotos grandes antes de enviarlas. Esto reduce el consumo de datos
 * del teléfono y hace más resistentes las subidas móviles sin degradar fotos
 * que ya son pequeñas. WebP conserva transparencia y admite calidad ajustable.
 */
async function prepareImageForUpload(file, originalMime) {
  const optimizableTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
  if (!optimizableTypes.has(originalMime) || file.size <= 850 * 1024) return file;

  let bitmap = null;
  let loaded = null;
  let source = null;
  let width = 0;
  let height = 0;
  let release = () => {};

  try {
    if (typeof createImageBitmap === "function") {
      try {
        bitmap = await createImageBitmap(file);
        source = bitmap;
        width = bitmap.width;
        height = bitmap.height;
        release = () => bitmap?.close?.();
      } catch {
        bitmap = null;
      }
    }

    if (!source) {
      loaded = await loadImageForOptimization(file);
      if (!loaded) return file;
      source = loaded.source;
      width = loaded.width;
      height = loaded.height;
      release = loaded.release;
    }

    if (!width || !height) return file;
    const maxEdge = 1920;
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    if (scale === 1 && file.size <= 1.4 * 1024 * 1024) return file;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return file;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, canvas.width, canvas.height);

    const outputType = originalMime === "image/png"
      ? "image/png"
      : originalMime === "image/webp"
        ? "image/webp"
        : originalMime === "image/jpeg"
          ? "image/jpeg"
          : "image/webp";
    const blob = await new Promise(resolve => canvas.toBlob(resolve, outputType, 0.84));
    if (!blob || blob.type !== outputType) return file;
    const reducedDimensions = canvas.width < width || canvas.height < height;
    if (!reducedDimensions && blob.size >= file.size * 0.97) return file;
    if (blob.size >= file.size && !reducedDimensions) return file;

    const baseName = file.name.replace(/\.[^.]+$/, "") || "fotografia";
    const outputExtension = outputType === "image/png" ? "png" : outputType === "image/webp" ? "webp" : "jpg";
    return new File([blob], baseName + "." + outputExtension, {
      type: outputType,
      lastModified: file.lastModified || Date.now()
    });
  } catch (error) {
    console.warn("No se pudo optimizar la imagen; se intentará subir el archivo original.", file.name, error);
    return file;
  } finally {
    try { release(); } catch { /* no interrumpir la subida */ }
  }
}

function isTransientImageUploadError(error) {
  const detail = String(error?.message || error || "").toLowerCase();
  return /failed to fetch|networkerror|network request failed|load failed|connection (reset|closed|lost)|fetch aborted|timed? ?out|econnreset|temporarily unavailable/.test(detail);
}

function waitBeforeRetry(milliseconds) {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds));
}

async function uploadImage(productId, file, subfolder = "") {
  if (!file) return "";

  const originalMime = inferImageMime(file);
  if (!originalMime) {
    throw new Error(
      `El archivo ${file.name} no parece una imagen compatible. Usá JPG, PNG, WebP, GIF o AVIF.`
    );
  }

  if (navigator.onLine === false) {
    throw new Error("El dispositivo aparece sin conexión. Reconectate y volvé a pulsar “Reintentar fotografías”.");
  }

  const uploadFile = await prepareImageForUpload(file, originalMime);
  if (uploadFile.size > 8 * 1024 * 1024) {
    throw new Error(
      `${file.name} supera el límite de 8 MB incluso después de intentar optimizarla. Reducí su resolución o elegí una versión más ligera.`
    );
  }

  const uploadMime = inferImageMime(uploadFile) || originalMime;
  const safeName = slugify(uploadFile.name.replace(/\.[^.]+$/, ""));
  const ext = (uploadFile.name.split(".").pop() || "jpg")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${productId}/${subfolder ? `${subfolder}/` : ""}${crypto.randomUUID()}-${safeName}.${ext}`;
  const bucket = CONFIG.storageBucket || "product-images";

  let lastError = null;
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const uploadResult = await supabase
        .storage
        .from(bucket)
        .upload(path, uploadFile, {
          contentType: uploadMime,
          upsert: false
        });

      if (!uploadResult.error) {
        const { data } = supabase.storage.from(bucket).getPublicUrl(path);
        return data.publicUrl;
      }

      lastError = uploadResult.error;
      // Si el servidor guardó el primer intento pero se perdió la respuesta,
      // un reintento puede indicar duplicado: el nombre UUID solo pertenece a esta subida.
      if (attempt > 0 && /already exists|duplicate|resource exists/i.test(String(lastError.message || ""))) {
        const { data } = supabase.storage.from(bucket).getPublicUrl(path);
        return data.publicUrl;
      }
      if (!isTransientImageUploadError(lastError) || attempt === maxAttempts - 1) break;
    } catch (error) {
      lastError = error;
      if (!isTransientImageUploadError(error) || attempt === maxAttempts - 1) break;
    }

    await waitBeforeRetry(500 * (attempt + 1));
  }

  const detail = String(lastError?.message || "fallo de red sin detalle del servidor");
  const connectionAdvice = navigator.onLine === false
    ? "El teléfono aparece sin conexión."
    : "Comprobá que la conexión del teléfono siga activa; la subida se reintentó automáticamente.";
  throw new Error(
    `No se pudo subir ${file.name} después de ${maxAttempts} intentos. ${connectionAdvice} Si se repite, probá con menos fotos por vez. Detalle: ${detail}`
  );
}

async function uploadMainImages(productId, files) {
  const urls = [];

  for (const file of files) {
    urls.push(await uploadImage(productId, file));
  }

  return urls;
}

/* =========================================================
   RECOPILAR Y VALIDAR VARIANTES
   ========================================================= */

async function collectVariants(productId, existingVariants = [], uploadIssues = [], allowIncomplete = false) {
  const allGroups = [
    ...Array.from(baseColorManager?.querySelectorAll('[data-variant-group][data-base-group="true"]') || []),
    ...Array.from(variantsContainer?.querySelectorAll('[data-variant-group][data-base-group="false"]') || [])
  ];

  const configs = [];
  const seenConfigurations = new Set();

  for (let groupIndex = 0; groupIndex < allGroups.length; groupIndex++) {
    const group = allGroups[groupIndex];
    const isBase = group.dataset.baseGroup === "true";
    const read = selector => group.querySelector(selector)?.value.trim() || "";
    const storageRaw = read("[data-group-storage]");
    const ramRaw = read("[data-group-ram]");
    const storageUnit = read("[data-group-storage-unit]") || "GB";
    const storage = storageRaw ? formatStorageLabel(storageRaw, storageUnit) : "";
    const ram = ramRaw ? `${ramRaw} GB` : "";
    const hasConfiguration = Boolean(storageRaw || ramRaw);
    const key = variantGroupKey({storage,ram});

    const rows = Array.from(group.querySelectorAll("[data-variant-row]"));
    if (!isBase && !hasConfiguration && !rows.length) {
      if (allowIncomplete) continue;
      throw new Error(`Indicá almacenamiento o RAM en la configuración ${groupIndex + 1}.`);
    }

    // An untouched blank primary group is optional; configured groups need at least one color.
    if (isBase && !hasConfiguration && !rows.length) continue;
    const colors = [];
    if (hasConfiguration && !rows.length) {
      if (!allowIncomplete) throw new Error(`Añadí al menos un color a la configuración ${groupIndex + 1}.`);
      colors.push({
        color: "",
        color_hex: "#315A91",
        availability: "available",
        images: [],
        image_url: ""
      });
    }
    if (hasConfiguration && seenConfigurations.has(key)) {
      throw new Error("Hay una configuración repetida de almacenamiento y RAM.");
    }
    if (hasConfiguration) seenConfigurations.add(key);

    for (let colorIndex = 0; colorIndex < rows.length; colorIndex++) {
      const row = rows[colorIndex];
      const color = row.querySelector("[data-variant-color]")?.value.trim() || "";
      if (!color && !allowIncomplete) throw new Error(`Completá el nombre del color ${colorIndex + 1} de la configuración ${groupIndex + 1}.`);
      const color_hex = validHex(row.querySelector("[data-variant-hex]")?.value);
      const availability = normalizeVariantAvailability(row.querySelector("[data-variant-availability]")?.value);
      initVariantImageItems(row);
      const imageItems = row._variantImageItems || [];
      const urls = [];
      const status = row.querySelector("[data-variant-status]");
      if (status && imageItems.some(item => item.kind === "new")) {
        status.textContent = `Subiendo fotografías de ${color}…`;
        status.dataset.state = "uploading";
      }
      for (const item of imageItems) {
        if (item.kind === "new") {
          try {
            const url = await uploadImage(productId, item.file, "variants");
            urls.push(url);
            item.kind = "existing";
            item.url = url;
            delete item.uploadError;
            if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
            delete item.previewUrl;
            delete item.file;
          } catch (error) {
            uploadIssues.push(`${color}: ${error.message || "error desconocido"}`);
            item.uploadError = error.message || "Error desconocido";
          }
        } else if (item.url) {
          urls.push(item.url);
        }
      }
      row._variantImageItems = imageItems;
      syncVariantImageFields(row);
      renderVariantImagePreview(row);
      const failedUploads = imageItems.filter(item => item.kind === "new");
      if (status) {
        if (failedUploads.length) {
          status.textContent = `No se pudieron subir ${failedUploads.length} fotografía(s) de ${color}. Los datos se conservarán; podés reintentar.`;
          status.dataset.state = "error";
        } else {
          status.textContent = urls.length ? `${urls.length} fotografía(s) guardadas para ${color}.` : "";
          status.dataset.state = "success";
        }
      }
      colors.push({color,color_hex,availability,images:[...new Set(urls)],image_url:urls[0]||"",row});
    }

    const seenColors = new Set();
    colors.forEach(item => {
      if (!item.color) return;
      const key = item.color.toLocaleLowerCase("es");
      if (seenColors.has(key) && !allowIncomplete) throw new Error(`El color "${item.color}" está repetido dentro de una misma configuración.`);
      seenColors.add(key);
    });

    const optionalDraftNumber = value => {
      if (value === "") return null;
      const number = Number(value);
      return Number.isFinite(number) && number >= 0 ? number : null;
    };
    configs.push({
      storage, ram,
      price_usd: allowIncomplete ? optionalDraftNumber(read("[data-group-price-usd]")) : toOptionalNumber(read("[data-group-price-usd]"), `Precio en dólares de configuración ${groupIndex + 1}`),
      price_nio: allowIncomplete ? optionalDraftNumber(read("[data-group-price-nio]")) : toOptionalNumber(read("[data-group-price-nio]"), `Precio en córdobas de configuración ${groupIndex + 1}`),
      colors, isBase
    });
  }

  return configs.flatMap(config => config.colors.map(color => ({
    storage: config.storage,
    ram: config.ram,
    color: color.color,
    color_hex: color.color_hex,
    price_usd: config.price_usd,
    price_nio: config.price_nio,
    availability: color.availability,
    images: color.images,
    image_url: color.image_url
  })));
}

function deriveColorsFromVariants(variants, fallbackColors = []) {
  if (!variants.length) {
    return [];
  }

  const byColor = new Map();

  variants.forEach(variant => {
    const key = variant.color.toLocaleLowerCase("es");

    if (!key) {
      return;
    }

    const previous = byColor.get(key);

    if (!previous) {
      byColor.set(key, {
        name: variant.color,
        type: variant.availability,
        image_url: (variant.images && variant.images[0]) || variant.image_url || "",
        images: variant.images || (variant.image_url ? [variant.image_url] : []),
        color_hex: validHex(variant.color_hex)
      });
    } else {
      if (variant.availability === "available") {
        previous.type = "available";
      }

      if (!previous.image_url && (variant.images?.[0] || variant.image_url)) previous.image_url = variant.images?.[0] || variant.image_url;
      if ((!previous.images || !previous.images.length) && variant.images?.length) previous.images = variant.images;
    }
  });

  return Array.from(byColor.values());
}

/* =========================================================
   GUARDAR PRODUCTOS
   ========================================================= */

form?.addEventListener("submit", async event => {
  event.preventDefault();

  if (!currentUser || !supabase) {
    message("#product-form-status", "Tu sesión administrativa no está activa. Volvé a iniciar sesión.", "error");
    return;
  }

  const activeButton = event.submitter?.matches?.("[data-save-action]")
    ? event.submitter
    : $("#save-product-button");
  const saveAction = activeButton?.dataset.saveAction || "unpublished";
  const isDraft = saveAction === "draft";
  const workflowStatus = saveAction === "draft" ? "draft"
    : saveAction === "publish" || saveAction === "exclusive" ? "published"
    : "unpublished";
  const wasEditing = Boolean($("#product-id").value);
  const imageUploadErrors = [];
  const isPerfume = activeCatalogType === "perfumery";

  if (!isDraft && !form.reportValidity()) return;
  if (!$("#product-name").value.trim()) {
    message("#product-form-status", "El nombre del producto es obligatorio incluso en un borrador.", "error");
    $("#product-name").focus();
    return;
  }
  if (!isDraft && isPerfume && !$("#product-perfume-family").value) {
    message("#product-form-status", "Seleccioná la familia de la fragancia antes de guardarla como producto completo.", "error");
    $("#product-perfume-family").focus();
    return;
  }

  setWorkflowActionsBusy(true, activeButton);
  try {
    const name = $("#product-name").value.trim();
    const rawVolume = $("#product-perfume-volume").value.trim();
    let perfumeVolume = null;
    if (isPerfume && rawVolume) {
      if (isDraft) {
        const candidate = Number(rawVolume);
        perfumeVolume = Number.isFinite(candidate) && candidate > 0 ? candidate : null;
      } else {
        perfumeVolume = toOptionalNumber(rawVolume, "Contenido en ml");
        if (perfumeVolume !== null && perfumeVolume <= 0) throw new Error("El contenido en ml debe ser mayor que cero.");
      }
    }

    const id = $("#product-id").value || crypto.randomUUID();
    const existingProduct = products.find(product => String(product.id) === String(id));
    if (wasEditing && existingProduct && normalizeCatalogType(existingProduct.catalog_type) !== activeCatalogType) {
      throw new Error("El catálogo del producto no coincide con el catálogo activo. Cancelá y volvé a abrirlo desde su catálogo.");
    }

    const catalogKey = $("#catalog-key").value.trim() || (slugify(name) + "-" + id.slice(0, 8));
    const variants = isPerfume
      ? []
      : await collectVariants(id, existingProduct?.variants || [], imageUploadErrors, isDraft);

    const uploadedMainImages = [];
    for (let imageIndex = 0; imageIndex < mainImageItems.length; imageIndex++) {
      const item = mainImageItems[imageIndex];
      if (item.kind === "new") {
        message("#product-form-status", "Subiendo fotografía " + (imageIndex + 1) + " de " + mainImageItems.length + "…");
        try {
          const url = await uploadImage(id, item.file);
          uploadedMainImages.push(url);
          item.kind = "existing";
          item.url = url;
          delete item.uploadError;
          if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
          delete item.previewUrl;
          delete item.file;
        } catch (error) {
          imageUploadErrors.push((item.file?.name || "Fotografía principal") + ": " + (error.message || "error desconocido"));
          item.uploadError = error.message || "Error desconocido";
        }
      } else if (item.url) {
        uploadedMainImages.push(item.url);
      }
    }
    renderMainImagePreviews();

    const colors = isPerfume ? [] : deriveColorsFromVariants(variants, existingProduct?.colors || []);
    const readNumber = (value, label) => {
      if (isDraft) {
        if (value === "" || value == null) return null;
        const number = Number(value);
        return Number.isFinite(number) && number >= 0 ? number : null;
      }
      return toOptionalNumber(value, label);
    };
    const baseUSD = isPerfume ? readNumber($("#product-price-usd").value, "Precio base en dólares") : null;
    const baseNIO = isPerfume ? readNumber($("#product-price-nio").value, "Precio base en córdobas") : null;
    const warranty = isPerfume ? null : readNumber($("#product-warranty").value, "Garantía");
    const priceUSD = isPerfume
      ? baseUSD
      : (minimumPrice(variants, "price_usd") ?? (existingProduct?.price_usd ?? null));
    const priceNIO = isPerfume
      ? baseNIO
      : (minimumPrice(variants, "price_nio") ?? (existingProduct?.price_nio ?? null));
    const allImages = [...new Set(uploadedMainImages)];
    const now = new Date().toISOString();

    const featured = saveAction === "exclusive" ? true
      : saveAction === "publish" ? false
      : Boolean(existingProduct?.featured || $("#product-featured").checked);
    const draftPayload = isDraft ? makePersistentDraftPayload() : null;
    const payload = {
      catalog_key: catalogKey,
      catalog_type: activeCatalogType,
      sort_order: wasEditing ? Number(existingProduct?.sort_order ?? getActiveCatalogProducts().length) : getActiveCatalogProducts().length,
      name,
      brand: $("#product-brand").value.trim() || null,
      model: isPerfume ? null : ($("#product-model").value.trim() || null),
      category: isPerfume ? "Perfumería" : ($("#product-category").value || (isDraft ? "Pendiente" : "")),
      availability: normalizeProductAvailability($("#product-availability").value || existingProduct?.availability || "available"),
      price_usd: priceUSD,
      price_nio: priceNIO,
      warranty_months: warranty,
      description: $("#product-description").value.trim() || null,
      specifications: isPerfume ? {} : parseSpecs($("#product-specs").value),
      images: allImages,
      image_url: allImages[0] || null,
      colors,
      variants,
      financing_note: isPerfume ? null : (
        $("#product-financing").value.trim() ||
        "Financiamiento mediante crédito o tarjeta. Consultá requisitos y condiciones de aprobación."
      ),
      shipping_note: $("#product-shipping").value.trim() || null,
      featured,
      is_published: workflowStatus === "published",
      workflow_status: workflowStatus,
      deleted_at: null,
      trash_previous_status: null,
      draft_payload: draftPayload,
      updated_at: now,
      updated_by: currentUser.id
    };

    const result = wasEditing
      ? await supabase.from("products").update(payload).eq("id", id)
      : await supabase.from("products").insert({ ...payload, id, created_at: now });
    if (result.error) throw result.error;

    $("#product-id").value = id;
    $("#catalog-key").value = catalogKey;

    if (isPerfume && $("#product-perfume-family").value) {
      const perfumePayload = {
        product_id: id,
        family: $("#product-perfume-family").value,
        concentration: $("#product-perfume-concentration").value.trim() || null,
        volume_ml: perfumeVolume,
        audience: $("#product-perfume-audience").value || null,
        scent_family: $("#product-perfume-scent-family").value.trim() || null,
        top_notes: splitPerfumeNotes($("#product-perfume-top-notes").value),
        heart_notes: splitPerfumeNotes($("#product-perfume-heart-notes").value),
        base_notes: splitPerfumeNotes($("#product-perfume-base-notes").value),
        is_original: $("#product-perfume-original").checked,
        updated_at: now
      };
      const detailResult = await supabase.from("perfume_details").upsert(perfumePayload, { onConflict: "product_id" });
      if (detailResult.error) {
        message("#product-form-status", "El producto base se guardó, pero no se guardaron los detalles de perfumería: " + detailResult.error.message + ". La ficha quedó abierta para corregirlo y volver a guardar.", "error");
        setStatus("Faltan guardar los detalles de la fragancia: " + name, "error");
        await loadProducts();
        return;
      }
    } else if (isPerfume && !isDraft) {
      throw new Error("La fragancia quedó guardada, pero necesita una familia olfativa antes de quedar completa.");
    }

    if (imageUploadErrors.length) {
      $("#form-title").textContent = isPerfume ? "Fragancia guardada · fotografías pendientes" : "Producto guardado · fotografías pendientes";
      message(
        "#product-form-status",
        "El registro quedó guardado como " + workflowStatusLabel(workflowStatus).toLowerCase() + ", pero " + imageUploadErrors.length + " fotografía(s) no se pudieron subir. Las demás modificaciones se guardaron. Revisá Storage y volvé a pulsar la acción deseada para reintentar las fotografías. Detalle: " + imageUploadErrors.slice(0, 2).join(" · "),
        "error"
      );
      setStatus("Guardado con fotografías pendientes: " + name, "error");
      await loadProducts();
      return;
    }

    await recoveryAction("readwrite", store => store.delete(RECOVERY_KEY))
      .catch(error => console.warn("No se pudo limpiar el respaldo local tras guardar.", error));
    await loadProducts();
    clearEditor();
    const section = workflowStatus === "published" ? "published"
      : workflowStatus === "unpublished" ? "unpublished" : "drafts";
    showAdminSection(section);
    const label = workflowStatus === "published"
      ? (featured ? "Producto publicado como exclusivo." : "Producto publicado.")
      : workflowStatus === "unpublished"
        ? "Producto completo guardado sin publicar."
        : "Borrador guardado en Supabase; podés continuar editándolo después.";
    message("#product-form-status", label, "success");
    setStatus(label, "success");
  } catch (error) {
    message("#product-form-status", error.message || "Ocurrió un error al guardar el producto.", "error");
  } finally {
    setWorkflowActionsBusy(false);
    setWorkflowButtonState($("#save-draft-button"), "Guardar borrador");
    setWorkflowButtonState($("#save-product-button"), wasEditing ? "Guardar cambios sin publicar" : "Guardar producto completo sin publicar");
    setWorkflowButtonState($("#publish-product-button"), wasEditing ? "Guardar cambios y publicar" : "Guardar y publicar");
    setWorkflowButtonState($("#publish-exclusive-button"), wasEditing ? "Guardar cambios y publicar como exclusivo" : "Guardar y publicar como exclusivo");
  }
});
/* =========================================================
   IMPORTAR JSON
   ========================================================= */

$("#import-json-file")?.addEventListener("change", async event => {
  const file = event.target.files?.[0];

  if (activeCatalogType !== "technology") {
    message("#import-status", "La importación JSON está disponible solo para Tecnología. Registrá las fragancias desde su formulario especializado.", "error");
    event.target.value = "";
    return;
  }

  if (!file || !supabase || !currentUser) {
    return;
  }

  const node = $("#import-status");

  message(node, "Leyendo el archivo…");

  try {
    const raw = JSON.parse(await file.text());

    const rows = Array.isArray(raw)
      ? raw
      : raw.products;

    if (!Array.isArray(rows) || !rows.length) {
      throw new Error(
        "El JSON debe contener una lista de productos."
      );
    }

    const importTime = new Date().toISOString();

    const payload = rows.map((product, index) => {
      if (!product.name || !product.category) {
        throw new Error(
          `El producto ${index + 1} necesita nombre y categoría.`
        );
      }

      const variants = normalizeVariants(product.variants);

      const colors = variants.length
        ? deriveColorsFromVariants(variants, product.colors)
        : normalizeColors(product.colors);

      const images = Array.isArray(product.images)
        ? product.images
        : typeof product.image_url === "string" && product.image_url
          ? [product.image_url]
          : [];

      const baseUSD = toOptionalNumber(
        product.price_usd,
        "Precio en dólares"
      );

      const baseNIO = toOptionalNumber(
        product.price_nio,
        "Precio en córdobas"
      );

      return {
        catalog_type: "technology",
        catalog_key: product.catalog_key ||
          `${slugify(product.name)}-${crypto.randomUUID().slice(0, 8)}`,

        sort_order: index,
        created_at: importTime,
        updated_at: importTime,
        updated_by: currentUser.id,

        name: String(product.name),
        brand: product.brand || null,
        model: product.model || null,
        category: String(product.category),

        price_usd: variants.length
          ? minimumPrice(variants, "price_usd") ?? baseUSD
          : baseUSD,

        price_nio: variants.length
          ? minimumPrice(variants, "price_nio") ?? baseNIO
          : baseNIO,

        description: product.description || null,

        specifications:
          product.specifications &&
          typeof product.specifications === "object"
            ? product.specifications
            : product.specs &&
              typeof product.specs === "object"
              ? product.specs
              : {},

        warranty_months: toOptionalNumber(
          product.warranty_months,
          "Garantía"
        ),

        availability: normalizeProductAvailability(
          product.availability
        ),

        financing_note: product.financing_note ||
          "Financiamiento mediante crédito o tarjeta. Consultá requisitos y condiciones de aprobación.",

        shipping_note: product.shipping_note || null,

        images,
        image_url: images[0] || product.image_url || null,

        colors,
        variants,

        featured: false,
        is_published: false,
        workflow_status: "unpublished",
        draft_payload: null
      };
    });

    const { error } = await supabase
      .from("products")
      .insert(payload);

    if (error) {
      throw error;
    }

    message(
      node,
      `${payload.length} productos importados como no publicados. Revisá variantes, precios y fotografías antes de publicarlos.`,
      "success"
    );

    await loadProducts();
  } catch (error) {
    message(
      node,
      error.message || "No se pudo importar el archivo.",
      "error"
    );
  } finally {
    event.target.value = "";
  }
});

/* =========================================================
   INICIALIZACIÓN DEL PANEL
   ========================================================= */

handleSession().catch(async error => {
  await signOutLocalSafely();

  showLoginScreen(
    error.message || "No se pudo comprobar la sesión.",
    "error"
  );
});
