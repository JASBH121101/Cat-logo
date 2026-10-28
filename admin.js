import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { initProviderTools } from "./admin-provider.js?v=20261028-variant-review-state1";

/* =========================================================
   JB MANAGER · ADMINISTRACIÓN
   Sesión temporal por pestaña + inventario + variantes
   ========================================================= */

const CONFIG = window.CATALOG_CONFIG || {};
// Custom technology tags are kept as separate chips while editing a product.
let customProductTags = [];

const configured = Boolean(
  CONFIG.supabaseUrl &&
  CONFIG.supabaseAnonKey &&
  !String(CONFIG.supabaseUrl).includes("PON_AQUI") &&
  !String(CONFIG.supabaseAnonKey).includes("PON_AQUI")
);

/*
  «Recordar mi sesión» conserva la sesión autenticada de Supabase en este
  dispositivo, sin guardar la contraseña. Si está desactivado, se usa
  sessionStorage y una recarga vuelve a pedir autenticación.
*/
const REMEMBER_SESSION_KEY = "cat-logo-remember-admin-session-v1";
const REMEMBER_EMAIL_KEY = "cat-logo-remember-admin-email-v1";

function isRememberedSessionEnabled() {
  try {
    return window.localStorage.getItem(REMEMBER_SESSION_KEY) === "true";
  } catch {
    return false;
  }
}

function getRememberedAdminEmail() {
  if (!isRememberedSessionEnabled()) return "";
  try {
    return window.localStorage.getItem(REMEMBER_EMAIL_KEY) || "";
  } catch {
    return "";
  }
}

const isPageReload = (() => {
  try {
    return performance.getEntriesByType("navigation")[0]?.type === "reload";
  } catch {
    return false;
  }
})();

if (isPageReload && !isRememberedSessionEnabled()) {
  try {
    const projectRef = new URL(CONFIG.supabaseUrl).hostname.split(".")[0];
    const key = `sb-${projectRef}-auth-token`;
    window.sessionStorage.removeItem(key);
    window.localStorage.removeItem(key);
  } catch (error) {
    console.warn("No se pudo limpiar la sesión temporal durante la recarga.", error);
  }
}

const supabaseAuthStorage = {
  getItem(key) {
    try {
      if (isRememberedSessionEnabled()) {
        const saved = window.localStorage.getItem(key);
        if (saved !== null) return saved;
      }
      return window.sessionStorage.getItem(key);
    } catch (error) {
      console.warn("No se pudo leer el almacenamiento de sesión.", error);
      return null;
    }
  },
  setItem(key, value) {
    try {
      if (isRememberedSessionEnabled()) {
        window.localStorage.setItem(key, value);
        window.sessionStorage.removeItem(key);
      } else {
        window.sessionStorage.setItem(key, value);
        window.localStorage.removeItem(key);
      }
    } catch (error) {
      console.warn("No se pudo guardar el almacenamiento de sesión.", error);
    }
  },
  removeItem(key) {
    try {
      window.sessionStorage.removeItem(key);
      window.localStorage.removeItem(key);
    } catch (error) {
      console.warn("No se pudo eliminar el almacenamiento de sesión.", error);
    }
  }
};

const supabase = configured
  ? createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
      auth: {
        storage: supabaseAuthStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;

/* Preview deployments are read-only: protect production data while testing Vercel/Cloudflare previews. */
const adminHostname = String(window.location.hostname || "").toLocaleLowerCase();
const IS_READ_ONLY_PREVIEW =
  /\.vercel\.app$/i.test(adminHostname) ||
  (/\.pages\.dev$/i.test(adminHostname) && adminHostname !== "jb-collections.pages.dev");
if (supabase && IS_READ_ONLY_PREVIEW) {
  const originalFrom = supabase.from.bind(supabase);
  supabase.from = table => {
    const query = originalFrom(table);
    for (const method of ["insert", "update", "upsert", "delete"]) {
      if (typeof query[method] === "function") {
        query[method] = () => {
          throw new Error("Vista previa segura: no se permiten cambios en la base de datos desde un despliegue de prueba.");
        };
      }
    }
    return query;
  };
  const originalStorageFrom = supabase.storage.from.bind(supabase.storage);
  supabase.storage.from = bucket => {
    const storageApi = originalStorageFrom(bucket);
    for (const method of ["upload", "update", "move", "copy", "remove", "createSignedUploadUrl", "createSignedUrls"]) {
      if (typeof storageApi[method] === "function") {
        storageApi[method] = async () => {
          throw new Error("Vista previa segura: no se permiten subir, mover ni borrar fotografías desde un despliegue de prueba.");
        };
      }
    }
    return storageApi;
  };
}

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
const CATALOG_ADMIN_ACTIVITY_KEY = "cat-logo-admin-activity-v1";
function refreshCatalogAdminActivityMarker() {
  if (!currentUser) return;
  try { window.localStorage.setItem(CATALOG_ADMIN_ACTIVITY_KEY, String(Date.now())); } catch {}
}
function clearCatalogAdminActivityMarker() {
  try { window.localStorage.removeItem(CATALOG_ADMIN_ACTIVITY_KEY); } catch {}
}
window.setInterval(refreshCatalogAdminActivityMarker, 30000);
window.addEventListener("focus", refreshCatalogAdminActivityMarker);
let editorRecordExists = false;
let activeCatalogType = "technology";
let dashboardCatalogScope = "all";
const activeCatalogSelector = $("#active-catalog-selector");
const dashboardScopeSelector = $("#dashboard-scope-selector");
const providerTools = initProviderTools({
  getSupabase: () => supabase,
  getCurrentUser: () => currentUser,
  getProducts: () => products
});
window.addEventListener("jb-catalog-provider-updated", () => {
  void loadProducts();
});

function normalizeCatalogType(value) {
  return value === "perfumery" ? "perfumery" : "technology";
}

function getActiveCatalogProducts() {
  return products.filter(product => normalizeCatalogType(product.catalog_type) === activeCatalogType);
}

function getDashboardProducts() {
  if (dashboardCatalogScope === "all") return products;
  return products.filter(product => normalizeCatalogType(product.catalog_type) === dashboardCatalogScope);
}


/* =========================================================
   DETECTOR INTELIGENTE DE COINCIDENCIAS
   Solo compara la misma marca y el mismo catálogo. Es una
   ayuda de revisión: nunca bloquea ni guarda por su cuenta.
   ========================================================= */
let productDuplicateCheckTimer = 0;

function normalizeDuplicateText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/\+/g, " plus ")
    .replace(/\bproplus\b/g, "pro plus")
    .replace(/\bpro\s+plus\b/g, "pro plus")
    .replace(/\b(?:incorporated|corporation|electronics|technology|technologies|company|limited|ltd|inc|llc|s\.a\.|sa)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function duplicateTokens(value) {
  return new Set(normalizeDuplicateText(value).split(" ").filter(token => token.length > 1));
}

function duplicateTokenSimilarity(left, right) {
  const a = duplicateTokens(left), b = duplicateTokens(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  a.forEach(token => { if (b.has(token)) overlap += 1; });
  return overlap / (a.size + b.size - overlap);
}

function duplicateBigramSimilarity(left, right) {
  const toBigrams = value => {
    const normalized = " " + normalizeDuplicateText(value) + " ";
    const result = new Set();
    for (let i = 0; i < normalized.length - 1; i += 1) result.add(normalized.slice(i, i + 2));
    return result;
  };
  const a = toBigrams(left), b = toBigrams(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  a.forEach(pair => { if (b.has(pair)) overlap += 1; });
  return (2 * overlap) / (a.size + b.size);
}

function duplicateTextSimilarity(left, right) {
  const a = normalizeDuplicateText(left), b = normalizeDuplicateText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  const containment = longer.includes(shorter) ? shorter.length / longer.length : 0;
  const overlap = duplicateTokenSimilarity(a, b);
  const bigrams = duplicateBigramSimilarity(a, b);
  const blended = overlap * 0.58 + bigrams * 0.42;
  return Math.max(blended, containment >= 0.48 ? 0.68 + containment * 0.24 : 0);
}

function getDuplicateVariantProfilesFromForm() {
  return Array.from(form?.querySelectorAll("[data-variant-group]") || [])
    .map(group => ({
      ram: String(group.querySelector("[data-group-ram]")?.value || "").trim(),
      storage: String(group.querySelector("[data-group-storage]")?.value || "").trim(),
      unit: String(group.querySelector("[data-group-storage-unit]")?.value || "GB").trim()
    }))
    .filter(item => item.ram || item.storage);
}

function getDuplicateVariantProfiles(product) {
  return normalizeVariants(product?.variants).map(variant => ({
    ram: String(variant.ram || "").trim(),
    storage: String(variant.storage || "").trim()
  })).filter(item => item.ram || item.storage);
}

function duplicateVariantLabel(variant) {
  const parts = [];
  if (variant.ram) parts.push(variant.ram + " RAM");
  if (variant.storage) {
    const storage = String(variant.storage).trim();
    parts.push(/\b(?:gb|tb)\b/i.test(storage) ? storage : storage + " " + (variant.unit || "GB"));
  }
  return parts.join(" · ");
}

function scoreProductDuplicate(candidate, query) {
  const candidateName = String(candidate.name || "");
  const candidateModel = String(candidate.model || "");
  const nameSimilarity = duplicateTextSimilarity(query.name, candidateName);
  const modelSimilarity = duplicateTextSimilarity(query.model, candidateModel);
  const queryModelAgainstName = query.model ? duplicateTextSimilarity(query.model, candidateName) : 0;
  const queryNameAgainstModel = candidateModel ? duplicateTextSimilarity(query.name, candidateModel) : 0;
  const primary = Math.max(
    nameSimilarity,
    modelSimilarity,
    queryModelAgainstName * 0.96,
    queryNameAgainstModel * 0.92
  );
  const tokenScore = Math.max(
    duplicateTokenSimilarity(query.name, candidateName),
    query.model && candidateModel ? duplicateTokenSimilarity(query.model, candidateModel) : 0,
    query.model ? duplicateTokenSimilarity(query.model, candidateName) * 0.95 : 0
  );
  const exactName = normalizeDuplicateText(query.name) === normalizeDuplicateText(candidateName);
  const exactModel = Boolean(query.model && candidateModel &&
    normalizeDuplicateText(query.model) === normalizeDuplicateText(candidateModel));
  const queryCategory = normalizeDuplicateText(query.category);
  const candidateCategory = normalizeDuplicateText(candidate.category);
  const categoryMatch = Boolean(queryCategory && candidateCategory && queryCategory === candidateCategory);
  const categoryConflict = Boolean(queryCategory && candidateCategory && queryCategory !== candidateCategory);
  const queryProfiles = query.profiles || [];
  const candidateProfiles = getDuplicateVariantProfiles(candidate);
  const matchingProfile = queryProfiles.some(current => candidateProfiles.some(existing =>
    (!current.ram || !existing.ram || normalizeDuplicateText(current.ram) === normalizeDuplicateText(existing.ram)) &&
    (!current.storage || !existing.storage || normalizeDuplicateText(current.storage) === normalizeDuplicateText(existing.storage))
  ));
  const isPerfume = query.catalogType === "perfumery";
  const currentPerfume = query.perfumeDetails || {};
  const savedPerfume = candidate.perfume_details || {};
  const sameVolume = isPerfume && currentPerfume.volume &&
    savedPerfume.volume_ml != null && Number(currentPerfume.volume) === Number(savedPerfume.volume_ml);
  const sameConcentration = isPerfume && currentPerfume.concentration && savedPerfume.concentration &&
    normalizeDuplicateText(currentPerfume.concentration) === normalizeDuplicateText(savedPerfume.concentration);

  let score = primary * 0.66 + tokenScore * 0.20;
  if (categoryMatch) score += 0.055;
  if (exactName) score += 0.08;
  if (exactModel) score += 0.09;
  if (matchingProfile) score += 0.025;
  if (sameVolume) score += 0.025;
  if (sameConcentration) score += 0.025;
  if (categoryConflict) score -= 0.045;
  return Math.max(0, Math.min(1, score));
}

function getProductDuplicateStatusLabel(product) {
  const status = getWorkflowStatus(product);
  return status === "published" ? "Publicado"
    : status === "draft" ? "Borrador"
    : status === "trash" ? "En papelera"
    : status === "deleting" ? "En eliminación"
    : "No publicado";
}

function getProductDuplicateDetails(product, query) {
  const details = [];
  const savedModel = String(product.model || "").trim();
  if (savedModel) details.push("Modelo: " + savedModel);
  if (product.category) details.push("Categoría: " + product.category);
  if (product.catalog_type === "perfumery") {
    const perfume = product.perfume_details || {};
    if (perfume.concentration) details.push(perfume.concentration);
    if (perfume.volume_ml) details.push(perfume.volume_ml + " ml");
    if (perfume.family) details.push(perfumeFamilyLabel(perfume.family));
  } else {
    const profiles = getDuplicateVariantProfiles(product);
    if (profiles.length) {
      const visible = profiles.slice(0, 3).map(duplicateVariantLabel).filter(Boolean);
      details.push(profiles.length + " configuración" + (profiles.length === 1 ? "" : "es") +
        (visible.length ? ": " + visible.join(" / ") : "") +
        (profiles.length > visible.length ? " / …" : ""));
    }
  }
  const currentModel = normalizeDuplicateText(query.model);
  if (currentModel && savedModel && currentModel === normalizeDuplicateText(savedModel)) {
    details.push("El modelo coincide");
  } else if (query.model && savedModel) {
    details.push("Compará el modelo");
  }
  return details;
}

function renderProductDuplicateSuggestions() {
  const panel = $("#product-duplicate-panel");
  const results = $("#product-duplicate-results");
  const summary = $("#product-duplicate-summary");
  const count = $("#product-duplicate-count");
  if (!panel || !results || !summary || !count) return;

  const name = String($("#product-name")?.value || "").trim();
  const brand = String($("#product-brand")?.value || "").trim();
  if (name.length < 3 || normalizeDuplicateText(brand).length < 2) {
    panel.hidden = true;
    results.replaceChildren();
    return;
  }

  const query = {
    name: name,
    brand: brand,
    model: String($("#product-model")?.value || "").trim(),
    category: activeCatalogType === "perfumery" ? "Perfumería" : String($("#product-category")?.value || "").trim(),
    catalogType: normalizeCatalogType(activeCatalogType),
    profiles: getDuplicateVariantProfilesFromForm(),
    perfumeDetails: {
      volume: String($("#product-perfume-volume")?.value || "").trim(),
      concentration: String($("#product-perfume-concentration")?.value || "").trim()
    }
  };
  const brandKey = normalizeDuplicateText(brand);
  const currentId = String($("#product-id")?.value || "").trim();

  const matches = products
    .filter(product => {
      if (currentId && String(product.id) === currentId) return false;
      if (normalizeCatalogType(product.catalog_type) !== query.catalogType) return false;
      if (normalizeDuplicateText(product.brand) !== brandKey) return false;
      if (!String(product.name || "").trim()) return false;
      if (["trash", "deleting"].includes(getWorkflowStatus(product))) return false;
      return true;
    })
    .map(product => ({ product: product, score: scoreProductDuplicate(product, query) }))
    .filter(match => match.score >= 0.39)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  panel.hidden = false;
  summary.textContent = "Buscando dentro de " + brand + " y comparando nombre, modelo, categoría" +
    (query.catalogType === "perfumery" ? ", concentración y ml" : ", RAM, almacenamiento y variantes") + ".";
  count.hidden = matches.length === 0;
  count.textContent = matches.length + " posible" + (matches.length === 1 ? "" : "s");

  if (!matches.length) {
    results.innerHTML = '<p class="product-duplicate-empty">No encontramos coincidencias probables para <strong>' +
      escapeHtml(name) + "</strong> en la marca " + escapeHtml(brand) +
      ". La búsqueda incluye productos publicados, no publicados y borradores.</p>";
    return;
  }

  results.innerHTML = matches.map(({ product, score }) => {
    const percent = Math.round(score * 100);
    const label = percent >= 78 ? "Coincidencia alta" : percent >= 58 ? "Coincidencia probable" : "Nombre parecido";
    const tagClass = percent >= 78 ? "is-high" : "is-medium";
    const details = getProductDuplicateDetails(product, query);
    const status = getProductDuplicateStatusLabel(product);
    return '<article class="product-duplicate-result">' +
      '<div class="product-duplicate-main">' +
        '<p class="product-duplicate-name">' + escapeHtml(product.name || "Producto sin nombre") + '</p>' +
        '<p class="product-duplicate-meta">' + escapeHtml(product.brand || brand) +
          (product.model ? " · " + escapeHtml(product.model) : "") + " · " + escapeHtml(status) + '</p>' +
        '<div class="product-duplicate-tags">' +
          '<span class="product-duplicate-tag ' + tagClass + '">' + label + '</span>' +
          details.map(detail => '<span class="product-duplicate-tag">' + escapeHtml(detail) + '</span>').join("") +
        '</div>' +
      '</div>' +
      '<button class="product-duplicate-open" type="button" data-duplicate-edit="' + escapeHtml(product.id) +
        '" aria-label="Abrir producto existente ' + escapeHtml(product.name || "") + '">Ver existente ↗</button>' +
    '</article>';
  }).join("");
}

function scheduleProductDuplicateCheck(options = {}) {
  window.clearTimeout(productDuplicateCheckTimer);
  if (options.immediate) {
    renderProductDuplicateSuggestions();
    return;
  }
  productDuplicateCheckTimer = window.setTimeout(renderProductDuplicateSuggestions, 180);
}

form?.addEventListener("input", event => {
  if (event.target.matches(
    "#product-name, #product-brand, #product-model, #product-category, #product-subcategory, #product-perfume-concentration, #product-perfume-volume, [data-group-storage], [data-group-ram], [data-group-storage-unit]"
  )) scheduleProductDuplicateCheck();
});
form?.addEventListener("change", event => {
  if (event.target.matches(
    "#product-name, #product-brand, #product-model, #product-category, #product-subcategory, #product-perfume-concentration, #product-perfume-volume, [data-group-storage], [data-group-ram], [data-group-storage-unit]"
  )) scheduleProductDuplicateCheck({ immediate: true });
});
$("#product-duplicate-results")?.addEventListener("click", event => {
  const button = event.target.closest("[data-duplicate-edit]");
  if (!button) return;
  const product = products.find(item => String(item.id) === String(button.dataset.duplicateEdit));
  if (!product) {
    message("#product-form-status", "Ese producto ya no está disponible en la lista. Actualizá el inventario y volvé a intentarlo.", "error");
    return;
  }
  const currentId = String($("#product-id")?.value || "").trim();
  const hasUnsavedEntry = Boolean(
    String($("#product-name")?.value || "").trim() ||
    String($("#product-brand")?.value || "").trim()
  );
  if (hasUnsavedEntry && currentId !== String(product.id) &&
      !window.confirm('Vas a abrir "' + product.name + '". Los datos que estás escribiendo no se guardarán. ¿Querés continuar?')) return;
  showAdminSection("add");
  fillEditor(product);
  scheduleProductDuplicateCheck({ immediate: true });
});

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
    "dashboard-drafts-label": isAll ? "No publicados" : isPerfume ? "Fragancias no publicadas" : "No publicados",
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
  document.body.classList.toggle("admin-catalog-perfumery", isPerfume);
  const category = $("#product-category");
  if (category) {
    const previous = isPerfume ? category.value : normalizeTechnologyCategory(category.value);
    const options = isPerfume
      ? [{ value: "Perfumería", label: "Perfumería" }]
      : [
          { value: "", label: "Seleccionar categoría…", disabled: true },
          { value: "Celulares", label: "Celulares" },
          { value: "Laptops", label: "Laptops" },
          { value: "Tablets", label: "Tablets" },
          { value: "Gaming", label: "Gaming" },
          { value: "Consolas", label: "Consolas" },
          { value: "Televisores", label: "Televisores" },
          { value: "Audio", label: "Audio" },
          { value: "Accesorios", label: "Accesorios" },
          { value: "Otros", label: "Otros" }
        ];
    if (previous && !options.some(option => option.value === previous)) {
      options.push({ value: previous, label: previous + " (categoría existente)" });
    }
    if (previous && !options.some(option => option.value === previous)) {
      options.push({ value: previous, label: previous + " (categoría existente)" });
    }
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

  $("#product-category-field")?.classList.toggle("hidden", isPerfume);
  if ($("#product-perfume-family")) $("#product-perfume-family").required = isPerfume;
  if ($("#product-type")) $("#product-type").value = isPerfume ? ($("#product-type").value === "set" ? "set" : "perfume") : "standard";
  const isSet = isPerfume && $("#product-type")?.value === "set";
  $("#product-perfume-concentration-field")?.classList.toggle("hidden", isSet);
  $("#product-perfume-volume-field")?.classList.toggle("hidden", isSet);
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
  $("#product-taxonomy-fields")?.classList.remove("hidden");
  $("#product-tech-tag-options")?.classList.toggle("hidden", isPerfume);
  $("#product-subcategory-field")?.classList.toggle("hidden", isPerfume);
  const tagTitle = $("#product-tags-title");
  const tagDescription = $("#product-tags-description");
  if (tagTitle) tagTitle.textContent = isPerfume ? "Colección y edición especial" : "Etiquetas manuales";
  if (tagDescription) tagDescription.textContent = isPerfume
    ? "Destacá fragancias o sets que sean realmente exclusivos o de edición limitada."
    : "Elegí solo las etiquetas que correspondan; no se asignan automáticamente por marca.";
  if (isPerfume) {
    $("#product-subcategory").value = "";
    $("#product-subcategory-custom").value = "";
    $("#product-subcategory-custom").hidden = true;
    $("#product-custom-tags").value = "";
    customProductTags = [];
    renderCustomProductTagChips();
  }

  // Exclusivity/featured is a technology-only control. Keep it out of JB Parfums.
  const exclusiveToggle = $("#toggle-product-exclusive");
  exclusiveToggle?.classList.toggle("hidden", isPerfume);
  if (exclusiveToggle) {
    exclusiveToggle.disabled = isPerfume;
    if (isPerfume) {
      $("#product-exclusive").checked = false;
      $("#product-featured").checked = false;
      exclusiveToggle.setAttribute("aria-pressed", "false");
      exclusiveToggle.classList.remove("is-active");
    }
  }

  const galleryTitle = $("#product-images-title");
  if (galleryTitle) galleryTitle.textContent = isPerfume
    ? (isSet ? "Fotografías generales del set" : "Fotografías generales de la fragancia")
    : "Fotografías generales del producto";

  const editing = Boolean(editorRecordExists && $("#product-id")?.value);
  const formTitle = $("#form-title");
  const saveButton = $("#save-product-button");
  if (formTitle && !editing) formTitle.textContent = isPerfume ? ($("#product-type")?.value === "set" ? "Registrar set de perfumes" : "Registrar fragancia") : "Agregar producto";
  if (saveButton && !editing) { saveButton.setAttribute("aria-label", "Guardar producto sin publicar"); saveButton.title = "Guardar producto sin publicar"; }

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
    "admin-nav-drafts-label": isPerfume ? "Borradores de perfumería" : "Borradores de tecnología",
    "published-section-title": isPerfume ? "Fragancias publicadas" : "Productos publicados",
    "unpublished-section-title": isPerfume ? "Fragancias no publicadas" : "Productos no publicados",
    "draft-section-title": isPerfume ? "Borradores de perfumería" : "Borradores de tecnología",
    "trash-section-title": isPerfume ? "Papelera de perfumería" : "Papelera de tecnología"
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

function normalizeTechnologyCategory(value = "") {
  const original = String(value || "").trim();
  const normalized = original
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (["celular", "celulares", "smartphone", "smartphones", "telefono", "telefonos", "movil", "moviles", "mobile", "mobiles"].includes(normalized)) return "Celulares";
  if (["laptop", "laptops", "portatil", "portatiles", "notebook", "notebooks"].includes(normalized)) return "Laptops";
  if (["tablet", "tablets", "tableta", "tabletas"].includes(normalized)) return "Tablets";
  if (["consola", "consolas", "console", "consoles", "videojuego", "videojuegos", "gaming console", "gaming consoles"].includes(normalized)) return "Consolas";
  return original;
}

function categoryUsesRamStorage(category = $("#product-category")?.value || "") {
  return ["Celulares", "Tablets", "Laptops"].includes(normalizeTechnologyCategory(category));
}

function updateCategoryVariantVisibility() {
  const category = normalizeTechnologyCategory($("#product-category")?.value || "");
  const usesRamStorage = categoryUsesRamStorage(category);
  baseColorManager?.classList.toggle("is-ram-storage", usesRamStorage);
  const addVariantButton = $("#add-variant-button");

  // Todas las categorías tecnológicas pueden tener variantes de capacidad,
  // RAM, precio y color. Estos campos son opcionales; la categoría solo define
  // qué datos son obligatorios al publicar ciertos productos.
  addVariantButton?.classList.remove("hidden");
  if (addVariantButton) {
    addVariantButton.textContent = "+ Agregar variante";
    addVariantButton.title = "Agregar otra variante de capacidad, RAM, precio y color";
    addVariantButton.setAttribute("aria-label", "Agregar variante de capacidad, RAM, precio y color");
  }

  form?.querySelectorAll("[data-variant-group]").forEach(group => {
    group.querySelectorAll(".variant-storage-label, [data-group-ram]").forEach(field => {
      const wrapper = field.matches("label") ? field : field.closest("label");
      wrapper?.classList.remove("hidden");
    });
    const hint = group.querySelector(".variant-config-group-heading small");
    if (hint) hint.textContent = group.dataset.baseGroup === "true"
      ? "Configuración opcional: agregá almacenamiento, RAM, precios y colores según corresponda."
      : "Agregá almacenamiento, RAM, precios y colores para esta variante. Los campos que no apliquen pueden quedar vacíos.";
  });
  const title = $("#variants-editor-title");
  if (title) title.textContent = "Variantes, capacidades y precios";
  const sectionTitle = $("#product-form-section-title-2");
  if (sectionTitle) sectionTitle.textContent = "Variantes, capacidades y precios";
}

function setActiveCatalogType(value) {
  activeCatalogType = normalizeCatalogType(value);
  if (activeCatalogSelector) activeCatalogSelector.value = activeCatalogType;
  updateProductFormMode();
  syncProductFormSectionAvailability();
  updateCategoryVariantVisibility();
  setProductFormStep(1, { scroll: false });
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

  ,
  { name: "Titanium Gray", hex: "#85878B", aliases: ["Titanium Grey", "Gris titanio Samsung", "Titanio gris Samsung", "Galaxy Titanium Gray"] },
  { name: "Titanium Silverblue", hex: "#8EA3BA", aliases: ["Titanium Silver Blue", "Titanium Silver-Blue", "Titanio plata azul"] },
  { name: "Titanium Whitesilver", hex: "#D8DADD", aliases: ["Titanium White Silver", "Titanium Whitesilver", "Titanio blanco plata"] },
  { name: "Titanium Jetblack", hex: "#292B2D", aliases: ["Titanium Jet Black", "Jetblack Titanium", "Titanio Jet Black"] },
  { name: "Titanium Jadegreen", hex: "#4C6855", aliases: ["Titanium Jade Green", "Titanio verde jade"] },
  { name: "Titanium Pinkgold", hex: "#B99498", aliases: ["Titanium Pink Gold", "Titanio oro rosa"] },
  { name: "Titanium Violet", hex: "#817A9D", aliases: ["Titanio violeta", "Titanium Purple"] },
  { name: "Titanium Yellow", hex: "#D5B15F", aliases: ["Titanio amarillo"] },
  { name: "Blue Titanium", hex: "#657D9E", aliases: ["Azul titanio", "Titanio azul"] },
  { name: "Deep Blue", hex: "#203958", aliases: ["Azul profundo", "Dark Deep Blue"] },
  { name: "Ultramarine", hex: "#4864B8", aliases: ["Ultramarino", "Azul ultramarino"] },
  { name: "Teal", hex: "#579B91", aliases: ["Verde azulado", "Azul verdoso"] },
  { name: "Pacific Blue", hex: "#4C739B", aliases: ["Azul Pacífico"] },
  { name: "Midnight Green", hex: "#324A45", aliases: ["Verde medianoche"] },
  { name: "Space Gray", hex: "#55595E", aliases: ["Space Grey", "Gris espacial"] },
  { name: "Space Black", hex: "#303236", aliases: ["Negro espacial"] },
  { name: "Starlight", hex: "#F1EDE3", aliases: ["Luz de estrella", "Star Light"] },
  { name: "Rose Gold", hex: "#D4A2A3", aliases: ["Oro rosa", "Rosa dorado"] },
  { name: "Sky Blue", hex: "#7CB7DA", aliases: ["Azul cielo", "Cielo azul"] },
  { name: "Icyblue", hex: "#C2DDF2", aliases: ["Icy Blue", "Azul hielo Samsung"] },
  { name: "Silver Shadow", hex: "#BCC0C4", aliases: ["Sombra plateada", "Silvershadow"] },
  { name: "Navy", hex: "#233657", aliases: ["Azul marino", "Navy Blue"] },
  { name: "Mint", hex: "#A8D8C2", aliases: ["Menta"] },
  { name: "Blue Shadow", hex: "#758FA5", aliases: ["Sombra azul"] },
  { name: "Obsidian", hex: "#26282A", aliases: ["Obsidiana"] },
  { name: "Porcelain", hex: "#EDEBE5", aliases: ["Porcelana"] },
  { name: "Hazel", hex: "#7C8273", aliases: ["Avellana", "Verde avellana"] },
  { name: "Bay", hex: "#7EA8D0", aliases: ["Azul bahía"] },
  { name: "Peony", hex: "#D99CAB", aliases: ["Peonía"] },
  { name: "Wintergreen", hex: "#DAE8D4", aliases: ["Verde invierno"] },
  { name: "Lemongrass", hex: "#D3D9A1", aliases: ["Hierba limón"] },
  { name: "Seafoam", hex: "#C3E6DB", aliases: ["Espuma de mar", "Verde espuma"] },
  { name: "Rose Quartz", hex: "#D8B5B6", aliases: ["Cuarzo rosa"] },
  { name: "Sorta Sage", hex: "#B4C9B6", aliases: ["Salvia suave"] },
  { name: "Glacier Blue", hex: "#8CB4D8", aliases: ["Azul glaciar"] },
  { name: "Aurora Green", hex: "#3F7766", aliases: ["Verde aurora"] },
  { name: "Mystic Silver", hex: "#CBD0D7", aliases: ["Plata mística"] },
  { name: "Titan Gray", hex: "#686D72", aliases: ["Titan Grey", "Gris titanio oscuro"] },
  { name: "Moonlight White", hex: "#EBE9E2", aliases: ["Blanco luna"] },
  { name: "Obsidian Black", hex: "#1F2024", aliases: ["Negro obsidiana"] },
  { name: "Jungle Breath", hex: "#677E69", aliases: ["Aliento de jungla"] },
  { name: "Sleek Black", hex: "#222326", aliases: ["Negro elegante"] },
  { name: "Shadow Blue", hex: "#536A8C", aliases: ["Azul sombra"] },
  { name: "Tropical Green", hex: "#7DAB91", aliases: ["Verde tropical"] },
  { name: "Lunar White", hex: "#E4E4DF", aliases: ["Blanco lunar"] },
  { name: "Ocean Blue", hex: "#3674A2", aliases: ["Azul océano"] },
  { name: "Pearl White", hex: "#EFEBE2", aliases: ["Blanco perla"] },
  { name: "Starry Black", hex: "#252A34", aliases: ["Negro estrellado"] },
  { name: "Interstellar Blue", hex: "#3A5277", aliases: ["Azul interestelar"] },
  { name: "Starry Silver", hex: "#BABEC5", aliases: ["Plata estrellada"] },
  { name: "Frost Blue", hex: "#D8E7F1", aliases: ["Azul escarcha"] },
  { name: "Arctic White", hex: "#F3F5F6", aliases: ["Blanco ártico"] },
  { name: "Phantom Black", hex: "#1B1C21", aliases: ["Negro fantasma"] },
  { name: "Phantom Silver", hex: "#C0C3C9", aliases: ["Plata fantasma"] },
  { name: "Aura Glow", hex: "#CFD6D8", aliases: ["Brillo aura"] },
  { name: "Prism Black", hex: "#22242D", aliases: ["Negro prisma"] },
  { name: "Prism Blue", hex: "#536FA7", aliases: ["Azul prisma"] },
  { name: "Mystic Bronze", hex: "#907A69", aliases: ["Bronce místico"] },
  { name: "Lavender", hex: "#B5A2D3", aliases: ["Lavanda"] },
  { name: "Lilac", hex: "#C7B1D9", aliases: ["Lila"] },
  { name: "Cream", hex: "#F4E5CE", aliases: ["Crema"] },
  { name: "Sandstone", hex: "#D7C3A5", aliases: ["Arenisca", "Arena"] },
  { name: "Coffee Brown", hex: "#705240", aliases: ["Marrón café", "Café oscuro"] },
  { name: "Cherry Red", hex: "#C74751", aliases: ["Rojo cereza"] },
  { name: "Sunset Gold", hex: "#DAB56D", aliases: ["Oro atardecer"] },
  { name: "Pistachio", hex: "#B8C99B", aliases: ["Pistacho"] },
  { name: "Graphene Gray", hex: "#565A60", aliases: ["Graphene Grey", "Gris grafeno"] },
  { name: "Mocha Brown", hex: "#765D4E", aliases: ["Marrón moca"] },
  { name: "Coral Red", hex: "#D96364", aliases: ["Rojo coral"] },
  { name: "Glowing Black", hex: "#21252D", aliases: ["Negro brillante"] },
  { name: "Black Onyx", hex: "#292D32", aliases: ["Ónix negro"] },
  { name: "Snow White", hex: "#F5F4EF", aliases: ["Blanco nieve"] },
  { name: "Ice Blue", hex: "#D3E8F4", aliases: ["Azul hielo claro"] },
  { name: "Shadow Gray", hex: "#77797E", aliases: ["Shadow Grey", "Gris sombra"] },
  { name: "Titanium Rose", hex: "#B88D91", aliases: ["Titanio rosa"] },
  { name: "Titanium Gold", hex: "#B9A17D", aliases: ["Titanio dorado"] },
  { name: "Titanium Green", hex: "#718A78", aliases: ["Titanio verde"] },
  { name: "Glacier White", hex: "#E9F0F4", aliases: ["Blanco glaciar"] },
  { name: "Midnight Black", hex: "#191B20", aliases: ["Negro medianoche"] },
  { name: "Forest Green", hex: "#315B48", aliases: ["Verde bosque"] },
  { name: "Ocean Green", hex: "#337C78", aliases: ["Verde océano"] },
  { name: "Electric Purple", hex: "#7950C8", aliases: ["Morado eléctrico"] },
  { name: "Royal Blue", hex: "#315BB4", aliases: ["Azul real"] },
  { name: "Steel Gray", hex: "#717982", aliases: ["Steel Grey", "Gris acero"] },
  { name: "Ice Silver", hex: "#D7DCE1", aliases: ["Plata hielo"] },
  { name: "Copper", hex: "#B87345", aliases: ["Cobre"] },
  { name: "Bronze", hex: "#9C785D", aliases: ["Bronce"] },
  { name: "Bora Purple", hex: "#8A77B5", aliases: ["Morado Bora"] },
  { name: "Phantom Violet", hex: "#786D93", aliases: ["Violeta fantasma"] },
  { name: "Glacier Gray", hex: "#A6ADB4", aliases: ["Glacier Grey", "Gris glaciar"] }

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
  const incomingAliases = [...new Set((Array.isArray(color?.aliases) ? color.aliases : []).map(value => String(value || "").trim()).filter(Boolean))].slice(0, 20);
  const sameName = data.items.find(item => normalizeColorSearch(item.name) === normalizeColorSearch(name) && item.hex !== hex.toUpperCase());
  if (sameName) return { ok: false, message: "Ya existe ese nombre con otro HEX. Usá un nombre más específico para distinguir los tonos." };
  if (!existing) data.items.unshift({ name, hex: hex.toUpperCase(), aliases: incomingAliases, favorite: false, updatedAt: Date.now() });
  else {
    existing.aliases = [...new Set([...(existing.aliases || []), ...incomingAliases])].slice(0, 20);
    existing.updatedAt = Date.now();
  }
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

function sharedColorNameKey(value) { return normalizeColorSearch(value).replace(/\s+/g, " ").trim(); }
async function persistColorLibraryEntry(color, options = {}) {
  const name = String(color?.name || "").trim(), hex = validHex(color?.hex, "").toUpperCase(), name_key = sharedColorNameKey(name);
  if (!name || !hex || !name_key) return {ok:false, message:"Nombre o HEX inválido."};
  if (!supabase || !currentUser?.id) return {ok:false, message:"No hay sesión para sincronizar."};
  try {
    const lookup = await supabase.from("color_library").select("id,name,name_key,hex,aliases,is_favorite").eq("name_key", name_key).maybeSingle();
    if (lookup.error) throw lookup.error;
    const existing = lookup.data || null;
    if (existing && String(existing.hex || "").toUpperCase() !== hex) return {ok:false, message:"Ese nombre ya está registrado con otro HEX. Usá un nombre más específico."};
    const aliases = [...new Set([...(existing?.aliases || []), ...(color?.aliases || []), ...(options.aliases || [])].map(v=>String(v||"").trim()).filter(Boolean))].slice(0,20);
    const favorite = typeof options.favorite === "boolean" ? options.favorite : Boolean(existing?.is_favorite || color?.favorite);
    const {error} = await supabase.from("color_library").upsert({name,name_key,hex,aliases,is_favorite:favorite,updated_by:currentUser.id,updated_at:new Date().toISOString()},{onConflict:"name_key"});
    if (error) throw error;
    return {ok:true,message:"Color sincronizado con la biblioteca compartida."};
  } catch (error) {
    console.warn("No se pudo sincronizar la biblioteca compartida de colores.",error);
    return {ok:false,message:"Quedó en este dispositivo, pero no se pudo sincronizar con Supabase."};
  }
}
async function syncSharedColorLibrary(options = {}) {
  if (!supabase || !currentUser?.id) return false;
  try {
    let result = await supabase.from("color_library").select("id,name,name_key,hex,aliases,is_favorite,updated_at").order("updated_at",{ascending:false}).limit(500);
    if (result.error) throw result.error;
    let rows = Array.isArray(result.data) ? result.data : [];
    const local = readColorLibraryData(), remote = new Map(rows.map(v=>[v.name_key || sharedColorNameKey(v.name),v]));
    if (options.migrateLocal !== false) {
      for (const item of local.items) {
        const key = sharedColorNameKey(item.name), existing = remote.get(key);
        if (!existing) {
          const saved = await persistColorLibraryEntry(item,{favorite:Boolean(item.favorite),aliases:item.aliases||[]});
          if (saved.ok) remote.set(key,{name:item.name,name_key:key,hex:item.hex,aliases:item.aliases||[],is_favorite:Boolean(item.favorite)});
        } else if (String(existing.hex||"").toUpperCase() === String(item.hex||"").toUpperCase()) {
          const aliases = [...new Set([...(existing.aliases||[]),...(item.aliases||[])])], favorite = Boolean(existing.is_favorite||item.favorite);
          if (aliases.length !== (existing.aliases||[]).length || favorite !== Boolean(existing.is_favorite)) await persistColorLibraryEntry({...item,aliases},{favorite,aliases});
        }
      }
      result = await supabase.from("color_library").select("id,name,name_key,hex,aliases,is_favorite,updated_at").order("updated_at",{ascending:false}).limit(500);
      if (result.error) throw result.error;
      rows = Array.isArray(result.data) ? result.data : [];
    }
    const merged = new Map();
    rows.forEach(item=>{ const name=String(item.name||"").trim(), hex=validHex(item.hex,"").toUpperCase(); if(name&&hex) merged.set(sharedColorNameKey(name),{name,hex,aliases:Array.isArray(item.aliases)?item.aliases:[],favorite:Boolean(item.is_favorite),updatedAt:item.updated_at?Date.parse(item.updated_at)||0:0}); });
    for (const item of local.items) if (!merged.has(sharedColorNameKey(item.name))) merged.set(sharedColorNameKey(item.name),item);
    const data=readColorLibraryData();
    data.items=[...merged.values()].sort((a,b)=>Number(b.updatedAt||0)-Number(a.updatedAt||0)).slice(0,500);
    writeColorLibraryData(data); data.items.forEach(ensureColorInPalette); renderColorLibraryDatalist();
    if (typeof renderQuickColorPalette==="function") renderQuickColorPalette(typeof quickColorSearch!=="undefined"?quickColorSearch?.value||"":"");
    form?.querySelectorAll("[data-variant-row]").forEach(syncColorLibraryRowControls);
    return true;
  } catch(error) { console.warn("No se pudo cargar la biblioteca compartida de colores.",error); return false; }
}
async function colorImageToDataUrl(file) {
  if (!file || !String(file.type||"").startsWith("image/")) throw new Error("Elegí una fotografía válida del producto.");
  if (file.size > 18*1024*1024) throw new Error("La imagen es demasiado grande. Elegí una de menos de 18 MB.");
  let bitmap; try { bitmap=await createImageBitmap(file); } catch { throw new Error("No se pudo abrir la imagen. Probá con JPG, PNG o WebP."); }
  try {
    const scale=Math.min(1,1200/Math.max(bitmap.width,bitmap.height)), canvas=document.createElement("canvas");
    canvas.width=Math.max(1,Math.round(bitmap.width*scale)); canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const context=canvas.getContext("2d"); if(!context) throw new Error("No se pudo procesar la fotografía.");
    context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const url=canvas.toDataURL("image/jpeg",0.82); if(url.length>5600000) throw new Error("La imagen todavía pesa demasiado. Elegí otra fotografía.");
    return url;
  } finally { bitmap.close?.(); }
}
function openColorAssistant(row) {
  if(!row) return;
  document.getElementById("jb-color-ai-overlay")?.remove();
  const overlay=document.createElement("div"); overlay.id="jb-color-ai-overlay"; overlay.className="jb-color-ai-overlay";
  overlay.innerHTML=
    '<section class="jb-color-ai-dialog" role="dialog" aria-modal="true" aria-labelledby="jb-color-ai-title">'+
    '<header class="jb-color-ai-header"><div><p class="jb-color-ai-eyebrow">JB COLLECTIONS · COLOR LAB</p><h2 id="jb-color-ai-title">Identificar color con IA</h2></div><button type="button" class="jb-color-ai-close" data-color-ai-close aria-label="Cerrar">×</button></header>'+
    '<p class="jb-color-ai-intro">Consultá por código o referencia, o adjuntá una foto. La sugerencia no confirma un color oficial.</p>'+
    '<label class="jb-color-ai-field">Marca y modelo<input type="text" data-color-ai-product maxlength="180" placeholder="Ej. Samsung Galaxy S25 Ultra"></label>'+
    '<label class="jb-color-ai-field">Código del fabricante o consulta<input type="text" data-color-ai-query maxlength="320" placeholder="Ej. Titanium Jadegreen, código X..."></label>'+
    '<label class="jb-color-ai-field">Alias o código exacto para recordar (opcional)<input type="text" data-color-ai-library-alias maxlength="80" placeholder="Ej. SM-S938B Titanium Jadegreen"><span class="jb-color-ai-file-note">Se guardará como referencia de búsqueda solo si pulsás «Guardar en biblioteca».</span></label>'+
    '<label class="jb-color-ai-field">Fotografía del producto (opcional)<input type="file" data-color-ai-image accept="image/jpeg,image/png,image/webp,image/avif"><span class="jb-color-ai-file-note" data-color-ai-file-note>La foto solo se usa en esta consulta.</span></label>'+
    '<div class="jb-color-ai-preview" data-color-ai-preview hidden><img alt="Vista previa"><span data-color-ai-file-name></span></div>'+
    '<div class="jb-color-ai-actions"><button type="button" class="jb-color-ai-primary" data-color-ai-analyze>Analizar color</button></div>'+
    '<p class="jb-color-ai-status" data-color-ai-status role="status" aria-live="polite"></p>'+
    '<section class="jb-color-ai-result" data-color-ai-result hidden><div class="jb-color-ai-result-main"><span class="jb-color-ai-result-swatch" data-color-ai-swatch></span><div><h3 data-color-ai-name></h3><code data-color-ai-hex></code></div></div><p data-color-ai-basis></p><p data-color-ai-explanation></p><div class="jb-color-ai-aliases" data-color-ai-aliases></div><div class="jb-color-ai-actions"><button type="button" class="jb-color-ai-secondary" data-color-ai-save>Guardar en biblioteca</button><button type="button" class="jb-color-ai-primary" data-color-ai-apply>Aplicar a esta variante</button></div></section>'+
    '<p class="jb-color-ai-disclaimer">El HEX de una foto es aproximado por la iluminación, reflejos y acabado. Los códigos por texto no se verifican contra el fabricante en tiempo real.</p></section>';
  document.body.append(overlay);
  const productInput=overlay.querySelector("[data-color-ai-product]"), queryInput=overlay.querySelector("[data-color-ai-query]"), libraryAliasInput=overlay.querySelector("[data-color-ai-library-alias]"), imageInput=overlay.querySelector("[data-color-ai-image]");
  const fileNote=overlay.querySelector("[data-color-ai-file-note]"), preview=overlay.querySelector("[data-color-ai-preview]"), previewImage=preview.querySelector("img"), fileName=overlay.querySelector("[data-color-ai-file-name]");
  const status=overlay.querySelector("[data-color-ai-status]"), resultPanel=overlay.querySelector("[data-color-ai-result]"), analyzeButton=overlay.querySelector("[data-color-ai-analyze]");
  const saveButton=overlay.querySelector("[data-color-ai-save]"), applyButton=overlay.querySelector("[data-color-ai-apply]");
  let colorResult=null, previewUrl="";
  productInput.value=[$("#product-brand")?.value||"",$("#product-model")?.value||"",$("#product-name")?.value||""].filter(Boolean).join(" ").slice(0,180);
  const activeName=row.querySelector("[data-variant-color]")?.value.trim()||""; if(activeName) queryInput.value=activeName;
  function close(){if(previewUrl)URL.revokeObjectURL(previewUrl);overlay.remove();document.removeEventListener("keydown",onKeyDown,true);}
  function onKeyDown(event){if(event.key==="Escape")close();}
  overlay.querySelector("[data-color-ai-close]").addEventListener("click",close);
  overlay.addEventListener("click",event=>{if(event.target===overlay)close();});
  document.addEventListener("keydown",onKeyDown,true);
  imageInput.addEventListener("change",()=>{const file=imageInput.files?.[0];if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl="";if(!file){preview.hidden=true;return;}previewUrl=URL.createObjectURL(file);previewImage.src=previewUrl;fileName.textContent=file.name;preview.hidden=false;fileNote.textContent="Fotografía preparada para analizar.";});
  analyzeButton.addEventListener("click",async()=>{
    const query=queryInput.value.trim(), productContext=productInput.value.trim(), file=imageInput.files?.[0]||null;
    if(!query&&!file){status.textContent="Escribí una referencia/pregunta o adjuntá una foto.";status.dataset.state="error";return;}
    if(!supabase||!currentUser?.id){status.textContent="Volvé a iniciar sesión como administrador.";status.dataset.state="error";return;}
    analyzeButton.disabled=true;analyzeButton.textContent="Analizando…";status.textContent=file?"Analizando la fotografía…":"Consultando la referencia…";status.dataset.state="busy";resultPanel.hidden=true;colorResult=null;
    try{
      const session=await supabase.auth.getSession(), token=session.data?.session?.access_token||"";if(!token)throw new Error("La sesión expiró. Volvé a iniciar sesión.");
      const imageDataUrl=file?await colorImageToDataUrl(file):"", apiBase=String(CONFIG.publicCatalogUrl||"https://jb-collections.pages.dev").replace(/\/+$/,"");
      const response=await fetch(apiBase+"/api/color-assistant",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},body:JSON.stringify({query,productContext,imageDataUrl})});
      const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.message||"No se pudo analizar el color (HTTP "+response.status+").");
      if(!payload.name||!/^#[0-9a-f]{6}$/i.test(String(payload.hex||"")))throw new Error("La IA no encontró un color claro. Probá otra foto o agregá el modelo exacto.");
      colorResult={name:String(payload.name).trim(),hex:String(payload.hex).toUpperCase(),aliases:Array.isArray(payload.aliases)?payload.aliases.map(v=>String(v||"").trim()).filter(Boolean).slice(0,8):[],favorite:false};
      overlay.querySelector("[data-color-ai-swatch]").style.background=colorResult.hex;
      overlay.querySelector("[data-color-ai-name]").textContent=colorResult.name;
      overlay.querySelector("[data-color-ai-hex]").textContent=colorResult.hex;
      overlay.querySelector("[data-color-ai-basis]").textContent=payload.basis==="visual_estimate"?"Estimación visual basada en la fotografía.":payload.basis==="shared_library_match"?"Coincidencia exacta con la biblioteca compartida; no equivale a verificación oficial.":"Sugerencia por texto/código; no verificada oficialmente.";
      overlay.querySelector("[data-color-ai-explanation]").textContent=String(payload.explanation||payload.note||"Confirmá el nombre con la ficha del fabricante antes de publicarlo.");
      const aliases=overlay.querySelector("[data-color-ai-aliases]");aliases.replaceChildren();colorResult.aliases.forEach(alias=>{const chip=document.createElement("span");chip.textContent=alias;aliases.append(chip);});
      resultPanel.hidden=false;status.textContent="Resultado listo. Guardalo en la biblioteca o aplicalo a esta variante.";status.dataset.state="success";
    }catch(error){status.textContent=error.message||"No se pudo analizar el color.";status.dataset.state="error";}
    finally{analyzeButton.disabled=false;analyzeButton.textContent="Analizar color";}
  });
  saveButton.addEventListener("click",async()=>{
    if(!colorResult)return;
    const savedAlias=String(libraryAliasInput?.value||"").trim();
    const colorToSave={...colorResult,aliases:[...new Set([...(colorResult.aliases||[]),savedAlias].filter(Boolean))]};
    const local=saveColorToLibrary(colorToSave);if(!local.ok){status.textContent=local.message;status.dataset.state="error";return;}
    const shared=await persistColorLibraryEntry(colorToSave);
    status.textContent=(shared.ok?local.message+" Sincronizado en todos los dispositivos.":local.message+" "+shared.message)+(savedAlias?" Alias guardado: "+savedAlias+".":"");
    status.dataset.state=shared.ok?"success":"warning";
    renderColorLibraryDatalist();if(typeof renderQuickColorPalette==="function")renderQuickColorPalette(typeof quickColorSearch!=="undefined"?quickColorSearch?.value||"":"");
    form?.querySelectorAll("[data-variant-row]").forEach(syncColorLibraryRowControls);
  });
  applyButton.addEventListener("click",()=>{
    if(!colorResult)return;applyColorToRow(row,colorResult);
    const search=row.querySelector("[data-variant-library-search]");if(search)search.value=colorResult.name;
    const rowStatus=row.querySelector("[data-variant-status]");if(rowStatus){rowStatus.textContent="Color sugerido por IA aplicado al formulario. Guardá el producto para persistir la variante.";rowStatus.dataset.state="success";}
    close();
  });
  overlay.querySelector("[data-color-ai-close]").focus();
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
  if (isRememberedSessionEnabled()) return;
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

function syncRememberControls() {
  const enabled = isRememberedSessionEnabled();
  const checkbox = $("#login-remember-user");
  if (checkbox) checkbox.checked = enabled;
  const button = $("#remember-user-toggle");
  const label = $("#remember-user-toggle-label");
  if (button) {
    button.setAttribute("aria-pressed", String(enabled));
    button.setAttribute("aria-label", enabled ? "Dejar de recordar este usuario" : "Recordar mi sesión en este dispositivo");
    button.title = enabled ? "Desactivar sesión recordada" : "Recordar sesión";
  }
  if (label) label.textContent = enabled ? "Desactivar recordar sesión" : "Recordar sesión en este dispositivo";
}

function setRememberedSession(enabled, email = "") {
  const key = authStorageKey();
  const normalizedEmail = String(email || "").trim();
  try {
    const currentToken = key
      ? (window.sessionStorage.getItem(key) || window.localStorage.getItem(key))
      : null;

    if (enabled) {
      window.localStorage.setItem(REMEMBER_SESSION_KEY, "true");
      if (normalizedEmail) window.localStorage.setItem(REMEMBER_EMAIL_KEY, normalizedEmail);
      if (key && currentToken) {
        window.localStorage.setItem(key, currentToken);
        window.sessionStorage.removeItem(key);
      }
    } else {
      // Keep a current login active until logout, but stop persisting it across app restarts.
      if (key && currentToken) window.sessionStorage.setItem(key, currentToken);
      if (key) window.localStorage.removeItem(key);
      window.localStorage.removeItem(REMEMBER_SESSION_KEY);
      window.localStorage.removeItem(REMEMBER_EMAIL_KEY);
    }
  } catch (error) {
    console.warn("No se pudo actualizar la preferencia para recordar la sesión.", error);
    message("#login-status", "No se pudo actualizar esta preferencia en el dispositivo. Revisá el almacenamiento disponible.", "error");
  }
  syncRememberControls();
}

// Restore the saved email and visible state whenever the admin module loads.
const rememberedLoginEmail = $("#login-email");
if (rememberedLoginEmail && isRememberedSessionEnabled()) {
  rememberedLoginEmail.value = getRememberedAdminEmail();
}
syncRememberControls();

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
  clearCatalogAdminActivityMarker();

  document.body.classList.remove("admin-dashboard-active");
  setMobileSidebarOpen(false);
  dashboard.classList.add("hidden");
  loginPanel.classList.remove("hidden");

  if (form) {
    form.reset();
  }

  clearEditor();

  $("#login-email").value = getRememberedAdminEmail();
  clearLoginPassword();
  syncRememberControls();

  setStatus("");
  message("#login-status", statusText, type);
}

/* =========================================================
   ESPECIFICACIONES E IMÁGENES
   ========================================================= */

function isGeneratedSpecificationLabel(label) {
  return /^dato(?:\s+\d+)?$/i.test(String(label || "").trim());
}

function cleanSpecificationLine(value) {
  let line = String(value ?? "").trim();
  line = line.replace(/^(?:(?:[•●▪◦]|\*|-\s)\s*)+/g, "");
  line = line.replace(/^Dato\s*\d+\s*:\s*/i, "");
  line = line.replace(/^(?:(?:[•●▪◦]|\*|-\s)\s*)+/g, "");
  return line.trim();
}

function parseSpecs(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map(cleanSpecificationLine)
    .filter(Boolean);

  if (!lines.length) return {};

  const allLinesHaveLabels = lines.every(line => {
    const colon = line.indexOf(":");
    return colon > 0 && !isGeneratedSpecificationLabel(line.slice(0, colon));
  });

  if (allLinesHaveLabels) {
    const result = {};
    lines.forEach(line => {
      const colon = line.indexOf(":");
      result[line.slice(0, colon).trim()] = cleanSpecificationLine(line.slice(colon + 1));
    });
    return result;
  }

  return lines.map(line => {
    const colon = line.indexOf(":");
    return colon > 0 && isGeneratedSpecificationLabel(line.slice(0, colon))
      ? cleanSpecificationLine(line.slice(colon + 1))
      : line;
  });
}

function specsText(specs) {
  specs = parseJSON(specs, {});

  if (Array.isArray(specs)) {
    return specs.map(item => {
      if (typeof item === "string") return cleanSpecificationLine(item);
      if (item && typeof item === "object") {
        const label = String(item.label || item.name || "").trim();
        const value = cleanSpecificationLine(item.value || "");
        return !label || isGeneratedSpecificationLabel(label) ? value : `${label}: ${value}`;
      }
      return cleanSpecificationLine(item);
    }).filter(Boolean).join("\n");
  }

  if (specs && typeof specs === "object") {
    return Object.entries(specs)
      .map(([key, value]) => isGeneratedSpecificationLabel(key)
        ? cleanSpecificationLine(value)
        : `${key}: ${cleanSpecificationLine(value)}`)
      .filter(Boolean)
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
      configuration_availability: normalizeVariantAvailability(item.configuration_availability),

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
    configuration_availability: "available",
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

function visibleColorSwatches(selectedHex = "") {
  const base = COLOR_PALETTE.slice(0, 20);
  const selected = COLOR_PALETTE.find(item => item.hex.toLowerCase() === String(selectedHex || "").toLowerCase());
  if (selected && !base.some(item => item.hex.toLowerCase() === selected.hex.toLowerCase())) {
    return [...base, selected];
  }
  return base;
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
    <details class="variant-admin-row inline-color-card inline-color-card-collapse" data-variant-row>
      <summary class="inline-color-card-summary">
        <span class="inline-color-dot" data-variant-color-dot style="--inline-color:${v.color_hex}" aria-hidden="true"></span>
        <span class="inline-color-card-summary-copy">
          <strong data-variant-color-summary>${escapeHtml(v.color || "Color sin nombre")}</strong>
          <small data-variant-summary-availability>Estado: ${v.availability === "available" ? "Disponible" : v.availability === "order" ? "Por pedido" : "Agotado"}</small>
        </span>
        <button class="admin-mini-button danger inline-color-remove" type="button" data-remove-variant aria-label="Quitar color" title="Quitar color">×</button>
        <span class="inline-color-card-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div class="inline-color-card-body">
      <div class="inline-color-main">
        <label class="inline-color-name-field">
          <span>Nombre del color</span>
          <input data-variant-color maxlength="60" required value="${escapeHtml(v.color)}" aria-label="Nombre del color" placeholder="Ej. Gris titanio">
        </label>
        <label class="inline-color-tone-field" title="Personalizar el tono">
          <span>Tono</span>
          <input data-variant-hex type="color" value="${v.color_hex}" aria-label="Personalizar el tono del color">
        </label>
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
              <button class="admin-mini-button jb-color-ai-trigger" type="button" data-ai-color-open aria-label="Identificar color con IA o fotografía" title="Identificar color con IA o fotografía">✦ IA / foto</button>
            </div>
          </div>
          <label>Código HEX del color<input data-variant-hex-text type="text" inputmode="text" maxlength="7" pattern="#[0-9a-fA-F]{6}" value="${v.color_hex}" placeholder="#0833A2" aria-label="Código HEX del color"></label>
          <label>Paleta de colores<select data-variant-palette>${colorPaletteOptions(v)}</select></label>
          <div class="variant-swatch-palette" role="group" aria-label="Muestras de colores">${visibleColorSwatches(v.color_hex).map(item => `<button type="button" class="variant-swatch ${item.hex.toLowerCase() === v.color_hex.toLowerCase() ? "is-selected" : ""}" data-variant-swatch="${item.hex}" data-variant-swatch-name="${escapeHtml(item.name)}" title="${escapeHtml(item.name)} · ${item.hex}" aria-label="${escapeHtml(item.name)} ${item.hex}" aria-pressed="${String(item.hex.toLowerCase() === v.color_hex.toLowerCase())}" style="--swatch-color:${item.hex}"></button>`).join("")}</div>
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
      </div>
    </details>`;
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
      // Native CSS grid sizing is stable as fonts, controls, and photo previews load.
      // Never assign masonry row spans: delayed content reflow used to overlap color cards.
      list.style.gridAutoRows = "auto";
      list.style.gridAutoFlow = "row";
      list.querySelectorAll("[data-variant-row]").forEach(card => {
        card.style.gridRowEnd = "auto";
        card.style.alignSelf = "start";
      });
    });
  });
}
form?.addEventListener("toggle", event => {
  if (event.target.matches?.(".inline-color-details, .variant-config-collapse, .inline-color-card-collapse")) scheduleVariantColorLayout();
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
  const configurationAvailability = normalizeVariantAvailability(v.configuration_availability);
  const title = isBase
    ? "Configuración principal"
    : [formatStorageLabel(storage, storageUnit), ram ? ram + " GB RAM" : ""].filter(Boolean).join(" · ") || "Nueva configuración";
  const colorControls = `<div class="variant-color-section">
    <strong class="variant-color-section-title">Colores de esta configuración</strong>
    <div class="variant-color-list" data-variant-color-list></div>
    <button class="admin-mini-button variant-add-color" type="button" data-add-group-color aria-label="Añadir color a esta configuración">+ Color</button>
  </div>`;
  const fields = `<div class="variant-config-fields">
      <label class="variant-storage-label"><span class="variant-storage-label-row"><select class="variant-storage-unit" data-group-storage-unit aria-label="Unidad de almacenamiento"><option value="GB" ${storageUnit === "GB" ? "selected" : ""}>GB</option><option value="TB" ${storageUnit === "TB" ? "selected" : ""}>TB</option></select><span class="variant-storage-name">Almacenamiento</span></span><input data-group-storage type="number" min="1" step="1" inputmode="numeric" value="${escapeHtml(storage)}"></label>
      <label>GB de memoria RAM<input data-group-ram type="number" min="1" step="1" inputmode="numeric" value="${escapeHtml(ram)}"></label>
      <label>Precio en dólares<span class="admin-input-unit"><span>$</span><input data-group-price-usd type="number" min="0" step="0.01" inputmode="decimal" value="${escapeHtml(v.price_usd ?? "")}"></span></label>
      <label>Precio en córdobas<span class="admin-input-unit"><span>C$</span><input data-group-price-nio type="number" min="0" step="0.01" inputmode="decimal" value="${escapeHtml(v.price_nio ?? "")}"></span></label>
      <label class="variant-configuration-availability-field">Disponibilidad de la variante
        <select data-group-availability aria-label="Disponibilidad de esta configuración">
          <option value="available" ${configurationAvailability === "available" ? "selected" : ""}>Disponible</option>
          <option value="order" ${configurationAvailability === "order" ? "selected" : ""}>Bajo pedido</option>
          <option value="out_of_stock" ${configurationAvailability === "out_of_stock" ? "selected" : ""}>Agotado</option>
        </select>
      </label>
    </div>`;

  if (isBase) {
    return `<section class="variant-config-group variant-base-group" data-variant-group data-base-group="true">
      <div class="variant-config-group-heading">
        <div><strong data-variant-group-title>${escapeHtml(title)}</strong><small>Definí RAM, almacenamiento, precio y colores de la configuración principal.</small></div>
      </div>
      ${fields}
      ${colorControls}
    </section>`;
  }

  return `<details class="variant-config-group variant-config-collapse" data-variant-group data-base-group="false">
    <summary class="variant-config-summary">
      <span class="variant-config-summary-copy">
        <strong data-variant-group-title>${escapeHtml(title)}</strong>
        <small data-variant-group-summary>Configuración plegada · expandí para editar precio, disponibilidad y colores</small>
      </span>
      <span class="variant-config-chevron" aria-hidden="true">⌄</span>
    </summary>
    <div class="variant-config-body">
      <div class="variant-config-group-heading">
        <small>Editá los datos de esta configuración</small>
        <button class="admin-mini-button danger" type="button" data-remove-group>Eliminar configuración</button>
      </div>
      ${fields}
      ${colorControls}
    </div>
  </details>`;
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
  if (!groups.size) container.replaceChildren();

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
    if (group?.matches("details.variant-config-collapse")) group.open = true;
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
    const summary = group.querySelector("[data-variant-group-summary]");
    if (summary) {
      const colors = group.querySelectorAll("[data-variant-row]").length;
      const availability = normalizeVariantAvailability(group.querySelector("[data-group-availability]")?.value || "");
      const availabilityLabel = availability === "available" ? "Disponible"
        : availability === "order" || availability === "on_order" ? "Por pedido"
        : availability === "out_of_stock" ? "Agotado" : "Disponibilidad pendiente";
      summary.textContent = colors + " color(es) · " + availabilityLabel + " · tocá para desplegar";
    }
    group.querySelectorAll("[data-variant-row]").forEach((row, index) => {
      const colorName = row.querySelector("[data-variant-color]")?.value.trim();
      const rowHeading = row.querySelector("[data-variant-row-heading]");
      if (rowHeading) rowHeading.textContent = colorName || "Color " + (index + 1);
      const cardSummary = row.querySelector("[data-variant-color-summary]");
      if (cardSummary) cardSummary.textContent = colorName || "Color " + (index + 1);
      const colorAvailability = normalizeVariantAvailability(row.querySelector("[data-variant-availability]")?.value || "");
      const availabilitySummary = row.querySelector("[data-variant-summary-availability]");
      if (availabilitySummary) availabilitySummary.textContent = "Estado: " + (
        colorAvailability === "available" ? "Disponible"
        : colorAvailability === "order" || colorAvailability === "on_order" ? "Por pedido"
        : colorAvailability === "out_of_stock" ? "Agotado" : "Sin confirmar"
      );
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
const retryMainImagesButton = $("#retry-main-image-uploads"), backgroundPhotoUploadStatus = $("#background-photo-upload-status");
let mainImageItems = [], draggingMainImageId = null, draggingVariantImage = null;
let mainImageSyncPending = false, variantImageSyncPending = false, retryMainImageUploadsInProgress = false;
let photoUploadEditorToken = 0;
const IMAGE_UPLOAD_CONCURRENCY = 3, photoUploadQueue = [], photoUploadPromises = new Set();
let activePhotoUploads = 0;
const imageId = () => crypto.randomUUID();
const imagePreviewUrl = item => item.kind === "new" ? item.previewUrl : item.url;

function disposeImageItems(items){items.forEach(item=>{if(item.kind==="new"&&item.previewUrl)URL.revokeObjectURL(item.previewUrl);});}
function syncPhotoProgressMarkup(wrapper,item){
  if(!wrapper||!item)return;
  const track=wrapper.querySelector("[data-photo-progress-track]");
  const fill=wrapper.querySelector("[data-photo-progress-fill]");
  const label=wrapper.querySelector("[data-photo-progress-label]");
  const progress=Math.max(0,Math.min(100,Math.round(Number(item.uploadProgress)||0)));
  const state=item.uploadState||"";
  const stateLabel=state==="queued"?"En cola":state==="uploading"&&item.uploadStage==="processing"?"Optimizando":state==="uploading"?progress+"%":state==="failed"?"Error · reintentá":state==="done"?"100% completada":"";
  wrapper.hidden=!state;
  wrapper.dataset.state=state;
  if(track){
    track.setAttribute("aria-valuenow",String(progress));
    track.setAttribute("aria-valuetext",stateLabel||"Pendiente");
    track.setAttribute("aria-label","Progreso de subida de "+(item.name||item.file?.name||"fotografía"));
  }
  if(fill)fill.style.width=progress+"%";
  if(label)label.textContent=stateLabel;
}
function createPhotoUploadProgress(item){
  const wrapper=document.createElement("div");
  wrapper.className="admin-photo-upload-progress";
  wrapper.dataset.photoProgress="";
  const track=document.createElement("div");
  track.className="admin-photo-progress-track";
  track.dataset.photoProgressTrack="";
  track.setAttribute("role","progressbar");
  track.setAttribute("aria-valuemin","0");
  track.setAttribute("aria-valuemax","100");
  const fill=document.createElement("span");
  fill.className="admin-photo-progress-fill";
  fill.dataset.photoProgressFill="";
  track.append(fill);
  const label=document.createElement("span");
  label.className="admin-photo-progress-label";
  label.dataset.photoProgressLabel="";
  wrapper.append(track,label);
  syncPhotoProgressMarkup(wrapper,item);
  return wrapper;
}
function getOrCreatePhotoProductId(){
  const idField=$("#product-id");
  if(!idField)throw new Error("No se encontró el identificador del producto.");
  let id=String(idField.value||"").trim();
  if(!id){id=crypto.randomUUID();idField.value=id;editorRecordExists=false;}
  return id;
}
function getPendingPhotoUploads(){
  const pending=mainImageItems.filter(item=>item.kind==="new"&&item.file).map(item=>({source:"main",item}));
  if(activeCatalogType!=="technology")return pending;
  const rows=Array.from(form?.querySelectorAll("[data-variant-row]")||[]);
  rows.forEach(row=>{
    initVariantImageItems(row);
    const color=row.querySelector("[data-variant-color]")?.value.trim()||"este color";
    (row._variantImageItems||[]).filter(item=>item.kind==="new"&&item.file)
      .forEach(item=>pending.push({source:"variant",row,item,color}));
  });
  return pending;
}
function getAllTrackedPhotoItems(){
  const items=[...mainImageItems];
  if(activeCatalogType==="technology"){
    const rows=Array.from(form?.querySelectorAll("[data-variant-row]")||[]);
    rows.forEach(row=>{initVariantImageItems(row);items.push(...(row._variantImageItems||[]));});
  }
  return items;
}
function updateBackgroundPhotoStatus(){
  if(!backgroundPhotoUploadStatus)return;
  const items=getAllTrackedPhotoItems(), queued=photoUploadQueue.length, active=activePhotoUploads;
  const failed=items.filter(item=>item.kind==="new"&&item.file&&item.uploadState==="failed").length;
  const done=items.filter(item=>item.uploadState==="done").length;
  if(active||queued){backgroundPhotoUploadStatus.textContent="Subiendo fotos en segundo plano: "+active+" en curso y "+queued+" en cola. Podés seguir completando el formulario.";backgroundPhotoUploadStatus.dataset.state="uploading";}
  else if(failed){backgroundPhotoUploadStatus.textContent=failed+" fotografía(s) pendientes. Se volverán a intentar al guardar.";backgroundPhotoUploadStatus.dataset.state="error";}
  else if(done){backgroundPhotoUploadStatus.textContent=done+" fotografía(s) ya subidas. Se asociarán al guardar la ficha.";backgroundPhotoUploadStatus.dataset.state="success";}
  else{backgroundPhotoUploadStatus.textContent="";backgroundPhotoUploadStatus.removeAttribute("data-state");}
}
function updateVariantImageStatus(row){
  const status=row?.querySelector("[data-variant-status]");if(!status)return;
  const items=row._variantImageItems||[];
  const active=items.filter(item=>["queued","uploading"].includes(item.uploadState)).length;
  const failed=items.filter(item=>item.kind==="new"&&item.file&&item.uploadState==="failed").length;
  const done=items.filter(item=>item.uploadState==="done").length;
  const color=row.querySelector("[data-variant-color]")?.value.trim()||"este color";
  if(active){status.textContent=active+" fotografía(s) de "+color+" subiendo…";status.dataset.state="uploading";}
  else if(failed){status.textContent=failed+" fotografía(s) de "+color+" pendientes; se reintentarán al guardar.";status.dataset.state="error";}
  else if(done){status.textContent=done+" fotografía(s) de "+color+" subidas; se asociarán al guardar.";status.dataset.state="success";}
  else if(items.length){status.textContent=items.length+" fotografía(s) guardadas para "+color+".";status.dataset.state="success";}
  else{status.textContent="";status.removeAttribute("data-state");}
}
function updateMainImageRetryButton(){
  if(!retryMainImagesButton)return;
  const productId=$("#product-id")?.value?.trim()||"", pending=getPendingPhotoUploads();
  const retryable=pending.filter(entry=>!["queued","uploading"].includes(entry.item.uploadState)).length;
  const busy=retryMainImageUploadsInProgress||activePhotoUploads>0||photoUploadQueue.length>0;
  const canPersist=editorRecordExists&&(mainImageSyncPending||variantImageSyncPending);
  const show=Boolean(productId&&(retryable>0||canPersist));
  retryMainImagesButton.hidden=!show;
  retryMainImagesButton.disabled=busy||!currentUser||!supabase||!productId;
  retryMainImagesButton.setAttribute("aria-busy",String(busy));
  retryMainImagesButton.textContent=busy?"Subiendo fotografías…":retryable
    ?"Reintentar "+retryable+" fotografía(s) pendiente(s)"
    :"Guardar fotografías subidas";
}
function refreshPhotoUploadUI(entry){
  if(entry?.source==="variant"&&entry.row?.isConnected){syncVariantImageFields(entry.row);renderVariantImagePreview(entry.row);updateVariantImageStatus(entry.row);}
  else if(entry?.source==="main")renderMainImagePreviews();
  updateBackgroundPhotoStatus();updateMainImageRetryButton();
}
function updatePhotoProgressVisual(entry){
  if(!entry?.item)return;
  const selector=entry.source==="main"?"[data-image-item-id]":"[data-variant-image-id]";
  const list=entry.source==="main"?mainImagesPreview:entry.row?.querySelector("[data-variant-image-preview]");
  const card=Array.from(list?.querySelectorAll(selector)||[]).find(node=>
    node.dataset[entry.source==="main"?"imageItemId":"variantImageId"]===String(entry.item.id)
  );
  if(card)syncPhotoProgressMarkup(card.querySelector("[data-photo-progress]"),entry.item);
}
function photoEntryIsCurrent(entry,token){
  if(token!==photoUploadEditorToken)return false;
  if(entry.source==="main")return mainImageItems.includes(entry.item);
  return Boolean(entry.row?.isConnected&&(entry.row._variantImageItems||[]).includes(entry.item));
}
function queueBackgroundPhotoUpload(entry,{retryFailed=false}={}){
  const item=entry?.item;
  if(!item||item.kind!=="new"||!item.file)return Promise.resolve({ok:item?.kind==="existing"});
  if (IS_READ_ONLY_PREVIEW) {
    item.uploadState = "";
    item.uploadStage = "preview-only";
    item.uploadProgress = 0;
    item.uploadError = "";
    refreshPhotoUploadUI(entry);
    return Promise.resolve({ok:false,previewOnly:true});
  }
  if(item.uploadPromise)return item.uploadPromise;
  if(item.uploadState==="failed"&&!retryFailed)return Promise.resolve({ok:false,skipped:true});
  const productId=getOrCreatePhotoProductId();
  item.name=item.name||item.file.name;item.uploadState="queued";item.uploadStage="queued";item.uploadProgress=0;item.uploadError="";
  const token=photoUploadEditorToken;
  let resolveTask;
  const promise=new Promise(resolve=>{resolveTask=resolve;});
  const job={entry,productId,token,promise,resolve:resolveTask};
  item.uploadPromise=promise;photoUploadPromises.add(promise);photoUploadQueue.push(job);
  refreshPhotoUploadUI(entry);pumpPhotoUploadQueue();return promise;
}
function settleSkippedPhotoJob(job){
  const item=job.entry.item;if(item.uploadState==="queued")item.uploadState="cancelled";
  if(item.uploadPromise===job.promise)item.uploadPromise=null;
  photoUploadPromises.delete(job.promise);job.resolve({ok:false,cancelled:true});
}
function pumpPhotoUploadQueue(){
  while(activePhotoUploads<IMAGE_UPLOAD_CONCURRENCY&&photoUploadQueue.length){
    const job=photoUploadQueue.shift(),entry=job.entry,productId=job.productId,token=job.token,item=entry.item;
    if(!photoEntryIsCurrent(entry,token)||item.kind!=="new"||!item.file||item.cancelRequested){settleSkippedPhotoJob(job);continue;}
    activePhotoUploads++;item.uploadState="uploading";item.uploadProgress=0;refreshPhotoUploadUI(entry);
    void (async function(){
      let result={ok:false};
      try{
        const fileName=item.name||item.file.name;
        item.uploadStage="processing";updatePhotoProgressVisual(entry);
        const url=await uploadImage(productId,item.file,entry.source==="variant"?"variants":"",percent=>{item.uploadStage="uploading";item.uploadProgress=percent;updatePhotoProgressVisual(entry);});
        if(photoEntryIsCurrent(entry,token)&&!item.cancelRequested){
          item.kind="existing";item.url=url;item.uploadState="done";item.uploadProgress=100;item.name=fileName;delete item.uploadError;
          if(item.previewUrl){URL.revokeObjectURL(item.previewUrl);delete item.previewUrl;}delete item.file;
          if(entry.source==="variant")variantImageSyncPending=true;else mainImageSyncPending=true;
          updateEditorDirtyState();scheduleLocalRecoverySave();result={ok:true,url};
        }
      }catch(error){
        if(photoEntryIsCurrent(entry,token)&&!item.cancelRequested){item.uploadState="failed";item.uploadStage="failed";item.uploadError=error?.message||"Error desconocido";result={ok:false,error};}
      }finally{
        activePhotoUploads=Math.max(0,activePhotoUploads-1);
        if(item.uploadPromise===job.promise)item.uploadPromise=null;
        photoUploadPromises.delete(job.promise);
        if(photoEntryIsCurrent(entry,token))refreshPhotoUploadUI(entry);
        job.resolve(result);pumpPhotoUploadQueue();
      }
    })();
  }
  updateBackgroundPhotoStatus();updateMainImageRetryButton();
}
async function uploadPendingPhotosInBackground({retryFailed=true}={}){
  const pending=getPendingPhotoUploads();if(!pending.length)return [];
  return Promise.all(pending.map(entry=>queueBackgroundPhotoUpload(entry,{retryFailed})));
}
function cancelQueuedPhotoUploadsForEditor(){
  photoUploadEditorToken++;
  while(photoUploadQueue.length){const job=photoUploadQueue.shift();settleSkippedPhotoJob(job);}
  updateBackgroundPhotoStatus();updateMainImageRetryButton();
}
function clearMainImagePreviews(){
  disposeImageItems(mainImageItems);mainImageItems=[];mainImageSyncPending=false;variantImageSyncPending=false;
  mainImagesPreview?.replaceChildren();updateBackgroundPhotoStatus();updateMainImageRetryButton();
}
function setExistingMainImages(urls=[]){
  disposeImageItems(mainImageItems);mainImageSyncPending=false;variantImageSyncPending=false;
  mainImageItems=[...new Set(urls.filter(url=>typeof url==="string"&&url.trim()))].map(url=>({id:imageId(),kind:"existing",url}));
  renderMainImagePreviews();
}
function renderMainImagePreviews(){
 if(!mainImagesInput||!mainImagesPreview||!mainImagesSummary)return;
 mainImagesPreview.replaceChildren();
 const tracked=mainImageItems.filter(item=>item.name||item.uploadState);
  const loading=tracked.filter(item=>["queued","uploading"].includes(item.uploadState)).length;
  const failed=tracked.filter(item=>item.kind==="new"&&item.file&&item.uploadState==="failed").length;
  const done=tracked.filter(item=>item.uploadState==="done").length;
  mainImagesSummary.textContent=mainImageItems.length
    ? mainImageItems.length+" fotografía(s) · la primera será la portada"+(tracked.length?" · "+done+" subidas"+(loading?" · "+loading+" en proceso":"")+(failed?" · "+failed+" pendientes":""):"")
    : "Ninguna fotografía seleccionada";
 mainImageItems.forEach((item,index)=>{
  const card=document.createElement("figure");card.className="admin-image-preview-card sortable-image-card";card.draggable=true;card.dataset.imageItemId=item.id;
  const img=document.createElement("img");img.src=imagePreviewUrl(item);img.alt=`Fotografía ${index+1} del producto`;img.loading="lazy";
  const badge=document.createElement("span");badge.className="admin-image-order-badge"+(index===0?" is-cover":"");badge.setAttribute("aria-label",index===0?"Fotografía de portada":"Fotografía "+(index+1));badge.title=index===0?"Fotografía de portada":"Fotografía "+(index+1);badge.innerHTML=index===0?'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 19h14l1-9-5 3-3-7-3 7-5-3 1 9Z"></path><path d="M7 22h10"></path></svg>':'<span>'+String(index+1)+'</span>';
  const caption=document.createElement("figcaption");
   const itemLabel=item.name||item.file?.name||"Imagen guardada";
   const stateLabel=item.uploadState==="queued"?" · En cola":item.uploadState==="uploading"?" · Subiendo…":item.uploadState==="failed"?" · Pendiente":item.uploadState==="done"?" · Subida":"";
   caption.textContent=item.kind==="new"?itemLabel+stateLabel:(item.name?itemLabel+stateLabel:"Imagen guardada");
  const controls=document.createElement("div");controls.className="admin-image-controls";
  for(const [label,offset,disabled] of [["↑",-1,index===0],["↓",1,index===mainImageItems.length-1]]){
   const b=document.createElement("button");b.type="button";b.className="admin-mini-button";b.textContent=label;b.disabled=disabled;b.dataset.mainImageMove=String(offset);b.title=offset<0?"Mover antes":"Mover después";controls.append(b);
  }
  const remove=document.createElement("button");remove.type="button";remove.className="admin-mini-button danger";remove.textContent="×";remove.dataset.mainImageRemove="true";remove.title="Quitar fotografía";
  controls.append(remove);
  card.append(badge,img,caption,createPhotoUploadProgress(item),controls);
  mainImagesPreview.append(card);
  });
  updateMainImageRetryButton();
}
function moveMainImage(id,offset){const from=mainImageItems.findIndex(i=>i.id===id),to=from+offset;if(from<0||to<0||to>=mainImageItems.length)return;const [item]=mainImageItems.splice(from,1);mainImageItems.splice(to,0,item);renderMainImagePreviews();updateEditorDirtyState();}
function removeMainImage(id){const from=mainImageItems.findIndex(i=>i.id===id);if(from<0)return;disposeImageItems([mainImageItems[from]]);mainImageItems.splice(from,1);renderMainImagePreviews();updateEditorDirtyState();}
mainImagesInput?.addEventListener("change",()=>{
  const selected=Array.from(mainImagesInput.files||[]);
  mainImagesInput.value="";
  if(!selected.length)return;
  getOrCreatePhotoProductId();
  const added=selected.map(file=>({id:imageId(),kind:"new",file,name:file.name,uploadState:"queued",previewUrl:URL.createObjectURL(file)}));
  mainImageItems.push(...added);
  renderMainImagePreviews();updateEditorDirtyState();scheduleLocalRecoverySave();
  added.forEach(item=>void queueBackgroundPhotoUpload({source:"main",item}));
});
retryMainImagesButton?.addEventListener("click",async()=>{
  if (IS_READ_ONLY_PREVIEW) {
    message("#product-form-status", "Vista previa segura: la subida a Storage está deshabilitada en Vercel.", "error");
    return;
  }
  if(retryMainImageUploadsInProgress||activePhotoUploads>0||photoUploadQueue.length)return;
  const productId=$("#product-id")?.value?.trim()||"";
  if(!productId||!currentUser||!supabase){
    message("#product-form-status","Guardá primero la ficha del producto y volvé a intentar las fotografías.","error");
    return;
  }
  const pending=getPendingPhotoUploads();
  if(!pending.length&&!(editorRecordExists&&(mainImageSyncPending||variantImageSyncPending)))return;
  retryMainImageUploadsInProgress=true;
  updateMainImageRetryButton();
  try{
    if(pending.length)await uploadPendingPhotosInBackground({retryFailed:true});
    const remaining=getPendingPhotoUploads().filter(entry=>entry.item.uploadState==="failed");
    if(editorRecordExists&&(mainImageSyncPending||variantImageSyncPending)){
      const patch={updated_at:new Date().toISOString(),updated_by:currentUser.id};
      if(mainImageSyncPending){
        const imageUrls=mainImageItems.filter(item=>item.kind==="existing"&&item.url).map(item=>item.url);
        patch.images=imageUrls;
        patch.image_url=imageUrls[0]||null;
      }
      if(variantImageSyncPending){
        const existingProduct=products.find(product=>String(product.id)===String(productId));
        const uploadIssues=[];
        const variants=await collectVariants(productId,existingProduct?.variants||[],uploadIssues,{skipPendingUploads:true});
        patch.variants=variants;
        patch.colors=deriveColorsFromVariants(variants,existingProduct?.colors||[]);
      }
      const {error}=await supabase.from("products").update(patch).eq("id",productId);
      if(error)throw new Error("Las fotografías se subieron, pero no se pudieron vincular al producto: "+error.message);
      mainImageSyncPending=false;
      variantImageSyncPending=false;
      await loadProducts().catch(error=>console.warn("Las fotografías se guardaron; no se pudo actualizar la lista del panel.",error));
    }
    renderMainImagePreviews();
    form?.querySelectorAll("[data-variant-row]").forEach(row=>{
      syncVariantImageFields(row);
      renderVariantImagePreview(row);
      updateVariantImageStatus(row);
    });
    updateEditorDirtyState();
    if(remaining.length){
      message("#product-form-status",remaining.length+" fotografía(s) siguen pendientes. El resto ya está subido. Revisá la conexión y volvé a intentarlo.","error");
      await saveLocalRecoveryDraft();
    }else{
      message("#product-form-status",editorRecordExists
        ?"Las fotografías completadas se guardaron y quedaron vinculadas al producto."
        :"Las fotografías se subieron. Guardá la ficha para vincularlas al producto.","success");
    }
  }catch(error){
    message("#product-form-status",error?.message||"No se pudieron completar las fotografías. Los archivos pendientes permanecen en el formulario.","error");
    await saveLocalRecoveryDraft();
  }finally{
    retryMainImageUploadsInProgress=false;
    updateBackgroundPhotoStatus();
    updateMainImageRetryButton();
  }
});
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
  const caption=document.createElement("figcaption");
  const itemLabel=item.name||item.file?.name||"Imagen guardada";
  caption.textContent=item.kind==="new"?itemLabel:item.name||"Imagen guardada";
  const remove=document.createElement("button");remove.type="button";remove.className="admin-mini-button danger";remove.textContent="×";remove.dataset.variantImageRemove="true";remove.title="Quitar fotografía";controls.append(remove);
  card.append(badge,img,caption,createPhotoUploadProgress(item),controls);preview.append(card);
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
  updateCategoryVariantVisibility();
  updateVariantRowHeadings();
  const focusSelector = categoryUsesRamStorage() ? "[data-group-storage]" : "[data-group-price-usd]";
  newGroup.querySelector(focusSelector)?.focus();
  updateEditorDirtyState();
});

form?.addEventListener("click", async event => {
  const aiColorButton = event.target.closest("[data-ai-color-open]");
  if (aiColorButton) { openColorAssistant(aiColorButton.closest("[data-variant-row]")); return; }
  const saveLibraryButton = event.target.closest("[data-save-color-library]");
  if (saveLibraryButton) {
    const row = saveLibraryButton.closest("[data-variant-row]");
    const color = { name: row?.querySelector("[data-variant-color]")?.value.trim() || "", hex: validHex(row?.querySelector("[data-variant-hex]")?.value, "") };
    const result = saveColorToLibrary(color);
    const status = row?.querySelector("[data-variant-status]");
    if (result.ok) {
      const shared = await persistColorLibraryEntry(color);
      result.message += shared.ok ? " Sincronizado en todos los dispositivos." : " " + shared.message;
      renderColorLibraryDatalist();
      renderQuickColorPalette(quickColorSearch?.value || "");
    }
    if (status) {
      status.textContent = result.message;
      status.dataset.state = result.ok ? "success" : "error";
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
    if (result.ok) {
      const shared = await persistColorLibraryEntry(color, { favorite: result.favorite });
      result.message += shared.ok ? " Favorito sincronizado." : " " + shared.message;
      renderColorLibraryDatalist();
      renderQuickColorPalette(quickColorSearch?.value || "");
    }
    if (status) {
      status.textContent = result.message;
      status.dataset.state = result.ok ? "success" : "error";
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
        variantsContainer.replaceChildren();
      }
    }
    updateEditorDirtyState();
    return;
  }

  const remove = event.target.closest("[data-remove-variant]");
  if (!remove) return;
  event.preventDefault();
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
    const searchedName = librarySearch.value.trim();
    const match = findColorInPalette(searchedName);
    if (match && row) {
      applyColorToRow(row, { ...match, name: searchedName || match.name });
      librarySearch.value = searchedName || match.name;
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
    const row=imageInput.closest("[data-variant-row]");if(!row)return;
    const selected=Array.from(imageInput.files||[]);
    imageInput.value="";
    if(!selected.length)return;
    getOrCreatePhotoProductId();initVariantImageItems(row);
    const added=selected.map(file=>({id:imageId(),kind:"new",file,name:file.name,uploadState:"queued",previewUrl:URL.createObjectURL(file)}));
    row._variantImageItems.push(...added);syncVariantImageFields(row);renderVariantImagePreview(row);updateVariantImageStatus(row);
    updateEditorDirtyState();scheduleLocalRecoverySave();
    added.forEach(item=>void queueBackgroundPhotoUpload({source:"variant",row,item,color:row.querySelector("[data-variant-color]")?.value.trim()||"este color"}));
    return;
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
      row.querySelector("[data-variant-color]").value = colorName;
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
  refreshCatalogAdminActivityMarker();

  loginPanel.classList.add("hidden");
  dashboard.classList.remove("hidden");
  document.body.classList.add("admin-dashboard-active");
  setMobileSidebarOpen(false);
  showAdminSection("home");

  const greeting = $("#admin-greeting");
  if (greeting) greeting.textContent = "¡Bienvenido de nuevo, Steven! 👋";

  setStatus("Sesión iniciada");
  window.setTimeout(() => { const status = $("#admin-status"); if (status?.textContent === "Sesión iniciada") status.textContent = ""; }, 4500);

  await syncSharedColorLibrary({ migrateLocal: true });
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
    clearCatalogAdminActivityMarker();
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

$("#login-remember-user")?.addEventListener("change", event => {
  const enabled = Boolean(event.currentTarget.checked);
  setRememberedSession(enabled, $("#login-email")?.value || "");
  message(
    "#login-status",
    enabled
      ? "Recordaremos la sesión en este dispositivo. No guardaremos tu contraseña."
      : "La sesión ya no se recordará cuando vuelvas a abrir la aplicación.",
    "success"
  );
});

$("#remember-user-toggle")?.addEventListener("click", () => {
  const nextEnabled = !isRememberedSessionEnabled();
  setRememberedSession(nextEnabled, currentUser?.email || getRememberedAdminEmail());
  setStatus(
    nextEnabled
      ? "Se recordará la sesión en este dispositivo hasta que lo desactives o cierres sesión."
      : "Dejaste de recordar este usuario. La sesión actual seguirá activa hasta que la cierres."
  );
});

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
    const loginEmail = $("#login-email").value.trim();
    const rememberSession = Boolean($("#login-remember-user")?.checked);
    // Select session storage before Supabase persists the successful login.
    setRememberedSession(rememberSession, loginEmail);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
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
  const body = document.body;
  const root = document.documentElement;
  const toggle = document.getElementById("admin-menu-toggle");
  const backdrop = document.getElementById("admin-sidebar-backdrop");
  const isMobile = window.matchMedia("(max-width: 760px)").matches;
  const wasOpen = body.classList.contains("admin-sidebar-open");
  const shouldOpen = Boolean(open && isMobile);

  // Save the document scroll position once, before locking the page behind the drawer.
  if (shouldOpen && !wasOpen) {
    const currentScrollY = Math.max(
      0,
      Number(window.scrollY) || Number(root.scrollTop) || Number(body.scrollTop) || 0
    );
    body.dataset.adminSidebarScrollY = String(currentScrollY);
  }

  body.classList.toggle("admin-sidebar-open", shouldOpen);
  root.classList.toggle("admin-sidebar-scroll-locked", shouldOpen);
  body.classList.toggle("admin-sidebar-scroll-locked", shouldOpen);

  if (toggle) {
    toggle.setAttribute("aria-expanded", String(shouldOpen));
    toggle.setAttribute("aria-label", shouldOpen ? "Cerrar menú de administración" : "Abrir menú de administración");
    toggle.setAttribute("title", shouldOpen ? "Cerrar menú" : "Abrir menú");
    const icon = toggle.querySelector("span");
    if (icon) icon.textContent = shouldOpen ? "×" : "☰";
  }
  if (backdrop) backdrop.hidden = !shouldOpen;

  // Restore the exact scroll position on close; don't leave a new panel halfway down.
  if (!shouldOpen && wasOpen) {
    const savedScrollY = Number(body.dataset.adminSidebarScrollY);
    delete body.dataset.adminSidebarScrollY;
    if (Number.isFinite(savedScrollY)) {
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: savedScrollY, left: 0, behavior: "auto" });
      });
    }
  }
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
  if (section === "messages") void loadPrivateChatInbox();
}
document.querySelectorAll("[data-admin-section]").forEach(button => button.addEventListener("click", () => showAdminSection(button.dataset.adminSection)));


/* =========================================================
   MENSAJERÍA PRIVADA · bandeja segura del asesor
   ========================================================= */
let privateChatConversations = [];
let privateChatSelectedId = "";
let privateChatBaselineReady = false;
let privateChatPendingBaselineReady = false;
let privateChatKnownLatestMessages = new Map();
let privateChatInboxLoading = false;
let privateChatMessagesLoading = false;
let privateChatNotificationPermissionAsked = false;

const privateChatStatusEl = document.getElementById("private-chat-admin-status");
const privateChatListEl = document.getElementById("private-chat-conversation-list");
const privateChatMessagesEl = document.getElementById("private-chat-admin-messages");
const privateChatSelectedPanel = document.getElementById("private-chat-admin-selected");
const privateChatEmptyPanel = document.getElementById("private-chat-admin-empty");
const privateChatReplyForm = document.getElementById("private-chat-admin-reply-form");
const privateChatReplyInput = document.getElementById("private-chat-admin-reply");
const privateChatNavCount = document.getElementById("private-chat-nav-count");

function privateChatEscape(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, character => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[character]);
}
function privateChatDate(value, withDate = false) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("es-NI", withDate
      ? { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" }
      : { hour:"2-digit", minute:"2-digit" }).format(date);
  } catch { return ""; }
}
function privateChatStatusLabel(status) {
  return ({
    pending_consent:"Pendiente de consentimiento",
    pending_advisor:"Nueva solicitud",
    advisor_active:"En atención",
    declined_pending_delete:"Rechazó · cierre en curso",
    closed:"Cerrado"
  })[status] || "En revisión";
}
function privateChatTopicLabel(topic) {
  return ({product:"Producto",financing:"Financiamiento",credit_card:"Tarjeta de crédito",other:"Consulta"})[topic] || "Consulta";
}
function privateChatRouteLabel(route) {
  return route === "support" ? "Atención al cliente" : route === "buy" ? "Quiero comprar" : "Sin elegir";
}
function privateChatSelectedConversation() {
  return privateChatConversations.find(item => String(item.id) === String(privateChatSelectedId)) || null;
}
function privateChatSetStatus(message, kind = "") {
  if (!privateChatStatusEl) return;
  privateChatStatusEl.textContent = message || "";
  privateChatStatusEl.dataset.kind = kind;
}
function privateChatShowNotification(title, body, conversationId) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body: String(body || "").slice(0, 180), tag: "jb-private-chat-" + String(conversationId || "inbox"), renotify: true });
  } catch {}
}
function privateChatRenderInbox() {
  if (!privateChatListEl) return;
  const selected = privateChatSelectedId;
  if (!privateChatConversations.length) {
    privateChatListEl.innerHTML = '<p class="provider-empty-state">Todavía no hay conversaciones. Cuando un cliente solicite atención aparecerá aquí.</p>';
    return;
  }
  privateChatListEl.innerHTML = privateChatConversations.map(item => {
    const id = String(item.id || "");
    const isSelected = id === selected;
    const latest = item._latestMessage;
    const preview = latest?.content || "Conversación iniciada";
    const status = String(item.status || "");
    const isPending = status === "pending_advisor";
    const statusClass = status === "pending_advisor" ? "is-pending"
      : status === "advisor_active" ? "is-active"
      : status === "declined_pending_delete" ? "is-declined" : "";
    const route = privateChatRouteLabel(item.contact_route);
    const catalog = item.catalog_type === "perfumery" ? "JB Parfums" : item.catalog_type === "technology" ? "JB TECH" : "JB Collections";
    const title = item.product_name || "Consulta general";
    return '<button class="private-chat-admin-item' + (isSelected ? ' is-selected' : '') + '" type="button" data-private-chat-select="' + privateChatEscape(id) + '" aria-pressed="' + String(isSelected) + '">' +
      '<span class="private-chat-admin-item-top"><span class="private-chat-admin-item-title">' + privateChatEscape(title) + '</span><time class="private-chat-admin-item-time">' + privateChatEscape(privateChatDate(item.last_message_at || item.created_at)) + '</time></span>' +
      '<span class="private-chat-admin-item-preview">' + privateChatEscape(preview) + '</span>' +
      '<span class="private-chat-admin-item-meta"><span class="private-chat-pill ' + statusClass + '">' + privateChatEscape(privateChatStatusLabel(status)) + '</span><span class="private-chat-pill">' + privateChatEscape(catalog) + '</span><span class="private-chat-pill">' + privateChatEscape(route) + '</span></span>' +
      '</button>';
  }).join("");
}
function privateChatRenderMessages(messages) {
  if (!privateChatMessagesEl) return;
  const list = (Array.isArray(messages) ? messages : []).filter(item =>
    !(item.sender_type === "assistant" && /^Antes de continuar con una compra:/i.test(String(item.content || "")))
  );
  const selected = privateChatSelectedConversation();
  const previous = privateChatMessagesEl.dataset.signature || "";
  const signature = list.map(item => String(item.id) + ":" + String(item.content)).join("|");
  if (signature === previous) return;
  const nearBottom = privateChatMessagesEl.scrollHeight - privateChatMessagesEl.scrollTop - privateChatMessagesEl.clientHeight < 100;
  privateChatMessagesEl.dataset.signature = signature;
  privateChatMessagesEl.replaceChildren();
  if (!list.length) {
    const empty = document.createElement("p");
    empty.className = "provider-empty-state";
    empty.textContent = "Todavía no hay mensajes en esta conversación.";
    privateChatMessagesEl.appendChild(empty);
    return;
  }
  for (const item of list) {
    const sender = String(item.sender_type || "assistant");
    const bubble = document.createElement("article");
    bubble.className = "private-chat-admin-message " + (sender === "customer" ? "is-customer" : sender === "advisor" ? "is-advisor" : "is-assistant");
    const text = document.createElement("p");
    text.textContent = String(item.content || "");
    const time = document.createElement("time");
    time.dateTime = String(item.created_at || "");
    time.textContent = (sender === "customer" ? "Cliente" : sender === "advisor" ? "Vos · Asesor" : "Sistema") + (item.created_at ? " · " + privateChatDate(item.created_at, true) : "");
    bubble.append(text, time);
    privateChatMessagesEl.appendChild(bubble);
  }
  if (nearBottom) privateChatMessagesEl.scrollTop = privateChatMessagesEl.scrollHeight;
}
function privateChatRenderSelected() {
  const item = privateChatSelectedConversation();
  if (!item) {
    privateChatSelectedPanel.hidden = true;
    privateChatEmptyPanel.hidden = false;
    privateChatReplyForm.hidden = true;
    privateChatRenderMessages([]);
    return;
  }
  privateChatSelectedPanel.hidden = false;
  privateChatEmptyPanel.hidden = true;
  const status = String(item.status || "");
  const canClaim = status === "pending_advisor" && !item.claimed_by;
  const ownActive = status === "advisor_active" && String(item.claimed_by || "") === String(currentUser?.id || "");
  const canClose = status !== "closed" && (!item.claimed_by || String(item.claimed_by) === String(currentUser?.id || ""));
  const canExtend = ownActive && item.contact_route === "buy" && item.consent_choice === "yes" && !item.purchase_confirmed_at;
  document.getElementById("private-chat-admin-thread-kicker").textContent = privateChatStatusLabel(status).toLocaleUpperCase("es");
  document.getElementById("private-chat-admin-thread-title").textContent = item.product_name || "Consulta general";
  document.getElementById("private-chat-admin-thread-meta").textContent =
    (item.catalog_type === "perfumery" ? "JB Parfums" : item.catalog_type === "technology" ? "JB TECH" : "JB Collections") +
    " · " + privateChatRouteLabel(item.contact_route) +
    " · " + privateChatTopicLabel(item.payment_topic) +
    " · Creado " + privateChatDate(item.created_at, true);
  const productLink = document.getElementById("private-chat-admin-product-link");
  const safeProductUrl = /^https:\/\/(jb-collections\.pages\.dev|jasbh121101\.github\.io)(\/|$)/i.test(String(item.product_url || ""))
    ? item.product_url : "https://jb-collections.pages.dev/";
  productLink.href = safeProductUrl;
  productLink.hidden = !item.product_id;
  document.getElementById("private-chat-admin-claim").hidden = !canClaim;
  document.getElementById("private-chat-admin-purchase").hidden = !canExtend;
  document.getElementById("private-chat-admin-close").hidden = !canClose;
  privateChatReplyForm.hidden = !ownActive;
  if (status === "pending_consent") {
    privateChatSetStatus("La conversación está pendiente de que el cliente elija atención o autorice continuar con una compra.");
  } else if (status === "declined_pending_delete") {
    privateChatSetStatus("El cliente rechazó continuar. No envíes mensajes comerciales; el chat está programado para eliminarse.");
  } else if (status === "pending_advisor") {
    privateChatSetStatus("Solicitud pendiente. Tomala para responder personalmente.");
  } else if (status === "advisor_active" && !ownActive) {
    privateChatSetStatus("Esta conversación ya está tomada por otro asesor.");
  } else if (status === "closed") {
    privateChatSetStatus("Esta conversación está cerrada. El historial se conserva conforme al plazo de retención.");
  } else if (ownActive) {
    privateChatSetStatus("Estás atendiendo esta conversación. Las respuestas se envían solo cuando pulsás «Enviar respuesta».");
  }
}
async function loadPrivateChatMessages(silent = false) {
  if (!supabase || !currentUser || !privateChatSelectedId || privateChatMessagesLoading) return;
  privateChatMessagesLoading = true;
  try {
    const { data, error } = await supabase
      .from("private_chat_messages")
      .select("id,conversation_id,sender_type,content,created_at")
      .eq("conversation_id", privateChatSelectedId)
      .order("created_at", { ascending: false })
      .limit(150);
    if (error) throw error;
    privateChatRenderMessages((data || []).reverse());
  } catch (error) {
    if (!silent) privateChatSetStatus("No se pudieron cargar los mensajes: " + String(error.message || "Error"), "error");
  } finally {
    privateChatMessagesLoading = false;
  }
}
async function loadPrivateChatInbox(options = {}) {
  if (!supabase || !currentUser || !dashboard || dashboard.classList.contains("hidden") || privateChatInboxLoading) return;
  privateChatInboxLoading = true;
  const silent = Boolean(options.silent);
  try {
    const { data, error } = await supabase
      .from("private_chat_conversations")
      .select("id,catalog_type,product_id,product_name,product_url,payment_topic,status,contact_route,consent_choice,claimed_by,claimed_at,created_at,last_message_at,session_expires_at,delete_after,purchase_confirmed_at")
      .order("last_message_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    privateChatConversations = data || [];

    const { data: recentMessages, error: messagesError } = await supabase
      .from("private_chat_messages")
      .select("id,conversation_id,sender_type,content,created_at")
      .order("created_at", { ascending: false })
      .limit(300);
    if (messagesError) throw messagesError;
    const latestByConversation = new Map();
    for (const message of recentMessages || []) {
      const id = String(message.conversation_id);
      if (!latestByConversation.has(id)) latestByConversation.set(id, message);
    }
    privateChatConversations = privateChatConversations.map(item => ({
      ...item,
      _latestMessage: latestByConversation.get(String(item.id)) || null
    }));
    const pendingCount = privateChatConversations.filter(item => item.status === "pending_advisor").length;
    if (privateChatNavCount) privateChatNavCount.textContent = String(pendingCount);
    const dashboardChatCount = document.getElementById("dashboard-private-chat-shortcut-count");
    if (dashboardChatCount) dashboardChatCount.textContent = String(pendingCount);
    const inboxCount = document.getElementById("private-chat-admin-inbox-count");
    if (inboxCount) inboxCount.textContent = String(privateChatConversations.length);

    if (privateChatBaselineReady) {
      for (const item of privateChatConversations) {
        const latest = item._latestMessage;
        const oldId = privateChatKnownLatestMessages.get(String(item.id));
        if (latest && latest.sender_type === "customer" && oldId && oldId !== latest.id) {
          privateChatShowNotification("Nuevo mensaje de cliente", (item.product_name || "JB Collections") + ": " + String(latest.content || "").slice(0, 120), item.id);
        }
      }
    }
    for (const item of privateChatConversations) {
      if (item._latestMessage) privateChatKnownLatestMessages.set(String(item.id), item._latestMessage.id);
    }
    if (!privateChatBaselineReady) privateChatBaselineReady = true;

    if (privateChatSelectedId && !privateChatConversations.some(item => String(item.id) === String(privateChatSelectedId))) {
      privateChatSelectedId = "";
    }
    privateChatRenderInbox();
    privateChatRenderSelected();
    if (privateChatSelectedId) await loadPrivateChatMessages(true);

    const wasPending = Number(loadPrivateChatInbox._previousPending || 0);
    if (privateChatPendingBaselineReady && pendingCount > wasPending) {
      if (!silent) privateChatSetStatus("Hay nuevas solicitudes pendientes de atención.");
      privateChatShowNotification("Nueva solicitud de atención", "Un cliente solicitó atención personal en JB Collections.", "pending-count");
    }
    loadPrivateChatInbox._previousPending = pendingCount;
    privateChatPendingBaselineReady = true;
    if (!silent && !privateChatConversations.length) privateChatSetStatus("Todavía no hay conversaciones de clientes.");
    else if (!silent && privateChatStatusEl?.dataset.kind === "error") privateChatSetStatus("");
  } catch (error) {
    if (!silent) privateChatSetStatus("No se pudo cargar la mensajería: " + String(error.message || "Error"), "error");
  } finally {
    privateChatInboxLoading = false;
  }
}
async function privateChatRunAdminAction(action) {
  const item = privateChatSelectedConversation();
  if (!item || !supabase || !currentUser) return;
  const buttonIds = {
    claim: "private-chat-admin-claim",
    purchase: "private-chat-admin-purchase",
    close: "private-chat-admin-close"
  };
  const button = document.getElementById(buttonIds[action]);
  if (button) button.disabled = true;
  privateChatSetStatus("Actualizando conversación…");
  try {
    const rpcName = action === "claim" ? "private_chat_admin_claim"
      : action === "purchase" ? "private_chat_admin_extend_after_purchase"
      : "private_chat_admin_close";
    const { data, error } = await supabase.rpc(rpcName, { p_conversation_id: item.id });
    if (error) throw error;
    if (data?.ok === false) throw new Error("No se pudo aplicar el cambio.");
    privateChatSetStatus(action === "claim" ? "Tomaste la conversación; ya podés responder." :
      action === "purchase" ? "Compra confirmada. El acceso del cliente se extendió 30 minutos." : "Conversación cerrada.");
    await loadPrivateChatInbox({ silent: true });
    if (privateChatSelectedId) await loadPrivateChatMessages(true);
  } catch (error) {
    privateChatSetStatus(String(error.message || "No se pudo completar la acción."), "error");
  } finally {
    if (button) button.disabled = false;
  }
}
async function privateChatSendAdminReply(event) {
  event.preventDefault();
  if (!privateChatSelectedId || !currentUser) return;
  const item = privateChatSelectedConversation();
  if (!item || item.status !== "advisor_active" || String(item.claimed_by) !== String(currentUser.id)) {
    privateChatSetStatus("Tomá la conversación antes de responder.", "error");
    return;
  }
  const content = String(privateChatReplyInput.value || "").trim();
  if (!content) return;
  const send = document.getElementById("private-chat-admin-send");
  send.disabled = true;
  privateChatSetStatus("Enviando respuesta…");
  try {
    const { error } = await supabase.rpc("private_chat_admin_send", {
      p_conversation_id: privateChatSelectedId,
      p_content: content
    });
    if (error) {
      if (/personal_data_not_allowed/i.test(String(error.message || ""))) {
        throw new Error("Por seguridad, no envíes cédula, teléfono, correo ni datos de pago por este chat.");
      }
      throw error;
    }
    privateChatReplyInput.value = "";
    privateChatReplyInput.style.height = "auto";
    privateChatSetStatus("Respuesta enviada.");
    await loadPrivateChatInbox({ silent: true });
    await loadPrivateChatMessages(true);
    privateChatReplyInput.focus();
  } catch (error) {
    privateChatSetStatus(String(error.message || "No se pudo enviar la respuesta."), "error");
  } finally {
    send.disabled = false;
  }
}

document.getElementById("private-chat-refresh")?.addEventListener("click", () => void loadPrivateChatInbox());
document.getElementById("private-chat-enable-notifications")?.addEventListener("click", async () => {
  if (!("Notification" in window)) {
    privateChatSetStatus("Este navegador no ofrece notificaciones de escritorio. La bandeja se actualiza mientras JB Manager permanece abierto.", "error");
    return;
  }
  try {
    const permission = await Notification.requestPermission();
    privateChatNotificationPermissionAsked = true;
    if (permission === "granted") {
      privateChatSetStatus("Notificaciones del navegador activadas mientras JB Manager esté abierto. Las notificaciones push con la pestaña cerrada aún requieren configuración adicional.");
      privateChatShowNotification("JB Manager", "Las notificaciones de nuevas conversaciones están activadas.", "private-chat-enabled");
    } else {
      privateChatSetStatus("No se concedió permiso de notificación. Podés seguir revisando la bandeja de mensajería.");
    }
  } catch {
    privateChatSetStatus("No pudimos activar las notificaciones en este navegador.", "error");
  }
});
privateChatListEl?.addEventListener("click", event => {
  const button = event.target.closest("[data-private-chat-select]");
  if (!button) return;
  privateChatSelectedId = String(button.dataset.privateChatSelect || "");
  privateChatRenderInbox();
  privateChatRenderSelected();
  void loadPrivateChatMessages();
});
document.getElementById("private-chat-admin-claim")?.addEventListener("click", () => void privateChatRunAdminAction("claim"));
document.getElementById("private-chat-admin-purchase")?.addEventListener("click", () => void privateChatRunAdminAction("purchase"));
document.getElementById("private-chat-admin-close")?.addEventListener("click", () => {
  if (window.confirm("¿Cerrar esta conversación? El acceso del cliente se revocará y el historial seguirá sujeto al plazo de conservación.")) {
    void privateChatRunAdminAction("close");
  }
});
privateChatReplyForm?.addEventListener("submit", event => void privateChatSendAdminReply(event));
window.setInterval(() => {
  if (currentUser && dashboard && !dashboard.classList.contains("hidden")) void loadPrivateChatInbox({ silent: true });
}, 15000);

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

  await providerTools.refresh();

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

function renderDepartmentAnalytics(events) {
  const target = document.getElementById("dashboard-department-breakdown");
  if (!target) return;
  if (!events.length) {
    target.innerHTML = '<p class="dashboard-empty-state">Todavía no hay eventos. El desglose empezará a llenarse con nuevas visitas.</p>';
    return;
  }
  const groups = new Map();
  for (const event of events) {
    const country = String(event.visitor_country || "").trim().toUpperCase();
    const department = String(event.visitor_department || "").trim();
    let label, key;
    if (country === "NI" && department) { label = department; key = "department:" + department.toLocaleLowerCase("es"); }
    else if (country && country !== "NI") { label = "Fuera de Nicaragua (" + country + ")"; key = "country:" + country; }
    else { label = "Sin ubicación registrada"; key = "unknown"; }
    const row = groups.get(key) || { label, catalogVisits: 0, views: 0, contacts: 0 };
    if (event.event_type === "catalog_view") row.catalogVisits += 1;
    if (event.event_type === "view") row.views += 1;
    if (event.event_type === "whatsapp_click") row.contacts += 1;
    groups.set(key, row);
  }
  const rows = Array.from(groups.values())
    .sort((a, b) => (b.catalogVisits + b.views + b.contacts) - (a.catalogVisits + a.views + a.contacts) || a.label.localeCompare(b.label, "es"))
    .slice(0, 12);
  const maxValue = Math.max(1, ...rows.map(row => Math.max(row.catalogVisits, row.views, row.contacts)));
  target.innerHTML = rows.map(row => {
    const catalogWidth = Math.round(row.catalogVisits / maxValue * 100);
    const viewsWidth = Math.round(row.views / maxValue * 100);
    const contactsWidth = Math.round(row.contacts / maxValue * 100);
    return '<div class="department-stat-row">' +
      '<div class="department-stat-name">' + escapeHtml(row.label) + '</div>' +
      '<div class="department-stat-bars">' +
        '<div class="department-stat-bar" title="Visitas al catálogo"><span style="width:' + catalogWidth + '%"></span></div>' +
        '<div class="department-stat-bar" title="Aperturas de fichas"><span style="width:' + viewsWidth + '%"></span></div>' +
        '<div class="department-stat-bar is-contact" title="Clics de WhatsApp"><span style="width:' + contactsWidth + '%"></span></div>' +
      '</div>' +
      '<div class="department-stat-metrics"><span>Catálogo</span><strong>' + row.catalogVisits.toLocaleString("es-NI") + '</strong><span>Fichas</span><strong>' + row.views.toLocaleString("es-NI") + '</strong><span>WhatsApp</span><strong>' + row.contacts.toLocaleString("es-NI") + '</strong></div>' +
    '</div>';
  }).join("") +
  '<div class="department-stat-legend"><span><i></i> Visitas al catálogo</span><span><i></i> Fichas de productos</span><span><i class="contact-dot"></i> Clics de WhatsApp</span></div>';
}

async function loadCatalogAnalytics() {
  if (typeof loadCommissionDashboard === "function") void loadCommissionDashboard();
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
    .select("*")
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
  const events = (data || []).filter(event => event.event_type === "catalog_view" ? (isAllCatalogs || event.catalog_type === dashboardCatalogScope) : catalogIds.has(String(event.product_id)));
  renderDepartmentAnalytics(events);
  const views = events.filter(event => event.event_type === "view");
  const clicks = events.filter(event => event.event_type === "whatsapp_click");
  setText("dashboard-views-total", views.length.toLocaleString("es-NI"));
  setText("dashboard-whatsapp-total", clicks.length.toLocaleString("es-NI"));

  if (note) {
    const scopeLabel = isAllCatalogs ? "ambos catálogos" : isPerfumeCatalog ? "JB Parfums" : "JB TECH";
    note.textContent = events.length
      ? "Eventos registrados para " + scopeLabel + ". Las visitas al catálogo son cargas de página y las visitas a fichas son aperturas de productos; no representan personas únicas. Los clics de WhatsApp indican intención de consulta, no ventas confirmadas."
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
  const catalogProducts = getDashboardProducts().filter(product => !["trash", "deleting"].includes(getWorkflowStatus(product)));
  const published = catalogProducts.filter(product => getWorkflowStatus(product) === "published");
  const drafts = catalogProducts.filter(product => getWorkflowStatus(product) === "draft" || getWorkflowStatus(product) === "unpublished");
  const needsImage = catalogProducts.filter(productNeedsMainImage);
  const setText = (id, value) => { const node = document.getElementById(id); if (node) node.textContent = value; };
  const total = catalogProducts.length;
  const percent = total ? Math.round((published.length / total) * 100) : 0;
  setText("dashboard-total", total);
  setText("dashboard-published", published.length);
  setText("dashboard-drafts", drafts.length);
  setText("dashboard-review", needsImage.length);
  setText("dashboard-chart-total", total);
  setText("dashboard-legend-published", published.length);
  setText("dashboard-legend-drafts", drafts.length);
  setText("dashboard-task-drafts", drafts.length);
  setText("dashboard-task-images", needsImage.length);

  const draftsTaskDescription = document.querySelector('[data-dashboard-action="drafts"] small');
  if (draftsTaskDescription) {
    if (!drafts.length) {
      draftsTaskDescription.textContent = dashboardCatalogScope === "all"
        ? "No hay productos pendientes en ninguno de los catálogos"
        : "No hay productos pendientes en esta vista";
    } else {
      const draftCatalogs = new Set(drafts.map(product => normalizeCatalogType(product.catalog_type)));
      const locationLabel = draftCatalogs.size > 1
        ? "ambos catálogos"
        : draftCatalogs.has("perfumery") ? "JB Parfums" : "JB TECH";
      const countLabel = drafts.length === 1 ? "producto sin publicar" : "productos sin publicar";
      draftsTaskDescription.textContent = dashboardCatalogScope === "all"
        ? `${drafts.length} ${countLabel} en ${locationLabel} · tocá para revisar`
        : `${drafts.length} ${countLabel} en este catálogo · tocá para revisar`;
    }
  }

  const imagesTaskDescription = document.querySelector('[data-dashboard-action="review"] small');
  if (imagesTaskDescription) {
    if (!needsImage.length) {
      imagesTaskDescription.textContent = "No hay productos sin fotografía principal en esta vista";
    } else {
      const imageCatalogs = new Set(needsImage.map(product => normalizeCatalogType(product.catalog_type)));
      const locationLabel = imageCatalogs.size > 1
        ? "ambos catálogos"
        : imageCatalogs.has("perfumery") ? "JB Parfums" : "JB TECH";
      const countLabel = needsImage.length === 1 ? "producto sin foto principal" : "productos sin foto principal";
      imagesTaskDescription.textContent = dashboardCatalogScope === "all"
        ? `${needsImage.length} ${countLabel} en ${locationLabel} · tocá para completar`
        : `${needsImage.length} ${countLabel} · tocá para completar`;
    }
  }
  setText("dashboard-publication-summary", total ? `${percent}% del catálogo está publicado.` : "Agregá tu primer producto para comenzar.");
  setText("dashboard-task-status", total ? "Inventario cargado correctamente" : "Todavía no hay productos en el inventario");
  const ring = document.getElementById("dashboard-chart-ring");
  if (ring) ring.style.setProperty("--published-ratio", `${percent}%`);
  const progress = document.getElementById("dashboard-progress-published");
  if (progress) progress.style.width = `${percent}%`;
  const activity = document.getElementById("dashboard-activity-list");
  if (activity) {
    const recent = [...catalogProducts].sort((a,b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0)).slice(0,4);
    activity.innerHTML = recent.length ? recent.map(product => {
      const title = escapeHtml(product.name || "Producto sin nombre");
      const status = product.is_published ? "Publicado" : "Guardado como borrador";
      const catalogLabel = dashboardCatalogScope === "all"
        ? (normalizeCatalogType(product.catalog_type) === "perfumery" ? "JB Parfums · " : "JB TECH · ")
        : "";
      const dateValue = product.updated_at || product.created_at;
      const date = dateValue ? new Date(dateValue).toLocaleDateString("es-NI", { day:"2-digit", month:"short" }) : "Fecha no disponible";
      return `<div class="dashboard-activity-item"><span class="dashboard-activity-mark ${product.is_published ? "activity-mark-published" : "activity-mark-draft"}">${product.is_published ? "✓" : "◷"}</span><div><strong>${title}</strong><small>${catalogLabel}${status}</small></div><time>${escapeHtml(date)}</time></div>`;
    }).join("") : '<p class="dashboard-empty-state">Todavía no hay actividad. Añadí un producto para comenzar.</p>';
  }
}

document.querySelectorAll("[data-dashboard-action]").forEach(button => {
  button.addEventListener("click", () => {
    const action = button.dataset.dashboardAction;

    if (action === "drafts") {
      const scopedDrafts = getDashboardProducts().filter(product => !product.is_published);
      const target = scopedDrafts.find(product => normalizeCatalogType(product.catalog_type) === activeCatalogType)
        || scopedDrafts[0];

      // Dashboard can summarize both catalogs; the task must open the catalog
      // that actually contains drafts rather than an empty list in the current catalog.
      if (target) {
        const targetCatalog = normalizeCatalogType(target.catalog_type);
        if (targetCatalog !== activeCatalogType) setActiveCatalogType(targetCatalog);
      }
      showAdminSection("drafts");
      return;
    }

    if (action === "review") {
      const scopedNeedsImage = getDashboardProducts().filter(productNeedsMainImage);
      const target = scopedNeedsImage.find(product => normalizeCatalogType(product.catalog_type) === activeCatalogType)
        || scopedNeedsImage[0];

      if (target) {
        const targetCatalog = normalizeCatalogType(target.catalog_type);
        if (targetCatalog !== activeCatalogType) setActiveCatalogType(targetCatalog);

        const targetSection = target.is_published ? "published" : "drafts";
        showAdminSection(targetSection);
        const search = document.getElementById(targetSection === "published" ? "published-search" : "draft-search");
        if (search) {
          search.value = String(target.name || "");
          search.dispatchEvent(new Event("input"));
        }
      } else {
        showAdminSection("published");
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
          const colorAvailability = normalizeVariantAvailability(variant.availability);
          const configurationAvailability = normalizeVariantAvailability(variant.configuration_availability);
          const status = previewAvailability(colorAvailability === "out_of_stock" || configurationAvailability === "out_of_stock"
            ? "out_of_stock"
            : colorAvailability === "order" || configurationAvailability === "order" ? "on_order" : "available");
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

async function deleteProductFromDatabase(product) {
  if (!supabase || !currentUser) throw new Error("La sesión administrativa no está disponible.");
  const currentStatus = getWorkflowStatus(product);
  if (!["trash", "deleting"].includes(currentStatus)) {
    throw new Error("Por seguridad, la eliminación definitiva solo está disponible desde la papelera.");
  }
  const { data: markedRows, error: markError } = await supabase
    .from("products")
    .update({
      workflow_status: "deleting",
      is_published: false,
      deleted_at: product.deleted_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      updated_by: currentUser.id
    })
    .eq("id", product.id)
    .in("workflow_status", ["trash", "deleting"])
    .select("id");
  if (markError) throw markError;
  if (!Array.isArray(markedRows) || !markedRows.some(row => String(row.id) === String(product.id))) {
    throw new Error("El producto cambió de estado. Actualizá el panel antes de volver a intentarlo.");
  }

  const imagePaths = collectProductStoragePaths(product);
  const storageErrors = [];
  const bucket = String(CONFIG.storageBucket || "product-images");
  for (let offset = 0; offset < imagePaths.length; offset += 100) {
    try {
      const { error: storageError } = await supabase.storage.from(bucket).remove(imagePaths.slice(offset, offset + 100));
      if (storageError) storageErrors.push(storageError.message || "Error de Storage sin detalle.");
    } catch (storageError) {
      storageErrors.push(storageError && storageError.message ? storageError.message : "Error de Storage sin detalle.");
    }
  }
  if (storageErrors.length) {
    throw new Error("El producto permanece protegido en la papelera; la limpieza de Storage falló y puede reintentarse: " + storageErrors.slice(0, 2).join(" · "));
  }
  const { data: deletedRows, error: deleteError } = await supabase
    .from("products").delete().eq("id", product.id).eq("workflow_status", "deleting").select("id");
  if (deleteError) throw deleteError;
  if (!Array.isArray(deletedRows) || !deletedRows.some(row => String(row.id) === String(product.id))) {
    throw new Error("Las fotografías se limpiaron, pero la base no confirmó el borrado. Reintentá desde la papelera.");
  }
  return { imageCount: imagePaths.length, storageErrors: [] };
}

function getWorkflowStatus(product) {
  if (["draft", "unpublished", "published", "trash", "deleting"].includes(product?.workflow_status)) return product.workflow_status;
  return product?.is_published ? "published" : "unpublished";
}
function renderAdminList() {
  const items=getActiveCatalogProducts();
  const searchable=p=>[p.name,p.brand,p.model,p.category,p.perfume_details&&p.perfume_details.scent_family].join(" ").toLocaleLowerCase("es");
  const byStatus=s=>items.filter(p=>getWorkflowStatus(p)===s);
  const published=byStatus("published"), unpublished=byStatus("unpublished"), drafts=byStatus("draft");
  const trash=items.filter(p=>["trash","deleting"].includes(getWorkflowStatus(p)));
  const filter=(rows,selector)=>{const q=($(selector)?.value||"").trim().toLocaleLowerCase("es");return rows.filter(p=>searchable(p).includes(q));};
  const svg={
    view:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
    edit:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5 4 4M4 20l4.2-.8L19 8.4a2.1 2.1 0 0 0-3-3L5.2 16.2 4 20Z"></path></svg>',
    trash:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 10v6M14 10v6"></path></svg>',
    restore:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11a9 9 0 1 0 3-6.7L3 7"></path><path d="M3 3v4h4M12 7v5l3 2"></path></svg>',
    delete:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"></path></svg>',
    star:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"></path></svg>'
  };
  const cards=(rows,empty,isTrash)=>rows.map(p=>{
    const image=getImages(p)[0], thumb=image?'<img class="admin-product-thumb" src="'+escapeHtml(image)+'" alt="" loading="lazy">':'<div class="admin-product-thumb" style="display:grid;place-items:center;color:#9aa6b9">▧</div>';
    const variants=normalizeVariants(p.variants), perfume=p.catalog_type==="perfumery", d=p.perfume_details||{};
    const variantLabel=perfume?[d.family?perfumeFamilyLabel(d.family):"",d.concentration,d.volume_ml?d.volume_ml+" ml":""].filter(Boolean).join(" · "):variants.length?variants.length+" variante"+(variants.length===1?"":"s"):"";
    const price=minimumPrice(variants,"price_usd")??p.price_usd, priceLabel=price===null||price===undefined||price===""?"Consultar":"US"+Number(price).toLocaleString("en-US",{maximumFractionDigits:2});
    const isExclusive = Boolean(p.is_exclusive || p.featured);
    const productTypeLabel = p.catalog_type === "perfumery" ? (p.product_type === "set" ? "Set de perfumes" : "Perfume / fragancia") : "";
    const status=getWorkflowStatus(p), statusLabel=status==="published"?"Publicado":status==="draft"?"Borrador":status==="deleting"?"Limpieza pendiente":status==="trash"?"En papelera":"No publicado";
    let actions="";
    if(isTrash){
      actions=(status==="deleting"?'':'<button class="admin-mini-button admin-icon-button" type="button" data-restore-product="'+escapeHtml(p.id)+'" aria-label="Restaurar producto" title="Restaurar producto">'+svg.restore+'</button>')+'<button class="admin-mini-button admin-icon-button danger" type="button" data-delete-product="'+escapeHtml(p.id)+'" aria-label="'+(status==="deleting"?"Reintentar limpieza":"Eliminar definitivamente")+'" title="'+(status==="deleting"?"Reintentar limpieza de Storage":"Eliminar definitivamente")+'">'+svg.delete+'</button>';
    }else{
      actions='<button class="admin-mini-button admin-icon-button admin-preview-open-button" type="button" data-preview-product="'+escapeHtml(p.id)+'" aria-label="Ver producto" title="Ver producto">'+svg.view+'</button><button class="admin-mini-button admin-icon-button" type="button" data-edit="'+escapeHtml(p.id)+'" aria-label="Editar producto" title="Editar producto">'+svg.edit+'</button><button class="admin-mini-button admin-icon-button'+(isExclusive?' is-exclusive':'')+'" type="button" data-exclusive-product="'+escapeHtml(p.id)+'" aria-label="'+(isExclusive?'Quitar de destacados/exclusivos':'Destacar en el catálogo')+'" title="'+(isExclusive?'Quitar de destacados/exclusivos':'Destacar en el catálogo')+'">'+svg.star+'</button><button class="admin-mini-button admin-icon-button danger" type="button" data-trash-product="'+escapeHtml(p.id)+'" aria-label="Mover a papelera" title="Mover a papelera">'+svg.trash+'</button>';
    }
    const expiry=p.deleted_at?" · vence "+new Date(new Date(p.deleted_at).getTime()+15*86400000).toLocaleDateString("es-NI"):"";
    return '<article class="admin-product-row">'+thumb+'<div><p class="admin-product-name">'+escapeHtml(p.name||"Borrador sin nombre")+'</p><div class="admin-product-meta">'+escapeHtml(p.category||"Sin categoría")+' · '+escapeHtml(priceLabel)+(productTypeLabel?" · "+escapeHtml(productTypeLabel):"")+' · '+statusLabel+(isExclusive?" · Destacado / exclusivo":"")+(variantLabel?" · "+escapeHtml(variantLabel):"")+escapeHtml(expiry)+'</div><div class="admin-product-buttons">'+actions+'</div></div></article>';
  }).join("")||'<p class="form-status">'+empty+'</p>';
  $("#published-product-list").innerHTML=cards(filter(published,"#published-search"),"Todavía no hay productos publicados.");
  $("#unpublished-product-list").innerHTML=cards(filter(unpublished,"#unpublished-search"),"No hay productos completos pendientes de publicar.");
  $("#draft-product-list").innerHTML=cards(filter(drafts,"#draft-search"),"No hay borradores guardados.");
  $("#trash-product-list").innerHTML=cards(filter(trash,"#trash-search"),"La papelera está vacía.",true);
  $("#published-count").textContent=published.length+" producto"+(published.length===1?"":"s")+" publicados";
  $("#unpublished-count").textContent=unpublished.length+" producto"+(unpublished.length===1?"":"s")+" sin publicar";
  $("#draft-count").textContent=drafts.length+" borrador"+(drafts.length===1?"":"es");
  $("#trash-count").textContent=trash.length+" producto"+(trash.length===1?"":"s")+" en papelera · se eliminan tras 15 días";
  $("#published-nav-count").textContent=published.length; $("#unpublished-nav-count").textContent=unpublished.length;
  $("#draft-nav-count").textContent=drafts.length; $("#trash-nav-count").textContent=trash.length;
}
["#published-search","#unpublished-search","#draft-search","#trash-search"].forEach(s=>$(s)?.addEventListener("input",renderAdminList));
document.querySelectorAll("#published-product-list,#unpublished-product-list,#draft-product-list,#trash-product-list").forEach(list=>list.addEventListener("click",async event=>{
  const preview=event.target.closest("[data-preview-product]"), edit=event.target.closest("[data-edit]");
  const trashButton=event.target.closest("[data-trash-product]"), restoreButton=event.target.closest("[data-restore-product]");
  const deleteButton=event.target.closest("[data-delete-product]"), exclusiveButton=event.target.closest("[data-exclusive-product]");
  if(trashButton||restoreButton||deleteButton||exclusiveButton){
    const target=trashButton||restoreButton||deleteButton||exclusiveButton;
    const id=target.dataset.trashProduct||target.dataset.restoreProduct||target.dataset.deleteProduct||target.dataset.exclusiveProduct;
    const product=products.find(p=>String(p.id)===String(id));
    if(!product||!currentUser||!supabase){setStatus("No se pudo identificar el producto o la sesión administrativa venció.","error");return;}
    target.disabled=true;
    try{
      if(trashButton){
        if(!window.confirm("¿Mover “"+(product.name||"Borrador sin nombre")+"” a la papelera? Podrás restaurarlo durante 15 días."))return;
        const previous=getWorkflowStatus(product);
        if(previous==="trash")return;
        const {error}=await supabase.from("products").update({workflow_status:"trash",deleted_from_status:previous,deleted_at:new Date().toISOString(),is_published:false,updated_at:new Date().toISOString(),updated_by:currentUser.id}).eq("id",product.id);
        if(error)throw error;
        setStatus("Producto movido a la papelera. Podés restaurarlo durante 15 días.","success");
      }else if(restoreButton){
        const restored=["draft","unpublished","published"].includes(product.deleted_from_status)?product.deleted_from_status:"unpublished";
        const {error}=await supabase.from("products").update({workflow_status:restored,deleted_from_status:null,deleted_at:null,is_published:restored==="published",updated_at:new Date().toISOString(),updated_by:currentUser.id}).eq("id",product.id);
        if(error)throw error;
        setStatus("Producto restaurado como "+(restored==="published"?"publicado":restored==="draft"?"borrador":"no publicado")+".","success");
      }else if(exclusiveButton){
        const next=!(product.is_exclusive || product.featured);
        const {error}=await supabase.from("products").update({is_exclusive:next,featured:next,updated_at:new Date().toISOString(),updated_by:currentUser.id}).eq("id",product.id);
        if(error)throw error;
        setStatus(next?"Producto marcado como exclusivo.":"Producto quitado de exclusivos.","success");
      }else{
        if(!window.confirm("¿Eliminar definitivamente “"+(product.name||"Borrador sin nombre")+"”? No se puede deshacer. Se intentarán eliminar también sus fotografías de Storage."))return;
        const result=await deleteProductFromDatabase(product);
        setStatus(result.storageErrors.length?"Producto eliminado, pero hubo errores de Storage: "+result.storageErrors.slice(0,2).join(" · "):"Producto eliminado definitivamente. Fotografías eliminadas: "+result.imageCount+".",result.storageErrors.length?"error":"success");
      }
      await loadProducts();
    }catch(error){setStatus("No se pudo completar la acción: "+(error?.message||error),"error");}
    finally{target.disabled=false;}
    return;
  }
  if(preview){const product=products.find(p=>String(p.id)===preview.dataset.previewProduct);if(product)previewOpenProduct(product);return;}
  if(edit){const product=products.find(p=>String(p.id)===edit.dataset.edit);if(product){fillEditor(product);showAdminSection("add");}}
}));


/* =========================================================
   PROTECCIÓN ANTE RECARGA CON CAMBIOS SIN GUARDAR
   ========================================================= */

let editorBaseline = "";
let editorIsDirty = false;

function getEditorSnapshot(){
 if(!form)return "";
 const fields=Array.from(form.elements).map(f=>{if(!f||(!f.name&&!f.id&&!f.matches?.("[data-variant-row],[data-variant-group]")))return null;if(f.type==="file")return [f.id||f.getAttribute("data-variant-image")||"file",Array.from(f.files||[]).map(x=>[x.name,x.size,x.lastModified])];if(f.type==="checkbox"||f.type==="radio")return [f.id||f.name,f.checked];return [f.id||f.name||f.getAttribute("data-variant-color")||f.getAttribute("data-group-storage")||f.getAttribute("data-group-ram")||f.getAttribute("data-group-price-usd")||f.getAttribute("data-group-price-nio")||f.getAttribute("data-variant-availability")||f.getAttribute("data-variant-image-url")||f.tagName,f.value];}).filter(Boolean);
 const variants=Array.from(form.querySelectorAll("[data-variant-group]")).map(g=>({base:g.dataset.baseGroup==="true",storage:g.querySelector("[data-group-storage]")?.value||"",unit:g.querySelector("[data-group-storage-unit]")?.value||"GB",ram:g.querySelector("[data-group-ram]")?.value||"",usd:g.querySelector("[data-group-price-usd]")?.value||"",nio:g.querySelector("[data-group-price-nio]")?.value||"",availability:g.querySelector("[data-group-availability]")?.value||"available",colors:Array.from(g.querySelectorAll("[data-variant-row]")).map(r=>({color:r.querySelector("[data-variant-color]")?.value||"",hex:r.querySelector("[data-variant-hex]")?.value||"",availability:r.querySelector("[data-variant-availability]")?.value||"",url:r.querySelector("[data-variant-image-url]")?.value||"",images:(r._variantImageItems||[]).map(i=>({id:i.id,kind:i.kind,url:i.url||"",name:i.file?.name||"",size:i.file?.size||0,lastModified:i.file?.lastModified||0}))}))}));
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
function recoveryVariantState() { return Array.from(form.querySelectorAll('[data-variant-group]')).map(g=>({base:g.dataset.baseGroup==='true',storage:g.querySelector('[data-group-storage]')?.value||'',unit:g.querySelector('[data-group-storage-unit]')?.value||'GB',ram:g.querySelector('[data-group-ram]')?.value||'',usd:g.querySelector('[data-group-price-usd]')?.value||'',nio:g.querySelector('[data-group-price-nio]')?.value||'',availability:g.querySelector('[data-group-availability]')?.value||'available',colors:Array.from(g.querySelectorAll('[data-variant-row]')).map(r=>({color:r.querySelector('[data-variant-color]')?.value||'',hex:r.querySelector('[data-variant-hex]')?.value||'',availability:r.querySelector('[data-variant-availability]')?.value||'available',images:(r._variantImageItems||[]).map(recoveryItem)}))})); }
async function saveLocalRecoveryDraft() { if(restoringRecovery||!form||!dashboard||dashboard.classList.contains('hidden'))return; const hasData=Boolean(editorIsDirty||$('#product-id')?.value||$('#product-name')?.value.trim()||mainImageItems.length||Array.from(form.querySelectorAll('[data-variant-row]')).some(r=>r.querySelector('[data-variant-color]')?.value.trim())); if(!hasData)return; const fields=Array.from(form.elements).filter(f=>f&&f.id&&f.type!=='file'&&!['password','submit','button','reset'].includes(f.type)).map(f=>({id:f.id,value:(f.type==='checkbox'||f.type==='radio')?null:f.value,checked:(f.type==='checkbox'||f.type==='radio')?f.checked:null})); const draft={key:RECOVERY_KEY,savedAt:new Date().toISOString(),fields,variants:recoveryVariantState(),mainGallery:mainImageItems.map(recoveryItem)}; try{await recoveryAction('readwrite',s=>s.put(draft));const st=$('#local-recovery-status');if(st)st.textContent='Borrador local guardado automáticamente: '+new Date(draft.savedAt).toLocaleString();const rb=$('#restore-local-draft');if(rb)rb.hidden=false;const db=$('#delete-local-draft');if(db)db.hidden=false;}catch(e){console.warn('No se pudo guardar el borrador local.',e);const st=$('#local-recovery-status');if(st)st.textContent='No se pudo guardar el borrador local. Revisá el almacenamiento del navegador.';} }
function scheduleLocalRecoverySave(delay = 120) {
  if (restoringRecovery) return;
  clearTimeout(recoveryTimer);
  recoveryTimer = window.setTimeout(() => {
    void saveLocalRecoveryDraft();
  }, Math.max(0, delay));
}
async function recoveryRestoreItem(i){if(i.kind!=='new'||!i.blob)return{id:i.id||imageId(),kind:'existing',url:i.url||''};const file=new File([i.blob],i.name||'imagen-pendiente',{type:i.type||i.blob.type||'application/octet-stream',lastModified:i.lastModified||Date.now()});return{id:i.id||imageId(),kind:'new',file,previewUrl:URL.createObjectURL(file),uploadError:i.uploadError||''};}
async function restoreLocalRecoveryDraft(){let d;try{d=await recoveryAction('readonly',s=>s.get(RECOVERY_KEY));}catch(e){message('#product-form-status',e.message||'No se pudo leer el borrador.','error');return;}if(!d){const st=$('#local-recovery-status');if(st)st.textContent='No hay borrador local guardado.';return;}if(!confirm('Hay un borrador local guardado el '+new Date(d.savedAt).toLocaleString()+'. ¿Deseás recuperarlo?'))return;restoringRecovery=true;try{clearEditor();for(const f of d.fields||[]){const n=document.getElementById(f.id);if(!n||n.type==='file')continue;if(n.type==='checkbox'||n.type==='radio')n.checked=Boolean(f.checked);else if(f.value!==null)n.value=f.value;}const vs=[];for(const g of d.variants||[])for(const c of g.colors||[])vs.push({storage:g.base?'':formatStorageLabel(g.storage,g.unit),ram:g.base?'':(g.ram?g.ram+' GB':''),price_usd:g.usd===''?null:Number(g.usd),price_nio:g.nio===''?null:Number(g.nio),color:c.color,color_hex:c.hex,availability:c.availability,configuration_availability:g.availability||'available',images:(c.images||[]).filter(i=>i.kind==='existing'&&i.url).map(i=>i.url),image_url:(c.images||[]).find(i=>i.kind==='existing'&&i.url)?.url||''});renderVariantRows(vs);mainImageItems=[];for(const i of d.mainGallery||[])mainImageItems.push(await recoveryRestoreItem(i));renderMainImagePreviews();const rows=Array.from(form.querySelectorAll('[data-variant-row]')),saved=(d.variants||[]).flatMap(g=>g.colors||[]);for(let x=0;x<rows.length&&x<saved.length;x++){const items=[];for(const i of saved[x].images||[])items.push(await recoveryRestoreItem(i));rows[x]._variantImageItems=items;syncVariantImageFields(rows[x]);renderVariantImagePreview(rows[x]);}$('#form-title').textContent=$('#product-id').value?'Continuar edición recuperada':'Continuar borrador recuperado';$('#save-product-button').setAttribute('aria-label',$('#product-id').value?'Guardar cambios':'Guardar producto sin publicar');$('#save-product-button').title=$('#product-id').value?'Guardar cambios sin publicar':'Guardar producto sin publicar';message('#product-form-status','Borrador recuperado. Revisá los datos y las fotografías antes de guardar.','success');showAdminSection('add');markEditorClean();updateEditorDirtyState();window.scrollTo({top:0,behavior:'smooth'});}catch(e){console.error('No se pudo restaurar el borrador.',e);message('#product-form-status','El borrador no se pudo restaurar por completo: '+(e.message||'error desconocido'),'error');}finally{restoringRecovery=false;}}
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
  if (!form) return;
  cancelQueuedPhotoUploadsForEditor();
  editorRecordExists=false;
  form.reset();
  $("#product-subcategory").value = "";
  $("#product-subcategory-custom").value = "";
  $("#product-subcategory-custom").hidden = true;

  // A fresh product must not inherit custom tags from the previous editor.
  // Do not call setProductTags here: clearEditor can run before its const set is initialized.
  customProductTags = [];
  renderCustomProductTagChips();

  $("#product-id").value = "";
  $("#catalog-key").value = "";
  $("#product-description").value = "";
  $("#product-active").checked = false;
  $("#product-exclusive").checked = false;
  $("#product-featured").checked = false;
  if ($("#product-type")) $("#product-type").value = activeCatalogType === "perfumery" ? "perfume" : "standard";
  $("#toggle-product-exclusive")?.setAttribute("aria-pressed","false");
  $("#toggle-product-exclusive")?.classList.remove("is-active");
  $("#product-featured").checked = false;

  $("#product-financing").value =
    "";

  $("#product-images").value = "";
  clearMainImagePreviews();
  renderMainImagePreviews();

  renderVariantRows([]);
  updateCategoryVariantVisibility();

  $("#product-perfume-family").value = "";
  if ($("#product-type")) $("#product-type").value = activeCatalogType === "perfumery" ? "perfume" : "standard";
  $("#product-perfume-concentration").value = "";
  $("#product-perfume-volume").value = "";
  $("#product-perfume-audience").value = "";
  $("#product-perfume-scent-family").value = "";
  $("#product-perfume-top-notes").value = "";
  $("#product-perfume-heart-notes").value = "";
  $("#product-perfume-base-notes").value = "";

  updateProductFormMode();
  $("#form-title").textContent = activeCatalogType === "perfumery" ? "Registrar fragancia" : "Agregar producto";
  $("#save-product-button").setAttribute("aria-label", "Guardar producto sin publicar");
  $("#save-product-button").title = "Guardar producto sin publicar";

  message("#product-form-status", "");
  syncProductFormSectionAvailability();
  setProductFormStep(1, { scroll: false });
  markEditorClean();
  scheduleProductDuplicateCheck({ immediate: true });
}

const PRODUCT_SUBCATEGORY_SUGGESTIONS = {
  "Gaming": ["Consolas"],
  "Celulares": ["Gaming", "Fotografía", "Batería de larga duración", "Gama alta", "Gama media", "Económicos"],
  "Laptops": ["Gaming", "Trabajo / Oficina", "Estudio", "Arquitectura / Ingeniería", "Creación de contenido / Diseño", "Uso general"],
  "Tablets": ["Estudio", "Trabajo / Oficina", "Diseño / Ilustración", "Gaming", "Uso general"],
  "Consolas": ["PlayStation 5", "PlayStation", "Xbox", "Nintendo"],
  "Televisores": ["Smart TV", "4K / UHD", "OLED", "QLED", "Uso comercial"],
  "Audio": ["Audífonos", "Bocinas", "Gaming", "Profesional"],
  "Accesorios": ["Cargadores", "Fundas", "Protección", "Conectividad", "Gaming", "Periféricos"],
  "Otros": ["Uso general"]
};
const CUSTOM_PRODUCT_SUBCATEGORY_VALUE = "__custom__";

function updateProductSubcategorySuggestions(preferredValue) {
  const select = $("#product-subcategory");
  const customInput = $("#product-subcategory-custom");
  if (!select) return;

  const currentValue = preferredValue !== undefined
    ? String(preferredValue || "").trim()
    : select.value === CUSTOM_PRODUCT_SUBCATEGORY_VALUE
      ? String(customInput?.value || "").trim()
      : String(select.value || "").trim();
  const category = normalizeTechnologyCategory($("#product-category")?.value || "");
  const suggestions = [...new Set(PRODUCT_SUBCATEGORY_SUGGESTIONS[category] || [])];

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Seleccionar subcategoría…";
  select.replaceChildren(placeholder);
  suggestions.forEach(value => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  });
  const customOption = document.createElement("option");
  customOption.value = CUSTOM_PRODUCT_SUBCATEGORY_VALUE;
  customOption.textContent = "Otra (escribir…)";
  select.append(customOption);

  const matchingSuggestion = suggestions.find(value =>
    value.toLocaleLowerCase("es") === currentValue.toLocaleLowerCase("es")
  );
  if (matchingSuggestion) {
    select.value = matchingSuggestion;
    if (customInput) customInput.value = "";
  } else if (currentValue) {
    select.value = CUSTOM_PRODUCT_SUBCATEGORY_VALUE;
    if (customInput) customInput.value = currentValue;
  } else {
    select.value = "";
    if (customInput) customInput.value = "";
  }
  if (customInput) customInput.hidden = select.value !== CUSTOM_PRODUCT_SUBCATEGORY_VALUE;
}

function getSelectedProductSubcategory() {
  const select = $("#product-subcategory");
  if (!select) return "";
  if (select.value === CUSTOM_PRODUCT_SUBCATEGORY_VALUE) {
    return String($("#product-subcategory-custom")?.value || "").trim();
  }
  return String(select.value || "").trim();
}

const PREDEFINED_PRODUCT_TAGS = new Set(["exclusive", "limited_edition", "high_performance", "quality_price", "top_gaming", "best_seller", "new_arrival", "offer"]);

function parseCustomProductTagTokens(value) {
  return String(value || "")
    .split(/[,;\n]+/)
    .map(tag => tag.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

function renderCustomProductTagChips() {
  const container = $("#product-custom-tags-chips");
  if (!container) return;
  container.replaceChildren();
  container.hidden = customProductTags.length === 0;

  customProductTags.forEach((tag, index) => {
    const chip = document.createElement("span");
    chip.className = "product-custom-tag-chip";

    const label = document.createElement("span");
    label.className = "product-custom-tag-label";
    label.textContent = tag;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "product-custom-tag-remove";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Quitar etiqueta ${tag}`);
    remove.addEventListener("click", () => {
      customProductTags.splice(index, 1);
      renderCustomProductTagChips();
      $("#product-custom-tags")?.focus();
    });

    chip.append(label, remove);
    container.append(chip);
  });
}

function addCustomProductTags(tags) {
  const seen = new Set(customProductTags.map(tag => tag.toLocaleLowerCase("es")));
  for (const value of tags) {
    const tag = String(value || "").trim().replace(/\s+/g, " ");
    if (!tag) continue;
    const key = tag.toLocaleLowerCase("es");
    if (seen.has(key)) continue;
    customProductTags.push(tag);
    seen.add(key);
  }
  renderCustomProductTagChips();
}

function commitCustomProductTags() {
  const input = $("#product-custom-tags");
  if (!input) return;
  const tokens = parseCustomProductTagTokens(input.value);
  if (!tokens.length) return;
  addCustomProductTags(tokens);
  input.value = "";
}

function initializeCustomProductTagInput() {
  const input = $("#product-custom-tags");
  if (!input || input.dataset.customTagInputReady === "true") return;
  input.dataset.customTagInputReady = "true";

  input.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      commitCustomProductTags();
      return;
    }
    if (event.key === ",") {
      event.preventDefault();
      commitCustomProductTags();
    }
  });
  // Committing on blur also supports tapping Save without pressing Enter.
  input.addEventListener("blur", () => {
    if (input.value.trim()) commitCustomProductTags();
  });
}

function selectedProductTags() {
  const predefined = Array.from(document.querySelectorAll("[data-product-tag]:checked"))
    .map(input => String(input.value || "").trim().toLowerCase()).filter(Boolean);
  const custom = [...customProductTags, ...parseCustomProductTagTokens($("#product-custom-tags")?.value || "")];
  const result = [...predefined];
  const seen = new Set(result.map(tag => tag.toLocaleLowerCase("es")));
  for (const tag of custom) {
    const key = tag.toLocaleLowerCase("es");
    if (!seen.has(key)) { result.push(tag); seen.add(key); }
  }
  return result;
}

function setProductTags(tags) {
  const values = (Array.isArray(tags) ? tags : []).map(tag => String(tag || "").trim()).filter(tag => tag && tag.toLocaleLowerCase("es") !== "recommended");
  const selected = new Set(values.map(tag => tag.toLocaleLowerCase("es")));
  document.querySelectorAll("[data-product-tag]").forEach(input => { input.checked = selected.has(input.value); });
  customProductTags = values.filter(tag => !PREDEFINED_PRODUCT_TAGS.has(tag.toLowerCase()));
  const input = $("#product-custom-tags");
  if (input) input.value = "";
  renderCustomProductTagChips();
}

initializeCustomProductTagInput();

function fillEditor(product) {
  activeCatalogType = normalizeCatalogType(product.catalog_type);
  if (activeCatalogSelector) activeCatalogSelector.value = activeCatalogType;
  if ($("#product-type")) $("#product-type").value = activeCatalogType === "perfumery" ? (product.product_type === "set" ? "set" : "perfume") : "standard";
  updateProductFormMode();

  $("#product-id").value = product.id || "";
  editorRecordExists=true;
  $("#catalog-key").value = product.catalog_key || "";
  $("#product-name").value = product.name || "";
  $("#product-brand").value = product.brand || "";
  $("#product-model").value = product.model || "";
  $("#product-category").value = activeCatalogType === "perfumery" ? "Perfumería" : normalizeTechnologyCategory(product.category || "Otros");
  updateProductSubcategorySuggestions(activeCatalogType === "perfumery" ? "" : (product.subcategory || ""));
  setProductTags(product.tags || []);
  $("#product-description").value = product.description || "";
  $("#product-availability").value = normalizeProductAvailability(product.availability);
  $("#product-price-usd").value = product.price_usd ?? "";
  $("#product-price-nio").value = product.price_nio ?? "";
  $("#product-warranty").value = activeCatalogType === "perfumery" ? "" : (product.warranty_months ?? "");
  $("#product-specs").value = activeCatalogType === "perfumery" ? "" : specsText(product.specifications);
  $("#product-financing").value = product.financing_note ||
    "";
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

  $("#product-images").value = "";
  setExistingMainImages(getImages(product));
  renderVariantRows(activeCatalogType === "perfumery" ? [] : legacyVariants(product));
  updateCategoryVariantVisibility();
  if (activeCatalogType !== "perfumery") {
    const primaryGroup = baseColorManager?.querySelector('[data-variant-group][data-base-group="true"]');
    const primaryUSD = primaryGroup?.querySelector("[data-group-price-usd]");
    const primaryNIO = primaryGroup?.querySelector("[data-group-price-nio]");
    if (primaryUSD && !primaryUSD.value && product.price_usd != null) primaryUSD.value = String(product.price_usd);
    if (primaryNIO && !primaryNIO.value && product.price_nio != null) primaryNIO.value = String(product.price_nio);
  }

  const productIsFeatured = activeCatalogType !== "perfumery" && Boolean(product.featured || product.is_exclusive);
  if (productIsFeatured) $("#product-tag-high-performance").checked = false;
  $("#product-featured").checked = productIsFeatured;
  $("#product-exclusive").checked = productIsFeatured;
  $("#product-tag-exclusive").checked = productIsFeatured;
  $("#product-active").checked = Boolean(product.is_published);
  $("#toggle-product-exclusive")?.setAttribute("aria-pressed",String(productIsFeatured));
  $("#toggle-product-exclusive")?.setAttribute("aria-label", productIsFeatured ? "Destacado / exclusivo activado" : "Destacar en el catálogo");
  $("#toggle-product-exclusive")?.classList.toggle("is-active", productIsFeatured);

  $("#form-title").textContent = activeCatalogType === "perfumery" ? "Editar fragancia" : "Editar producto";
  $("#save-product-button").setAttribute("aria-label", "Guardar cambios sin publicar");
  $("#save-product-button").title = "Guardar cambios sin publicar";
  message("#product-form-status", "Editando: " + product.name);

  renderAdminList();
  renderDashboardOverview();
  void loadCatalogAnalytics();

  window.scrollTo({ top: 0, behavior: "smooth" });
  markEditorClean();
  scheduleProductDuplicateCheck({ immediate: true });
}
async function discardEditorChanges() {
  if (editorIsDirty && !window.confirm("¿Descartar los cambios sin guardar? No se guardará ningún producto.")) return;
  clearTimeout(recoveryTimer);
  await recoveryAction("readwrite", store => store.delete(RECOVERY_KEY)).catch(error => console.warn("No se pudo limpiar el borrador local al cancelar.", error));
  clearEditor();
}
$("#new-product-button")?.addEventListener("click", () => void discardEditorChanges());
$("#cancel-edit-button")?.addEventListener("click", () => void discardEditorChanges());
const exclusiveToggleButton = $("#toggle-product-exclusive");
let exclusiveToggleInProgress = false;
function setExclusiveToggleUI(value) {
  const field = $("#product-exclusive");
  const featuredField = $("#product-featured");
  if (field) field.checked = Boolean(value);
  if (featuredField) featuredField.checked = Boolean(value);
  const exclusiveTag = $("#product-tag-exclusive");
  const highPerformanceTag = $("#product-tag-high-performance");
  if (exclusiveTag) exclusiveTag.checked = Boolean(value);
  if (highPerformanceTag && value) highPerformanceTag.checked = false;
  exclusiveToggleButton?.setAttribute("aria-pressed", String(Boolean(value)));
  exclusiveToggleButton?.setAttribute("aria-label", value ? "Exclusividad activada" : "Marcar como exclusivo");
  if (exclusiveToggleButton) exclusiveToggleButton.title = value
    ? "Exclusividad activada. Tocá para desactivarla."
    : "Marcar este producto como exclusivo";
  exclusiveToggleButton?.classList.toggle("is-active", Boolean(value));
}
function updateExclusiveBaseline(value) {
  try {
    const baseline = JSON.parse(editorBaseline || "{}");
    for (const field of baseline.fields || []) {
      if (field[0] === "product-exclusive" || field[0] === "product-featured") field[1] = Boolean(value);
    }
    editorBaseline = JSON.stringify(baseline);
  } catch {}
  updateEditorDirtyState();
}
document.querySelectorAll("[data-product-tag]").forEach(input => input.addEventListener("change", () => {
  if (input.value === "exclusive") setExclusiveToggleUI(input.checked);
  if (input.value === "high_performance" && input.checked) {
    // High performance and Exclusive are alternative primary labels.
    setExclusiveToggleUI(false);
    updateEditorDirtyState();
    scheduleLocalRecoverySave();
  }
}));
exclusiveToggleButton?.addEventListener("click", async () => {
  if (activeCatalogType === "perfumery") {
    setExclusiveToggleUI(false);
    return;
  }
  if (exclusiveToggleInProgress) return;
  const field = $("#product-exclusive");
  const featuredField = $("#product-featured");
  if (!field || !featuredField) return;
  const previous = Boolean(field.checked || featuredField.checked);
  const next = !previous;
  const productId = $("#product-id")?.value?.trim() || "";
  setExclusiveToggleUI(next);
  field.dispatchEvent(new Event("change", { bubbles: true }));

  /* A new, unsaved product has no row to update yet; include the flag on the next save. */
  if (!productId || !editorRecordExists) {
    message("#product-form-status",
      next
        ? "Exclusividad seleccionada. Se guardará cuando guardés, publiques o guardés como borrador."
        : "Exclusividad desactivada. Se aplicará cuando guardés el producto.",
      "success");
    return;
  }

  if (!currentUser || !supabase) {
    setExclusiveToggleUI(previous);
    updateEditorDirtyState();
    message("#product-form-status", "No se pudo guardar la exclusividad porque la sesión administrativa no está activa. Volvé a iniciar sesión.", "error");
    return;
  }

  exclusiveToggleInProgress = true;
  exclusiveToggleButton.disabled = true;
  exclusiveToggleButton.setAttribute("aria-busy", "true");
  try {
    const updatedAt = new Date().toISOString();
    const { data, error } = await supabase
      .from("products")
      .update({
        featured: next,
        is_exclusive: next,
        updated_at: updatedAt,
        updated_by: currentUser.id
      })
      .eq("id", productId)
      .select("id, featured, is_exclusive")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Supabase no confirmó el cambio en el producto.");

    products = products.map(product => String(product.id) === String(productId)
      ? { ...product, featured: next, is_exclusive: next, updated_at: updatedAt, updated_by: currentUser.id }
      : product);
    updateExclusiveBaseline(next);
    renderAdminList();
    renderDashboardOverview();
    void loadCatalogAnalytics();

    message("#product-form-status",
      next
        ? "Exclusividad activada y guardada en el producto."
        : "Exclusividad desactivada y guardada en el producto.",
      "success");
  } catch (error) {
    setExclusiveToggleUI(previous);
    updateEditorDirtyState();
    message("#product-form-status",
      "No se pudo guardar la exclusividad. El botón volvió a su estado anterior. Detalle: " + (error?.message || "error desconocido"),
      "error");
  } finally {
    exclusiveToggleInProgress = false;
    exclusiveToggleButton.disabled = false;
    exclusiveToggleButton.removeAttribute("aria-busy");
    updateMainImageRetryButton();
  }
});
$("#product-type")?.addEventListener("change", () => {
  const isPerfume = activeCatalogType === "perfumery";
  const isSet = $("#product-type").value === "set";
  $("#product-perfume-concentration-field")?.classList.toggle("hidden", isSet);
  $("#product-perfume-volume-field")?.classList.toggle("hidden", isSet);
  if (isSet) {
    $("#product-perfume-concentration").value = "";
    $("#product-perfume-volume").value = "";
  }
  const editing = Boolean(editorRecordExists && $("#product-id")?.value);
  const formTitle = $("#form-title");
  if (formTitle && isPerfume) formTitle.textContent = isSet ? (editing ? "Editar set de perfumes" : "Registrar set de perfumes") : (editing ? "Editar fragancia" : "Registrar fragancia");
  const galleryTitle = $("#product-images-title");
  if (galleryTitle && isPerfume) galleryTitle.textContent = isSet ? "Fotografías generales del set" : "Fotografías generales de la fragancia";
  updateEditorDirtyState();
  scheduleLocalRecoverySave();
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
  if (!optimizableTypes.has(originalMime) || file.size <= 400 * 1024) return file;

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
    const maxEdge = 1600;
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    if (scale === 1 && file.size <= 400 * 1024) return file;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return file;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, canvas.width, canvas.height);

    const outputType = "image/webp";
    const blob = await new Promise(resolve => canvas.toBlob(resolve, outputType, 0.82));
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

async function recoverUploadedImageUrl(bucket, path) {
  try {
    const { data, error } = await supabase.storage.from(bucket).info(path);
    if (error || !data) return "";
    return supabase.storage.from(bucket).getPublicUrl(path)?.data?.publicUrl || "";
  } catch {
    return "";
  }
}

async function uploadStorageObjectWithProgress(bucket,path,file,contentType,onProgress){
  if (IS_READ_ONLY_PREVIEW) {
    throw new Error("Vista previa segura: las fotografías permanecen en este navegador y no se envían a Supabase.");
  }
  const {data,error:sessionError}=await supabase.auth.getSession();
  if(sessionError)throw sessionError;
  const accessToken=data?.session?.access_token;
  if(!accessToken)throw new Error("La sesión administrativa expiró. Volvé a iniciar sesión antes de subir fotografías.");
  const baseUrl=String(CONFIG.supabaseUrl||"").replace(/\/+$/,"");
  if(!baseUrl||!CONFIG.supabaseAnonKey)throw new Error("Falta la configuración pública de Supabase para subir fotografías.");
  const encodedBucket=encodeURIComponent(bucket);
  const encodedPath=String(path).split("/").map(part=>encodeURIComponent(part)).join("/");
  const endpoint=baseUrl+"/storage/v1/object/"+encodedBucket+"/"+encodedPath;
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();
    xhr.open("POST",endpoint,true);
    xhr.setRequestHeader("apikey",CONFIG.supabaseAnonKey);
    xhr.setRequestHeader("Authorization","Bearer "+accessToken);
    xhr.setRequestHeader("Content-Type",contentType);
    xhr.setRequestHeader("x-upsert","false");
    xhr.setRequestHeader("cache-control","max-age=3600");
    xhr.upload.addEventListener("progress",event=>{
      if(!event.lengthComputable||typeof onProgress!=="function")return;
      const percent=Math.max(0,Math.min(100,Math.round(event.loaded/event.total*100)));
      try{onProgress(percent);}catch(error){console.warn("No se pudo actualizar el progreso visual de la fotografía.",error);}
    });
    xhr.onload=()=>{
      if(xhr.status>=200&&xhr.status<300){resolve();return;}
      let detail="";
      try{
        const body=JSON.parse(xhr.responseText||"{}");
        detail=String(body.message||body.error||body.error_description||"");
      }catch{}
      const message=detail||("Supabase Storage respondió HTTP "+xhr.status+".");
      const uploadError=new Error(message);
      uploadError.status=xhr.status;
      uploadError.responseText=xhr.responseText||"";
      reject(uploadError);
    };
    xhr.onerror=()=>reject(new Error("Failed to fetch: se interrumpió la conexión durante la subida de la fotografía."));
    xhr.onabort=()=>reject(new Error("Failed to fetch: la subida de la fotografía fue interrumpida."));
    xhr.ontimeout=()=>reject(new Error("Failed to fetch: la subida superó el tiempo de espera."));
    xhr.timeout=120000;
    xhr.send(file);
  });
}

async function uploadImage(productId, file, subfolder = "", onProgress = null) {
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
      await uploadStorageObjectWithProgress(bucket, path, uploadFile, uploadMime, onProgress);
      if (typeof onProgress === "function") onProgress(100);
      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      return data.publicUrl;
    } catch (error) {
      lastError = error;
      if (isTransientImageUploadError(error)) {
        const recoveredUrl = await recoverUploadedImageUrl(bucket, path);
        if (recoveredUrl) return recoveredUrl;
      }
      if (attempt > 0 && /already exists|duplicate|resource exists/i.test(String(error?.message || ""))) {
        const { data } = supabase.storage.from(bucket).getPublicUrl(path);
        return data.publicUrl;
      }
      if (!isTransientImageUploadError(error) || attempt === maxAttempts - 1) break;
    }

    await waitBeforeRetry(1000 * (attempt + 1));
  }

  if (isTransientImageUploadError(lastError)) {
    const recoveredUrl = await recoverUploadedImageUrl(bucket, path);
    if (recoveredUrl) return recoveredUrl;
  }

  const detail = String(lastError?.message || "fallo de red sin detalle del servidor");
  const connectionAdvice = navigator.onLine === false
    ? "El teléfono aparece sin conexión."
    : isTransientImageUploadError(lastError)
      ? "El navegador no recibió una respuesta de Supabase Storage. Puede ser una interrupción de red o un bloqueo de la solicitud; probá de nuevo cuando la conexión esté estable."
      : "Supabase Storage respondió con un error. Revisá el detalle técnico que aparece al final.";
  throw new Error(
    `No se pudo subir ${file.name} después de ${maxAttempts} intentos. ${connectionAdvice} El archivo se conserva en el formulario para reintentar. Detalle técnico: ${detail}`
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

async function collectVariants(productId, existingVariants = [], uploadIssues = [], options = {}) {
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
    const requiresConfiguration = categoryUsesRamStorage($("#product-category")?.value || "");

    const rows = Array.from(group.querySelectorAll("[data-variant-row]"));
    // Empty rows/groups are placeholders, not configured variants.
    const rowsWithColor = rows.filter(row => Boolean(row.querySelector("[data-variant-color]")?.value.trim()));
    if (!hasConfiguration && !rowsWithColor.length) continue;

    // Storage identifies the purchasable configuration; RAM is optional because some
    // manufacturers (notably Apple) do not officially specify it for every device.
    if (requiresConfiguration && !options.allowIncomplete && !storageRaw) {
      throw new Error(`Indicá el almacenamiento en la configuración ${groupIndex + 1}.`);
    }
    if (hasConfiguration && !rowsWithColor.length && !options.allowIncomplete) {
      throw new Error("Añadí al menos un color a la configuración " + (groupIndex + 1) + ".");
    }
    if (options.allowIncomplete && !rowsWithColor.length) continue;
    if (hasConfiguration && seenConfigurations.has(key)) {
      throw new Error("Hay una configuración repetida de almacenamiento y RAM.");
    }
    if (hasConfiguration) seenConfigurations.add(key);

    const colors = [];

    for (let colorIndex = 0; colorIndex < rowsWithColor.length; colorIndex++) {
      const row = rowsWithColor[colorIndex];
      const color = row.querySelector("[data-variant-color]")?.value.trim() || "";
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
          if (options.skipPendingUploads) {
            uploadIssues.push(color + ": " + (item.uploadError || "Fotografía pendiente de subir"));
            continue;
          }
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

    if (hasConfiguration && !colors.length && !options.allowIncomplete) {
      throw new Error("Añadí al menos un color a la configuración " + (groupIndex + 1) + ".");
    }
    const seenColors = new Set();
    colors.forEach(item => {
      const key = item.color.toLocaleLowerCase("es");
      if (seenColors.has(key)) throw new Error(`El color "${item.color}" está repetido dentro de una misma configuración.`);
      seenColors.add(key);
    });

    configs.push({
      storage, ram,
      price_usd: toOptionalNumber(read("[data-group-price-usd]"), `Precio en dólares de configuración ${groupIndex + 1}`),
      price_nio: toOptionalNumber(read("[data-group-price-nio]"), `Precio en córdobas de configuración ${groupIndex + 1}`),
      configuration_availability: normalizeVariantAvailability(read("[data-group-availability]")),
      colors, isBase
    });
  }

  if (categoryUsesRamStorage($("#product-category")?.value || "") && !options.allowIncomplete && !configs.length) {
    throw new Error("Agregá al menos una variante con almacenamiento y color antes de publicar.");
  }

  return configs.flatMap(config => config.colors.map(color => ({
    storage: config.storage,
    ram: config.ram,
    color: color.color,
    color_hex: color.color_hex,
    price_usd: config.price_usd,
    price_nio: config.price_nio,
    configuration_availability: config.configuration_availability,
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
   REVISIÓN PREVIA A PUBLICAR Y VALIDACIÓN DE FOTOGRAFÍAS
   ========================================================= */
const publishReviewDialog = $("#publish-review-dialog");
let currentPublishReview = null;
let currentFormPhotoIssues = [];

function imageLoadsAndDecodes(source) {
  return new Promise(resolve => {
    if (!source) { resolve(false); return; }
    const image = new Image();
    let settled = false;
    let timeout;
    const finish = ok => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(Boolean(ok));
    };
    timeout = window.setTimeout(() => finish(false), 12000);
    const verifyDecoded = () => {
      const decoded = typeof image.decode === "function" ? image.decode() : Promise.resolve();
      Promise.resolve(decoded).then(() => finish(image.naturalWidth > 0 && image.naturalHeight > 0)).catch(() => finish(false));
    };
    image.onload = verifyDecoded;
    image.onerror = () => finish(false);
    image.src = source;
    if (image.complete) {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) verifyDecoded();
      else finish(false);
    }
  });
}
function reviewCurrency(value, currency) {
  if (value === "" || value === null || value === undefined || !Number.isFinite(Number(value))) return "Sin precio";
  return currency + " " + Number(value).toLocaleString("es-NI", { maximumFractionDigits: 2 });
}
function formatReviewConfig(group) {
  const storageRaw = group.querySelector("[data-group-storage]")?.value.trim() || "";
  const ramRaw = group.querySelector("[data-group-ram]")?.value.trim() || "";
  const storageUnit = group.querySelector("[data-group-storage-unit]")?.value || "GB";
  const storage = storageRaw ? formatStorageLabel(storageRaw, storageUnit) : "";
  const ram = ramRaw ? ramRaw + " GB RAM" : "";
  return [ram, storage].filter(Boolean).join(" / ") || "Configuración base";
}
function makePhotoReviewIssue(source, row, item, label, reason) {
  return { source: source, row: row || null, itemId: item?.id || "", item: item || null, label: label, reason: reason || "", isMissing: false };
}
function addPriceWarning(warnings, value, currency, label) {
  if (value === "" || value === null || value === undefined) return;
  const number = Number(value);
  if (!Number.isFinite(number)) return;
  if (number <= 0) warnings.push(label + ": el precio es " + reviewCurrency(number, currency) + ". Confirmá que el valor sea intencional.");
  if (currency === "US$" && number > 5000) warnings.push(label + ": " + reviewCurrency(number, currency) + " es un importe alto. Revisá que no se haya agregado un dígito por error.");
  if (currency === "C$" && number > 250000) warnings.push(label + ": " + reviewCurrency(number, currency) + " es un importe alto. Revisá que no se haya agregado un dígito por error.");
  if (currency === "US$" && number > 0 && number < 1) warnings.push(label + ": el precio en dólares es menor de US$ 1. Confirmá el importe.");
  if (currency === "C$" && number > 0 && number < 20) warnings.push(label + ": el precio en córdobas es menor de C$ 20. Confirmá el importe.");
}
function addCurrencyPairWarning(warnings, usd, nio, label) {
  const us = Number(usd), cs = Number(nio);
  if (usd === "" || nio === "" || !Number.isFinite(us) || !Number.isFinite(cs) || us <= 0 || cs <= 0) return;
  const ratio = cs / us;
  if (ratio < 15 || ratio > 60) warnings.push(label + ": los importes " + reviewCurrency(us, "US$") + " y " + reviewCurrency(cs, "C$") + " parecen no guardar una relación habitual. Revisá ambos valores antes de publicar.");
}

function addPriceSpreadWarning(warnings, samples, currency) {
  const valid = samples.filter(item => Number.isFinite(item.value) && item.value > 0);
  if (valid.length < 2) return;
  const sorted = [...valid].sort((a, b) => a.value - b.value);
  const low = sorted[0], high = sorted[sorted.length - 1];
  if (high.value / low.value >= 3.5) {
    warnings.push("Los precios de las configuraciones en " + currency + " van desde " +
      reviewCurrency(low.value, currency) + " (" + low.label + ") hasta " +
      reviewCurrency(high.value, currency) + " (" + high.label +
      "). La diferencia es amplia: revisá que no se haya agregado o perdido un dígito. Puede ser válida por capacidad o versión; podés confirmarla.");
  }
}

async function buildPublishReview() {
  const name = $("#product-name")?.value.trim() || "";
  const brand = $("#product-brand")?.value.trim() || "";
  const isPerfume = activeCatalogType === "perfumery";
  const family = isPerfume ? perfumeFamilyLabel($("#product-perfume-family")?.value) : ($("#product-category")?.value || "Sin categoría");
  const subcategory = isPerfume ? "" : getSelectedProductSubcategory();
  const tags = selectedProductTags();
  const warnings = [], missingPhotos = [], candidates = [], variantSummary = [];
  const priceSamples = { usd: [], nio: [] };
  mainImageItems.forEach((item, index) => {
    const source = item.kind === "new" ? (item.previewUrl || "") : (item.url || "");
    const label = "Fotografía general " + (index + 1) + (item.name ? " · " + item.name : "");
    candidates.push({ source: "main", row: null, item: item, src: source, label: label });
  });
  if (isPerfume) {
    const usd = $("#product-price-usd")?.value.trim() || "";
    const nio = $("#product-price-nio")?.value.trim() || "";
    addPriceWarning(warnings, usd, "US$", "Precio base en dólares");
    addPriceWarning(warnings, nio, "C$", "Precio base en córdobas");
    addCurrencyPairWarning(warnings, usd, nio, "Precio base");
    variantSummary.push("Familia: " + family);
    variantSummary.push("Tipo: " + ($("#product-type")?.value === "set" ? "Set de perfumes" : "Perfume / fragancia"));
    variantSummary.push("Concentración: " + ($("#product-perfume-concentration")?.value || "No especificada"));
    variantSummary.push("Contenido: " + ($("#product-perfume-volume")?.value ? $("#product-perfume-volume").value + " ml" : "No especificado"));
    variantSummary.push("Público: " + ($("#product-perfume-audience")?.value || "No especificado"));
    variantSummary.push("Precio: " + reviewCurrency(usd, "US$") + " · " + reviewCurrency(nio, "C$"));
  } else {
    const groups = Array.from(form?.querySelectorAll("[data-variant-group]") || []);
    groups.forEach(group => {
      const configLabel = formatReviewConfig(group);
      const usd = group.querySelector("[data-group-price-usd]")?.value.trim() || "";
      const nio = group.querySelector("[data-group-price-nio]")?.value.trim() || "";
      if (usd !== "" && Number(usd) > 0 && Number.isFinite(Number(usd))) priceSamples.usd.push({ value: Number(usd), label: configLabel });
      if (nio !== "" && Number(nio) > 0 && Number.isFinite(Number(nio))) priceSamples.nio.push({ value: Number(nio), label: configLabel });
      const rows = Array.from(group.querySelectorAll("[data-variant-row]"));
      addPriceWarning(warnings, usd, "US$", configLabel + " · precio");
      addPriceWarning(warnings, nio, "C$", configLabel + " · precio");
      addCurrencyPairWarning(warnings, usd, nio, configLabel);
      rows.forEach(row => {
        const color = row.querySelector("[data-variant-color]")?.value.trim() || "Color sin nombre";
        initVariantImageItems(row);
        const items = row._variantImageItems || [];
        const colorLabel = "Color " + color + (configLabel === "Configuración base" ? "" : " · " + configLabel);
        if (!items.length) missingPhotos.push({ source: "variant", row: row, itemId: "", label: colorLabel + " · sin fotografía", isMissing: true });
        items.forEach((item, itemIndex) => {
          const source = item.kind === "new" ? (item.previewUrl || "") : (item.url || "");
          candidates.push({ source: "variant", row: row, item: item, src: source, label: colorLabel + " · foto " + (itemIndex + 1) + (item.name ? " · " + item.name : "") });
        });
      });
      const colors = rows.map(row => {
        const color = row.querySelector("[data-variant-color]")?.value.trim() || "Color sin nombre";
        initVariantImageItems(row);
        const photos = (row._variantImageItems || []).length;
        return color + " (" + photos + (photos === 1 ? " foto" : " fotos") + ")";
      });
      variantSummary.push(configLabel + ": " + (colors.length ? colors.join(", ") : "sin colores") + " · " + reviewCurrency(usd, "US$") + " · " + reviewCurrency(nio, "C$"));
    });
    if (!variantSummary.length) variantSummary.push("No hay configuraciones por color añadidas.");
    addPriceSpreadWarning(warnings, priceSamples.usd, "US$");
    addPriceSpreadWarning(warnings, priceSamples.nio, "C$");
  }
  if (!mainImageItems.length) warnings.push("No hay fotografía general del producto; confirmá que querés continuar sin una portada.");
  const checked = await Promise.all(candidates.map(async candidate => ({ candidate: candidate, valid: await imageLoadsAndDecodes(candidate.src) })));
  const blockingIssues = checked.filter(result => !result.valid).map(result =>
    makePhotoReviewIssue(result.candidate.source, result.candidate.row, result.candidate.item, result.candidate.label,
      result.candidate.src ? "No se pudo cargar o decodificar esta imagen." : "No hay un archivo o una URL de imagen válidos asociados a este elemento.")
  );
  const savedCount = mainImageItems.filter(item => item.kind === "existing" && item.url).length;
  const pendingCount = mainImageItems.filter(item => item.kind === "new").length;
  const mainImageStatus = mainImageItems.length
    ? mainImageItems.length + " fotografía(s) generales · " + savedCount + " guardada(s) · " + pendingCount + " pendiente(s) de subir"
    : "Sin fotografía general";
  const perfumeNotes = isPerfume ? {
    scentFamily: $("#product-perfume-scent-family")?.value.trim() || "",
    top: $("#product-perfume-top-notes")?.value.trim() || "",
    heart: $("#product-perfume-heart-notes")?.value.trim() || "",
    base: $("#product-perfume-base-notes")?.value.trim() || ""
  } : null;
  return { name: name, brand: brand, family: family, subcategory: subcategory, tags: tags, isPerfume: isPerfume,
    variants: variantSummary, mainImageStatus: mainImageStatus, perfumeNotes: perfumeNotes,
    warnings: [...new Set(warnings)], missingPhotos: missingPhotos, blockingIssues: blockingIssues };
}
function renderPublishReview(review) {
  const perfumeNoteEntries = review.perfumeNotes ? [
    ["Familia olfativa específica", review.perfumeNotes.scentFamily],
    ["Salida", review.perfumeNotes.top],
    ["Corazón", review.perfumeNotes.heart],
    ["Fondo", review.perfumeNotes.base]
  ].filter(([, value]) => String(value || "").trim()) : null;
  const perfumeNotesMarkup = perfumeNoteEntries
    ? '<div class="publish-review-row publish-review-notes-row"><span>Notas olfativas</span><div class="publish-review-notes">' +
      (perfumeNoteEntries.length
        ? perfumeNoteEntries.map(([label, value]) => '<p><strong>' + escapeHtml(label) + ':</strong> ' + escapeHtml(value) + '</p>').join("")
        : '<p class="publish-review-notes-empty">Sin notas olfativas registradas.</p>') +
      '</div></div>'
    : "";
  const reviewTagLabels = {
    exclusive: "Exclusivo", limited_edition: "Edición limitada", high_performance: "Alto rendimiento", quality_price: "Calidad-precio",
    top_gaming: "Top Gaming", best_seller: "Más vendido", new_arrival: "Nuevo ingreso", offer: "Oferta"
  };
  const tagSummary = (Array.isArray(review.tags) ? review.tags : [])
    .map(tag => reviewTagLabels[String(tag || "").toLowerCase()] || String(tag || "").trim())
    .filter(Boolean).join(" · ") || "Sin etiquetas manuales";
  const taxonomyReviewMarkup = (review.isPerfume ? "" :
    '<div class="publish-review-row"><span>Subcategoría</span><strong>' + escapeHtml(review.subcategory || "Sin subcategoría") + '</strong></div>') +
    '<div class="publish-review-row"><span>' + (review.isPerfume ? "Colección" : "Etiquetas manuales") + '</span><strong>' + escapeHtml(tagSummary) + '</strong></div>';
  $("#publish-review-summary").innerHTML =
    '<div class="publish-review-row"><span>Producto</span><strong>' + escapeHtml(review.name || "Sin nombre") + '</strong></div>' +
    '<div class="publish-review-row"><span>Marca</span><strong>' + escapeHtml(review.brand || "Sin marca indicada") + '</strong></div>' +
    '<div class="publish-review-row"><span>Categoría / familia</span><strong>' + escapeHtml(review.family) + '</strong></div>' +
    taxonomyReviewMarkup +
    '<div class="publish-review-row"><span>Fotografías generales</span><strong>' + escapeHtml(review.mainImageStatus) + '</strong></div>' +
    '<div class="publish-review-row publish-review-variants"><span>Variantes, colores y precios</span><div>' +
    review.variants.map(item => '<p>' + escapeHtml(item) + '</p>').join("") + '</div></div>' +
    perfumeNotesMarkup;
  $("#publish-review-warnings-section").hidden = !review.warnings.length;
  $("#publish-review-warnings").innerHTML = review.warnings.map(item => '<li>' + escapeHtml(item) + '</li>').join("");
  $("#publish-review-issues-section").hidden = !review.blockingIssues.length;
  $("#publish-review-issues").innerHTML = review.blockingIssues.map((issue, index) =>
    '<button type="button" class="publish-review-issue" data-publish-review-issue="' + index + '"><strong>' + escapeHtml(issue.label) + '</strong><span>' + escapeHtml(issue.reason) + '</span><small>Abrir este campo</small></button>').join("");
  $("#publish-review-missing-section").hidden = !review.missingPhotos.length;
  $("#publish-review-missing").innerHTML = review.missingPhotos.map((issue, index) =>
    '<button type="button" class="publish-review-issue" data-publish-missing-issue="' + index + '"><strong>' + escapeHtml(issue.label) + '</strong><small>Abrir este color para agregar una foto</small></button>').join("");
  $("#publish-review-intro").textContent = review.blockingIssues.length
    ? "Encontré fotografías que no se pueden validar. No se publicará la ficha; al continuar, se guardará en Borradores para que corrijás las imágenes."
    : review.missingPhotos.length
      ? "Revisá los datos y confirmá expresamente si querés publicar sin fotografía en los colores señalados."
      : "Comprobá nombre, variantes, precios y fotografías. La publicación no se hará hasta que confirmés.";
  const confirmButton = $("#publish-review-confirm");
  confirmButton.textContent = review.blockingIssues.length
    ? "Guardar en Borradores y corregir fotos"
    : review.missingPhotos.length ? "Confirmar y publicar sin estas fotos" : "Confirmar y publicar";
  confirmButton.classList.toggle("publish-review-confirm-draft", Boolean(review.blockingIssues.length));
}
async function openPublishReview() {
  const publishButton = $("#publish-product-button");
  if (!publishReviewDialog || !publishButton) {
    message("#product-form-status", "No se pudo abrir la revisión previa. No se publicó el producto.", "error");
    return;
  }
  if (publishButton.dataset.reviewLoading === "true") return;
  publishButton.dataset.reviewLoading = "true";
  publishButton.disabled = true;
  let handingOffToDraftSave = false;
  try {
    $("#publish-review-intro").textContent = "Comprobando que las fotografías realmente carguen y se puedan decodificar…";
    currentPublishReview = await buildPublishReview();

    // Una imagen que no carga o no se puede decodificar bloquea la publicación.
    // Guardamos primero la ficha en Borradores y luego llevamos al usuario al error
    // exacto, conservando todos los demás datos del formulario.
    if (currentPublishReview.blockingIssues.length && form && currentUser && supabase) {
      form.dataset.forceDraftOnPhotoIssue = "true";
      form.dataset.publishConfirmed = "true";
      handingOffToDraftSave = true;
      delete publishButton.dataset.reviewLoading;
      message(
        "#product-form-status",
        "Detecté una fotografía que no se puede cargar o decodificar. La ficha se guardará en Borradores y te llevaré directamente al campo que necesita corrección."
      );
      form.requestSubmit(publishButton);
      return;
    }

    renderPublishReview(currentPublishReview);
    if (!publishReviewDialog.open) publishReviewDialog.showModal();
  } catch (error) {
    message("#product-form-status", "No se pudo completar la revisión previa: " + (error.message || "error desconocido") + ". No se publicó el producto.", "error");
  } finally {
    if (!handingOffToDraftSave) {
      publishButton.disabled = false;
      delete publishButton.dataset.reviewLoading;
    }
  }
}
function clearPhotoIssueHighlights() {
  form?.querySelectorAll(".photo-validation-error").forEach(node => node.classList.remove("photo-validation-error"));
}
function renderFormPhotoIssues(issues) {
  currentFormPhotoIssues = issues || [];
  const node = $("#product-photo-validation-issues");
  if (!node) return;
  if (!currentFormPhotoIssues.length) { node.hidden = true; node.replaceChildren(); return; }
  node.hidden = false;
  node.innerHTML = '<strong>Fotografías para corregir</strong><p>La ficha se guardó como borrador. Tocá un aviso para ir directamente al color o fotografía correspondiente.</p>' +
    currentFormPhotoIssues.map((issue, index) => '<button type="button" data-form-photo-issue="' + index + '">' + escapeHtml(issue.label) + ' <span>Ir al campo ↗</span></button>').join("");
}
function navigateToPhotoIssue(issue) {
  if (!issue) return;
  if (publishReviewDialog?.open) publishReviewDialog.close();
  showAdminSection("add");
  clearPhotoIssueHighlights();
  if (!currentFormPhotoIssues.length) renderFormPhotoIssues([issue]);
  let target = null;
  if (issue.source === "main") {
    target = issue.itemId && mainImagesPreview ? mainImagesPreview.querySelector('[data-image-item-id="' + CSS.escape(issue.itemId) + '"]') : null;
    target = target || $("#product-images-preview") || $("#product-images");
  } else {
    const row = issue.row || null;
    target = row;
    if (row && issue.itemId) target = row.querySelector('[data-variant-image-id="' + CSS.escape(issue.itemId) + '"]') || row;
    target = target || $("#technology-variants-section") || $("#product-variants-list");
  }
  target?.classList.add("photo-validation-error");
  if (issue.row) issue.row.classList.add("photo-validation-error");
  window.setTimeout(() => {
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    const focusTarget = target?.querySelector("[data-variant-image], [data-variant-color], [data-main-image-remove]") || target;
    if (focusTarget && typeof focusTarget.focus === "function") focusTarget.focus({ preventScroll: true });
  }, 80);
}
publishReviewDialog?.addEventListener("click", event => {
  const invalid = event.target.closest("[data-publish-review-issue]");
  if (invalid && currentPublishReview) {
    const issue = currentPublishReview.blockingIssues[Number(invalid.dataset.publishReviewIssue)];
    currentFormPhotoIssues = [...currentPublishReview.blockingIssues, ...currentPublishReview.missingPhotos];
    renderFormPhotoIssues(currentFormPhotoIssues);
    navigateToPhotoIssue(issue);
    return;
  }
  const missing = event.target.closest("[data-publish-missing-issue]");
  if (missing && currentPublishReview) {
    const issue = currentPublishReview.missingPhotos[Number(missing.dataset.publishMissingIssue)];
    currentFormPhotoIssues = [...currentPublishReview.blockingIssues, ...currentPublishReview.missingPhotos];
    renderFormPhotoIssues(currentFormPhotoIssues);
    message("#product-form-status", "El color señalado no tiene fotografía. Agregá una imagen o volvé a la revisión para confirmar que publicarás sin ella.", "error");
    navigateToPhotoIssue(issue);
  }
});
$("#publish-review-cancel")?.addEventListener("click", () => publishReviewDialog?.close());
$("#publish-review-close")?.addEventListener("click", () => publishReviewDialog?.close());
$("#publish-review-confirm")?.addEventListener("click", () => {
  if (!currentPublishReview || !form) return;
  form.dataset.forceDraftOnPhotoIssue = currentPublishReview.blockingIssues.length ? "true" : "false";
  form.dataset.publishConfirmed = "true";
  publishReviewDialog?.close();
  form.requestSubmit($("#publish-product-button"));
});
form?.addEventListener("click", event => {
  const issueButton = event.target.closest("[data-form-photo-issue]");
  if (issueButton) navigateToPhotoIssue(currentFormPhotoIssues[Number(issueButton.dataset.formPhotoIssue)]);
});
form?.addEventListener("change", event => {
  if (event.target.matches("[data-variant-image], #product-images")) {
    clearPhotoIssueHighlights();
    renderFormPhotoIssues([]);
  }
});

async function validateTrackedRemotePhotos() {
  const candidates = [];
  mainImageItems.forEach(item => {
    if (item.kind === "existing" && item.url) {
      candidates.push({ source: "main", row: null, item: item, src: item.url,
        label: "Fotografía general" + (item.name ? " · " + item.name : "") });
    }
  });
  if (activeCatalogType === "technology") {
    form?.querySelectorAll("[data-variant-row]").forEach(row => {
      const color = row.querySelector("[data-variant-color]")?.value.trim() || "sin nombre";
      const group = row.closest("[data-variant-group]");
      const config = group ? formatReviewConfig(group) : "";
      initVariantImageItems(row);
      (row._variantImageItems || []).forEach((item, index) => {
        if (item.kind !== "existing" || !item.url) return;
        candidates.push({
          source: "variant", row: row, item: item, src: item.url,
          label: "No se pudo validar la fotografía del color " + color +
            (config && config !== "Configuración base" ? " · " + config : "") +
            " · foto " + (index + 1)
        });
      });
    });
  }
  const checked = await Promise.all(candidates.map(async candidate => ({
    candidate: candidate, valid: await imageLoadsAndDecodes(candidate.src)
  })));
  return checked.filter(result => !result.valid).map(result => makePhotoReviewIssue(
    result.candidate.source,
    result.candidate.row,
    result.candidate.item,
    result.candidate.label,
    "La imagen no se pudo cargar o decodificar después de subirla. Reemplazala antes de publicar."
  ));
}

function uploadPhotoFailureTargets() {
  return getPendingPhotoUploads().filter(entry => entry.item?.file && entry.item.kind === "new").map(entry => {
    const isMain = entry.source === "main";
    const config = entry.row?.closest("[data-variant-group]");
    const configLabel = config ? formatReviewConfig(config) : "";
    const photoName = entry.item.name || entry.item.file?.name || "fotografía";
    return {
      source: entry.source, row: entry.row || null, itemId: entry.item.id || "", item: entry.item,
      label: isMain ? "No se pudo completar la subida de la fotografía general: " + photoName :
        "No se pudo subir la fotografía del color " + (entry.color || "sin nombre") +
        (configLabel && configLabel !== "Configuración base" ? " · " + configLabel : "") + " · " + photoName,
      reason: entry.item.uploadError || "La imagen permanece pendiente de subir.", isMissing: false
    };
  });
}

/* =========================================================
   NAVEGACIÓN POR SECCIONES DEL FORMULARIO ORIGINAL
   No duplica campos: solo muestra una sección cada vez.
   ========================================================= */
let currentProductFormStep = 1;
const productFormStepTabs = Array.from(document.querySelectorAll("[data-product-form-step]"));
const productFormStepPanels = Array.from(form?.querySelectorAll("[data-product-form-panel]") || []);

function setProductFormStep(step, options = {}) {
  let target = Math.max(1, Math.min(3, Number(step) || 1));
  if (activeCatalogType === "perfumery" && target === 2) target = 3;
  currentProductFormStep = target;

  productFormStepTabs.forEach(button => {
    const selected = Number(button.dataset.productFormStep) === target;
    button.classList.toggle("is-active", selected);
    if (selected) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  });

  productFormStepPanels.forEach(panel => {
    panel.classList.toggle("hidden", Number(panel.dataset.productFormPanel) !== target);
  });

  if (options.scroll !== false) {
    document.querySelector(".product-form-section-nav")?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }
}

function syncProductFormSectionAvailability() {
  const isPerfume = activeCatalogType === "perfumery";
  const variantsTab = document.querySelector('[data-product-form-step="2"]');
  const variantsPanel = form?.querySelector('[data-product-form-panel="2"]');
  const photosTab = document.querySelector('[data-product-form-step="3"]');
  const photosPanel = form?.querySelector('[data-product-form-panel="3"]');
  const firstNext = form?.querySelector('[data-product-form-panel="1"] [data-product-form-next]');
  const photosPrevious = form?.querySelector('[data-product-form-panel="3"] [data-product-form-prev]');

  variantsTab?.classList.toggle("hidden", isPerfume);
  variantsPanel?.classList.toggle("hidden", isPerfume);

  const setNumber = (node, value) => {
    if (node) node.textContent = String(value);
  };
  setNumber(variantsTab?.querySelector(".product-form-section-number"), 2);
  setNumber(variantsPanel?.querySelector(".product-form-section-heading .product-form-section-number"), 2);
  setNumber(photosTab?.querySelector(".product-form-section-number"), isPerfume ? 2 : 3);
  setNumber(photosPanel?.querySelector(".product-form-section-heading .product-form-section-number"), isPerfume ? 2 : 3);

  if (firstNext) {
    firstNext.dataset.productFormNext = isPerfume ? "3" : "2";
    firstNext.textContent = isPerfume ? "Continuar: fotografías →" : "Continuar: variantes →";
    const counter = firstNext.parentElement?.querySelector("span");
    if (counter) counter.textContent = isPerfume ? "Sección 1 de 2" : "Sección 1 de 3";
  }
  if (photosPrevious) {
    photosPrevious.dataset.productFormPrev = isPerfume ? "1" : "2";
    photosPrevious.textContent = isPerfume ? "← Volver a datos" : "← Volver a variantes";
  }

  if (isPerfume && currentProductFormStep === 2) setProductFormStep(1, { scroll: false });
}

form?.addEventListener("click", event => {
  const tab = event.target.closest("[data-product-form-step]");
  if (tab) {
    setProductFormStep(tab.dataset.productFormStep);
    return;
  }
  const next = event.target.closest("[data-product-form-next]");
  if (next) {
    setProductFormStep(next.dataset.productFormNext);
    return;
  }
  const previous = event.target.closest("[data-product-form-prev]");
  if (previous) setProductFormStep(previous.dataset.productFormPrev);
});

$("#product-category")?.addEventListener("change", () => {
  updateCategoryVariantVisibility();
  updateProductSubcategorySuggestions();
});
$("#product-subcategory")?.addEventListener("change", () => {
  const customInput = $("#product-subcategory-custom");
  if (!customInput) return;
  const isCustom = $("#product-subcategory").value === CUSTOM_PRODUCT_SUBCATEGORY_VALUE;
  customInput.hidden = !isCustom;
  if (isCustom) customInput.focus();
});
$("#new-product-button")?.addEventListener("click", () => setProductFormStep(1, { scroll: false }));
$("#cancel-edit-button")?.addEventListener("click", () => setProductFormStep(1, { scroll: false }));
syncProductFormSectionAvailability();
updateCategoryVariantVisibility();
setProductFormStep(1, { scroll: false });

/* =========================================================
   GUARDAR PRODUCTOS
   ========================================================= */

let productSaveInProgress = false;
form?.addEventListener("click", event => {
  const saveActionButton = event.target.closest("button[data-save-action]");
  if (saveActionButton) form.dataset.lastSaveAction = saveActionButton.dataset.saveAction || "unpublished";
});
form?.setAttribute("novalidate","novalidate");
form?.addEventListener("submit", async event => {
  event.preventDefault();
  if (IS_READ_ONLY_PREVIEW) {
    message("#product-form-status", "Vista previa segura de Vercel: los cambios no se guardan. Usá esta vista para probar el importador sin modificar producción.", "error");
    return;
  }
  if (productSaveInProgress) return;
  const saveAction=event.submitter?.dataset?.saveAction||form.dataset.lastSaveAction||"unpublished";
  form.dataset.lastSaveAction = "";
  let targetStatus=saveAction==="draft"?"draft":saveAction==="published"?"published":"unpublished";
  const forceDraftFromPhotoIssue = form.dataset.forceDraftOnPhotoIssue === "true";
  form.dataset.forceDraftOnPhotoIssue = "";
  const preflightPhotoIssues = forceDraftFromPhotoIssue ? (currentPublishReview?.blockingIssues || []) : [];
  if (forceDraftFromPhotoIssue) targetStatus = "draft";
  if (targetStatus === "published" && form.dataset.publishConfirmed !== "true") {
    await openPublishReview();
    return;
  }
  form.dataset.publishConfirmed = "";

  if (!currentUser || !supabase) {
    message("#product-form-status", "Tu sesión administrativa no está activa. Volvé a iniciar sesión.", "error");
    return;
  }

  productSaveInProgress = true;
  const button = event.submitter || $("#save-product-button");
  const submitButtons = Array.from(form.querySelectorAll('button[type="submit"]'));
  submitButtons.forEach(item => { item.disabled = true; item.setAttribute("aria-busy", "true"); });
  const wasEditing = Boolean(editorRecordExists && $("#product-id").value);
  const imageUploadErrors = [];
  let postUploadPhotoIssues = [];
  const isPerfume = activeCatalogType === "perfumery";

  try {
    const name = $("#product-name").value.trim();
    const draftVariantContent = Array.from(form.querySelectorAll("[data-variant-group]")).some(group => {
      const groupValues = Boolean(group.querySelector("[data-group-storage]")?.value.trim() || group.querySelector("[data-group-ram]")?.value.trim() || group.querySelector("[data-group-price-usd]")?.value.trim() || group.querySelector("[data-group-price-nio]")?.value.trim());
      const rowValues = Array.from(group.querySelectorAll("[data-variant-row]")).some(row => {
        const color = row.querySelector("[data-variant-color]")?.value.trim() || "";
        const hex = row.querySelector("[data-variant-hex]")?.value.trim() || "";
        const imageUrl = row.querySelector("[data-variant-image-url]")?.value.trim() || "";
        return Boolean(color || (hex && hex !== "#242424") || imageUrl);
      });
      return groupValues || rowValues;
    });
    const draftHasContent = Boolean(name || $("#product-brand").value.trim() || $("#product-description").value.trim() || $("#product-price-usd").value.trim() || $("#product-price-nio").value.trim() || $("#product-perfume-family").value || $("#product-perfume-scent-family").value.trim() || $("#product-perfume-top-notes").value.trim() || $("#product-perfume-heart-notes").value.trim() || $("#product-perfume-base-notes").value.trim() || $("#product-specs").value.trim() || mainImageItems.length || draftVariantContent);
    if (!name) throw new Error("Escribí el nombre del producto.");
    if (targetStatus === "published") {
      if (!isPerfume && !$("#product-category").value) throw new Error("Seleccioná la categoría del producto antes de publicar.");
      if (!$("#product-availability").value) throw new Error("Seleccioná la disponibilidad antes de publicar.");
      if (isPerfume && !$("#product-perfume-family").value) throw new Error("Seleccioná la familia del perfume antes de publicar.");
    }

    const rawVolume = $("#product-perfume-volume").value.trim();
    const perfumeVolume = isPerfume && rawVolume ? toOptionalNumber(rawVolume, "Contenido en ml") : null;
    if (targetStatus === "published" && isPerfume && perfumeVolume !== null && perfumeVolume <= 0) throw new Error("El contenido en ml debe ser mayor que cero.");

    const id = $("#product-id").value || crypto.randomUUID();
    const existingProduct = products.find(product => String(product.id) === String(id));
    if (wasEditing && existingProduct && normalizeCatalogType(existingProduct.catalog_type) !== activeCatalogType) {
      throw new Error("El catálogo del producto no coincide con el catálogo activo. Cancelá y volvé a abrir el producto desde su catálogo.");
    }

    const catalogKey = $("#catalog-key").value.trim() || ((slugify(name) || "borrador") + "-" + id.slice(0, 8));
    const pendingPhotosBeforeSave = getPendingPhotoUploads();
    if(pendingPhotosBeforeSave.length){
      message("#product-form-status","Subiendo "+pendingPhotosBeforeSave.length+" fotografía(s) pendiente(s) en segundo plano antes de guardar…");
      await uploadPendingPhotosInBackground({retryFailed:true});
    }
    const variants = isPerfume ? [] : await collectVariants(id, existingProduct?.variants || [], imageUploadErrors, {skipPendingUploads:true, allowIncomplete: targetStatus !== "published"});

    const uploadedMainImages = [];
    for (const item of mainImageItems) {
      if (item.kind === "new") imageUploadErrors.push((item.name || item.file?.name || "Fotografía principal") + ": " + (item.uploadError || "No se pudo completar la subida en segundo plano."));
      else if (item.url) uploadedMainImages.push(item.url);
    }
    renderMainImagePreviews();
    postUploadPhotoIssues = await validateTrackedRemotePhotos();
    postUploadPhotoIssues.forEach(issue => imageUploadErrors.push(issue.label + ": " + issue.reason));

    if (imageUploadErrors.length || preflightPhotoIssues.length) {
      // A product with a failed photo must be saved as a draft, never published.
      targetStatus = "draft";
    }

    const colors = isPerfume ? [] : deriveColorsFromVariants(variants, existingProduct?.colors || []);
    const baseUSD = isPerfume ? toOptionalNumber($("#product-price-usd").value, "Precio base en dólares") : null;
    const baseNIO = isPerfume ? toOptionalNumber($("#product-price-nio").value, "Precio base en córdobas") : null;
    const warranty = isPerfume ? null : toOptionalNumber($("#product-warranty").value, "Garantía");
    const priceUSD = isPerfume
      ? baseUSD
      : (minimumPrice(variants, "price_usd") ?? (existingProduct?.price_usd ?? null));
    const priceNIO = isPerfume
      ? baseNIO
      : (minimumPrice(variants, "price_nio") ?? (existingProduct?.price_nio ?? null));
    const allImages = [...new Set(uploadedMainImages)];
    const now = new Date().toISOString();

    const payload = {
      catalog_key: catalogKey,
      catalog_type: activeCatalogType,
      sort_order: wasEditing ? Number(existingProduct?.sort_order ?? getActiveCatalogProducts().length) : getActiveCatalogProducts().length,
      name: name || null,
      brand: $("#product-brand").value.trim() || null,
      model: isPerfume ? null : ($("#product-model").value.trim() || null),
      category: isPerfume ? "Perfumería" : ($("#product-category").value.trim() || null),
      subcategory: isPerfume ? (existingProduct?.subcategory ?? null) : (getSelectedProductSubcategory() || null),
      tags: selectedProductTags(),
      availability: normalizeProductAvailability($("#product-availability").value),
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
        ""
      ),
      shipping_note: $("#product-shipping").value.trim() || null,
      featured: !isPerfume && Boolean($("#product-featured").checked || $("#product-exclusive").checked || $("#product-tag-exclusive").checked),
      is_exclusive: !isPerfume && Boolean($("#product-featured").checked || $("#product-exclusive").checked || $("#product-tag-exclusive").checked),
      product_type: isPerfume ? ($("#product-type").value === "set" ? "set" : "perfume") : "standard",
      workflow_status: targetStatus,
      deleted_at: null,
      deleted_from_status: null,
      is_published: targetStatus === "published",
      updated_at: now,
      updated_by: currentUser.id
    };

    const result = wasEditing
      ? await supabase.from("products").update(payload).eq("id", id)
      : await supabase.from("products").insert({ ...payload, id, created_at: now });

    if (result.error) throw result.error;

    // Keep the generated ID in the form before writing the detail table:
    // if detail save fails, a retry updates this product instead of duplicating it.
    $("#product-id").value = id;
    $("#catalog-key").value = catalogKey;
    editorRecordExists=true;
    mainImageSyncPending=false;
    variantImageSyncPending=false;
    updateMainImageRetryButton();

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
        updated_at: now
      };
      const detailResult = await supabase.from("perfume_details").upsert(perfumePayload, { onConflict: "product_id" });
      if (detailResult.error) {
        message("#product-form-status", "El producto base se guardó, pero no se guardaron los detalles de perfumería: " + detailResult.error.message + ". La ficha quedó abierta; corregí el problema y pulsá Guardar cambios.", "error");
        setStatus("Faltan guardar los detalles de la fragancia: " + name, "error");
        await loadProducts();
        return;
      }
    }

    if (imageUploadErrors.length || preflightPhotoIssues.length) {
      $("#form-title").textContent = isPerfume ? "Fragancia guardada como borrador · fotos para corregir" : "Producto guardado como borrador · fotos para corregir";
      const issuesFromUploads = uploadPhotoFailureTargets();
      const fallbackIssues = imageUploadErrors.map(label => ({
        source: "main", row: null, itemId: "", label: label, reason: label, isMissing: false
      }));
      const allIssues = [];
      const seenIssueKeys = new Set();
      [...preflightPhotoIssues, ...postUploadPhotoIssues, ...(currentPublishReview?.missingPhotos || []), ...issuesFromUploads].forEach(issue => {
        if (!issue) return;
        const key = (issue.source || "") + "|" + (issue.itemId || issue.label || "");
        if (seenIssueKeys.has(key)) return;
        seenIssueKeys.add(key);
        allIssues.push(issue);
      });
      if (!allIssues.length) allIssues.push(...fallbackIssues);
      await saveLocalRecoveryDraft().catch(error => console.warn("No se pudo guardar una recuperación local tras un fallo de foto.", error));
      await loadProducts();
      renderFormPhotoIssues(allIssues);
      message(
        "#product-form-status",
        "La ficha se guardó como Borrador porque una o más fotografías no se pudieron cargar, decodificar o subir. Los demás datos se conservaron. Corregí las fotos señaladas y volvé a revisar antes de publicar.",
        "error"
      );
      setStatus("Ficha guardada como borrador para corregir fotografías: " + name, "error");
      if (allIssues.length) navigateToPhotoIssue(allIssues[0]);
      return;
    } else {
      const statusLabel=targetStatus==="published"?"publicado en el catálogo":targetStatus==="draft"?"guardado como borrador":"guardado sin publicar";
      message("#product-form-status",(isPerfume?"Fragancia ":"Producto ")+statusLabel+".","success");
      setStatus((isPerfume?"Fragancia ":"Producto ")+(name||"sin nombre")+" "+statusLabel+".","success");
      await recoveryAction("readwrite", store => store.delete(RECOVERY_KEY)).catch(error => console.warn("No se pudo limpiar el borrador tras guardar.", error));
      await loadProducts();
      clearEditor();
    }
  } catch (error) {
    message("#product-form-status", error.message || "Ocurrió un error al guardar el producto.", "error");
  } finally {
    productSaveInProgress = false;
    submitButtons.forEach(item => { item.disabled = false; item.removeAttribute("aria-busy"); });
    $("#save-product-button").setAttribute("aria-label", editorRecordExists ? "Guardar cambios sin publicar" : "Guardar producto sin publicar");
    $("#save-product-button").title = editorRecordExists ? "Guardar cambios sin publicar" : "Guardar producto sin publicar";
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
          "",

        shipping_note: product.shipping_note || null,

        images,
        image_url: images[0] || product.image_url || null,

        colors,
        variants,

        featured: false,
        is_exclusive: false,
        product_type: "standard",
        workflow_status: "draft",
        is_published: false
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
      `${payload.length} productos importados como borradores. Revisá variantes, precios y fotografías antes de publicar.`,
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

/* JB Manager · control privado de comisiones. Solo registra la comisión propia, nunca el precio del producto. */
const commissionNode = id => document.getElementById(id);
const commissionForm = commissionNode("commission-form");
const commissionRecordsNode = commissionNode("commission-records");
const commissionStatusLabels = {
  pending_confirmation: "Por confirmar",
  confirmed_pending_payment: "Confirmada · pendiente de recibir",
  received: "Recibida",
  cancelled: "Cancelada"
};
const commissionCatalogLabels = { technology: "JB TECH", perfumery: "JB Parfums" };
let commissionRecords = [];
let commissionLoadToken = 0;

function commissionMoney(amount, currency) {
  if (amount === null || amount === undefined || amount === "" || !Number.isFinite(Number(amount))) return "Por definir";
  return (currency === "USD" ? "US$ " : "C$ ") +
    Number(amount).toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function commissionTotal(rows, states) {
  const totals = { NIO: 0, USD: 0 };
  for (const row of rows) {
    if (!states.includes(row.status) || row.commission_amount == null) continue;
    totals[row.commission_currency === "USD" ? "USD" : "NIO"] += Number(row.commission_amount) || 0;
  }
  const result = [];
  if (totals.NIO) result.push(commissionMoney(totals.NIO, "NIO"));
  if (totals.USD) result.push(commissionMoney(totals.USD, "USD"));
  return result.length ? result.join(" · ") : "C$ 0.00";
}
function visibleCommissionRows() {
  return dashboardCatalogScope === "all"
    ? commissionRecords
    : commissionRecords.filter(row => row.catalog_type === dashboardCatalogScope);
}
function setCommissionMessage(text, state = "") {
  const node = commissionNode("commission-form-status");
  if (node) { node.textContent = text; node.dataset.state = state; }
}
function populateCommissionProducts(selectedId = "") {
  const select = commissionNode("commission-product-select");
  const catalog = commissionNode("commission-catalog");
  if (!select || !catalog) return;
  const options = products.filter(product => normalizeCatalogType(product.catalog_type) === catalog.value);
  select.innerHTML = '<option value="">Sin producto vinculado</option>' + options.map(product =>
    '<option value="' + escapeHtml(String(product.id)) + '">' +
    escapeHtml(product.name || "Producto sin nombre") + '</option>'
  ).join("");
  select.value = selectedId && options.some(product => String(product.id) === String(selectedId)) ? String(selectedId) : "";
}
function renderCommissionSummary(rows) {
  commissionNode("commission-total-confirmed").textContent = commissionTotal(rows, ["confirmed_pending_payment", "received"]);
  commissionNode("commission-total-pending").textContent = commissionTotal(rows, ["confirmed_pending_payment"]);
  commissionNode("commission-total-received").textContent = commissionTotal(rows, ["received"]);
  commissionNode("commission-total-unconfirmed").textContent = rows
    .filter(row => row.status === "pending_confirmation").length.toLocaleString("es-NI");
}
function renderCommissionRecords() {
  const target = commissionRecordsNode;
  if (!target) return;
  const rows = visibleCommissionRows().slice()
    .sort((a, b) => String(b.operation_date || b.created_at || "").localeCompare(String(a.operation_date || a.created_at || "")))
    .slice(0, 20);
  if (!rows.length) {
    target.innerHTML = '<div class="commission-empty-state">Todavía no hay comisiones registradas. Usá «Registrar comisión» cuando tengas una operación que quieras seguir.</div>';
    return;
  }
  target.innerHTML = rows.map(row => {
    const date = row.operation_date ? new Date(row.operation_date + "T12:00:00").toLocaleDateString("es-NI") : "Sin fecha";
    const channel = row.channel === "messenger" ? "Messenger" : row.channel === "other" ? "Otro canal" : "WhatsApp";
    const reference = row.order_reference ? " · Referencia: " + escapeHtml(row.order_reference) : "";
    return '<article class="commission-record-row">' +
      '<div class="commission-record-main"><h5 class="commission-record-title">' + escapeHtml(row.product_name || "Operación sin nombre") + '</h5>' +
      '<div class="commission-record-meta">' + escapeHtml(commissionCatalogLabels[row.catalog_type] || "Catálogo") + ' · ' +
      escapeHtml(row.department || "Departamento sin especificar") + ' · ' + date + ' · ' + channel + reference + '</div>' +
      '<span class="commission-status-pill" data-status="' + escapeHtml(row.status) + '">' + escapeHtml(commissionStatusLabels[row.status] || "Sin estado") + '</span>' +
      (row.notes ? '<div class="commission-record-meta">' + escapeHtml(row.notes) + '</div>' : '') +
      '</div><div class="commission-record-amount">' + escapeHtml(commissionMoney(row.commission_amount, row.commission_currency)) + '</div>' +
      '<div class="commission-record-actions"><button type="button" data-commission-edit="' + escapeHtml(row.id) + '">Editar</button>' +
      '<button type="button" class="is-danger" data-commission-delete="' + escapeHtml(row.id) + '">Eliminar</button></div></article>';
  }).join("");
}
async function loadCommissionDashboard() {
  if (!supabase || !currentUser || !commissionRecordsNode) return;
  const token = ++commissionLoadToken;
  const { data, error } = await supabase.from("commission_records")
    .select("*").order("operation_date", { ascending: false }).limit(200);
  if (token !== commissionLoadToken) return;
  if (error) {
    commissionRecordsNode.innerHTML = '<div class="commission-empty-state">No se pudieron cargar las comisiones. Verificá que esté aplicada la migración <code>20261026194000_commission_tracking_and_visitor_departments.sql</code> en Supabase.</div>';
    ["commission-total-confirmed", "commission-total-pending", "commission-total-received", "commission-total-unconfirmed"]
      .forEach(id => { commissionNode(id).textContent = "—"; });
    console.warn("No se pudieron cargar las comisiones:", error.message);
    return;
  }
  commissionRecords = Array.isArray(data) ? data : [];
  renderCommissionSummary(visibleCommissionRows());
  renderCommissionRecords();
}
function resetCommissionForm() {
  if (!commissionForm) return;
  commissionForm.reset();
  commissionNode("commission-id").value = "";
  commissionNode("commission-catalog").value = dashboardCatalogScope === "perfumery" ? "perfumery" : "technology";
  commissionNode("commission-operation-date").value = new Date().toLocaleDateString("en-CA");
  commissionNode("commission-status").value = "pending_confirmation";
  commissionNode("commission-currency").value = "NIO";
  commissionNode("commission-channel").value = "whatsapp";
  populateCommissionProducts();
  commissionNode("commission-form-summary").textContent = "＋ Registrar comisión";
  commissionNode("commission-save-button").textContent = "Guardar registro";
  commissionNode("commission-cancel-edit").hidden = true;
  commissionNode("commission-editor-details").open = false;
  commissionNode("commission-amount").required = false;
  setCommissionMessage("");
}
function editCommissionRecord(row) {
  if (!row || !commissionForm) return;
  commissionNode("commission-editor-details").open = true;
  commissionNode("commission-id").value = row.id || "";
  commissionNode("commission-catalog").value = row.catalog_type || "technology";
  populateCommissionProducts(row.product_id || "");
  commissionNode("commission-product-name").value = row.product_name || "";
  commissionNode("commission-department").value = row.department || "";
  commissionNode("commission-channel").value = row.channel || "whatsapp";
  commissionNode("commission-amount").value = row.commission_amount ?? "";
  commissionNode("commission-currency").value = row.commission_currency || "NIO";
  commissionNode("commission-status").value = row.status || "pending_confirmation";
  commissionNode("commission-operation-date").value = row.operation_date || new Date().toLocaleDateString("en-CA");
  commissionNode("commission-order-reference").value = row.order_reference || "";
  commissionNode("commission-notes").value = row.notes || "";
  commissionNode("commission-form-summary").textContent = "Editando comisión";
  commissionNode("commission-save-button").textContent = "Guardar cambios";
  commissionNode("commission-cancel-edit").hidden = false;
  commissionNode("commission-amount").required = ["confirmed_pending_payment", "received"].includes(row.status);
  setCommissionMessage("Editando un registro existente.");
  commissionForm.scrollIntoView({ behavior: "smooth", block: "start" });
}
commissionNode("commission-catalog")?.addEventListener("change", () => populateCommissionProducts());
commissionNode("commission-product-select")?.addEventListener("change", event => {
  const product = products.find(item => String(item.id) === String(event.currentTarget.value));
  if (!product) return;
  commissionNode("commission-product-name").value = product.name || "";
  commissionNode("commission-catalog").value = normalizeCatalogType(product.catalog_type);
  populateCommissionProducts(String(product.id));
});
commissionNode("commission-status")?.addEventListener("change", event => {
  commissionNode("commission-amount").required = ["confirmed_pending_payment", "received"].includes(event.currentTarget.value);
});
commissionNode("commission-cancel-edit")?.addEventListener("click", resetCommissionForm);
commissionNode("commission-refresh-button")?.addEventListener("click", () => { void loadCommissionDashboard(); });
commissionForm?.addEventListener("submit", async event => {
  event.preventDefault();
  if (!supabase || !currentUser) { setCommissionMessage("Iniciá sesión para registrar comisiones.", "error"); return; }
  if (!commissionForm.reportValidity()) return;
  const id = commissionNode("commission-id").value.trim();
  const productId = commissionNode("commission-product-select").value || null;
  const product = products.find(item => String(item.id) === String(productId));
  const productName = commissionNode("commission-product-name").value.trim() || product?.name || "";
  const status = commissionNode("commission-status").value;
  const rawAmount = commissionNode("commission-amount").value.trim();
  const amount = rawAmount === "" ? null : Number(rawAmount);
  if (!productName) { setCommissionMessage("Indicá el producto o la referencia de la operación.", "error"); return; }
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) { setCommissionMessage("La comisión debe ser un importe válido y no negativo.", "error"); return; }
  if (["confirmed_pending_payment", "received"].includes(status) && amount === null) {
    setCommissionMessage("Indicá el importe de la comisión para confirmar el registro.", "error"); return;
  }
  const payload = {
    catalog_type: commissionNode("commission-catalog").value,
    product_id: productId,
    product_name: productName,
    department: commissionNode("commission-department").value || null,
    channel: commissionNode("commission-channel").value,
    commission_amount: amount,
    commission_currency: commissionNode("commission-currency").value,
    status,
    operation_date: commissionNode("commission-operation-date").value,
    received_date: status === "received" ? new Date().toLocaleDateString("en-CA") : null,
    order_reference: commissionNode("commission-order-reference").value.trim() || null,
    notes: commissionNode("commission-notes").value.trim() || null,
    updated_at: new Date().toISOString()
  };
  const button = commissionNode("commission-save-button");
  const editing = Boolean(id);
  button.disabled = true;
  button.textContent = "Guardando…";
  try {
    const result = editing
      ? await supabase.from("commission_records").update(payload).eq("id", id)
      : await supabase.from("commission_records").insert({ ...payload, created_by: currentUser.id });
    if (result.error) throw result.error;
    await loadCommissionDashboard();
    resetCommissionForm();
    commissionNode("commission-editor-details").open = true;
    setCommissionMessage("Registro guardado.", "success");
  } catch (error) {
    setCommissionMessage("No se pudo guardar. Verificá la migración y los permisos del administrador.", "error");
    console.warn("Error al guardar comisión:", error.message);
  } finally {
    button.disabled = false;
    button.textContent = editing ? "Guardar cambios" : "Guardar registro";
  }
});
commissionRecordsNode?.addEventListener("click", async event => {
  const target = event.target instanceof Element ? event.target : null;
  const editButton = target?.closest("[data-commission-edit]");
  const deleteButton = target?.closest("[data-commission-delete]");
  if (editButton) {
    const row = commissionRecords.find(item => String(item.id) === String(editButton.dataset.commissionEdit));
    if (row) editCommissionRecord(row);
    return;
  }
  if (deleteButton) {
    const row = commissionRecords.find(item => String(item.id) === String(deleteButton.dataset.commissionDelete));
    if (!row || !window.confirm("¿Eliminar este registro de comisión? No se modificarán productos ni precios.")) return;
    const { error } = await supabase.from("commission_records").delete().eq("id", row.id);
    if (error) { window.alert("No se pudo eliminar el registro. Revisá los permisos de administrador."); return; }
    await loadCommissionDashboard();
  }
});
resetCommissionForm();

// Header settings dropdown: reuses current controls without changing authentication or data behavior.
(() => {
  const toggle = document.getElementById("admin-settings-toggle");
  const menu = document.getElementById("admin-settings-menu");
  if (!toggle || !menu) return;
  const closeMenu = () => { menu.hidden = true; toggle.setAttribute("aria-expanded", "false"); };
  toggle.addEventListener("click", event => {
    event.stopPropagation();
    const willOpen = menu.hidden;
    menu.hidden = !willOpen;
    toggle.setAttribute("aria-expanded", String(willOpen));
  });
  menu.addEventListener("click", event => { if (event.target.closest("[data-admin-section]")) closeMenu(); });
  document.addEventListener("click", event => { if (!event.target.closest(".admin-settings-wrap")) closeMenu(); });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !menu.hidden) { closeMenu(); toggle.focus(); }
  });
})();
