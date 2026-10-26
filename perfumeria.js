import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const CONFIG = window.CATALOG_CONFIG || {};
const $ = selector => document.querySelector(selector);
const whatsappNumber = String(CONFIG.whatsappNumber || "").replace(/\D/g, "");
const categoryDefinitions = [
  { key: "nicho", section: $("#category-nicho"), grid: $("#product-grid-nicho"), count: $("#category-nicho-count"), empty: $("#empty-category-nicho") },
  { key: "arabes", section: $("#category-arabes"), grid: $("#product-grid-arabes"), count: $("#category-arabes-count"), empty: $("#empty-category-arabes") },
  { key: "disenador", section: $("#category-disenador"), grid: $("#product-grid-disenador"), count: $("#category-disenador-count"), empty: $("#empty-category-disenador") },
  { key: "otras", section: $("#category-otras"), grid: $("#product-grid-otras"), count: $("#category-otras-count"), empty: null, optional: true }
];
const productGrids = categoryDefinitions.map(category => category.grid).filter(Boolean);
const statusNode = $("#catalog-status");
const emptyNode = $("#empty-results");
const searchInput = $("#perfume-search-input");
const familySelect = $("#perfume-family-select");
const audienceSelect = $("#perfume-audience-select");
const perfumeSortSelect = $("#perfume-sort-select");
const brandFilterToggle = $("#perfume-brand-filter-toggle");
const brandFilterValue = $("#perfume-brand-filter-value");
const brandFilterMenu = $("#perfume-brand-filter-menu");
const brandFilterSearch = $("#perfume-brand-filter-search");
const brandFilterOptions = $("#perfume-brand-filter-options");
const productTypeFilters = $("#product-type-filters");
const clearAllFiltersButton = $("#clear-all-filters");
const filterSummary = $("#perfume-filter-summary");
const resultsHeading = $("#catalog-results-heading");
const resultsEyebrow = $("#catalog-results-eyebrow");
const resultsTitle = $("#catalog-results-title");
const minPriceInput = $("#price-min-input");
const maxPriceInput = $("#price-max-input");
const clearPriceButton = $("#clear-price-filter");
const priceFeedback = $("#budget-filter-feedback");
const perfumeDetailPage = $("#perfume-detail-page");
const perfumeHeaderBack = $("#perfume-detail-header-back");
const dialogContent = $("#perfume-dialog-content");
const catalogDocumentTitle = document.title;
const catalogCanonical = document.querySelector('link[rel="canonical"]')?.href || "";

let supabase = null;
let perfumes = [];
const selectedFamilies = new Set();
const selectedAudiences = new Set();
const selectedProductTypes = new Set();
let selectedBrand = "";

const hasConfig = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
if (hasConfig) supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);

const yearNode = $("#perfume-year");
if (yearNode) yearNode.textContent = new Date().getFullYear();

const normalizeText = value => String(value || "").trim().toLocaleLowerCase("es");

const normalizeSearchQuery = value => normalizeText(value)
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/\bplay\s*station\s*(\d+)\b/g, "ps$1")
  .replace(/\bps\s*(\d+)\b/g, "ps$1")
  .replace(/\b(\d+)\s+(am|pm)\b/g, "$1$2")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

function searchTokensMatch(haystack, query) {
  const tokens = normalizeSearchQuery(query).split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every(token => haystack.includes(token));
}

function perfumeIdentityText(product) {
  return normalizeSearchQuery([product.name, product.brand, product.model].filter(Boolean).join(" "));
}
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[char]));

function parseJSON(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === "object")) return value;
  if (typeof value !== "string" || !value.trim()) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function getImages(product) {
  const raw = parseJSON(product?.images, []);
  const images = Array.isArray(raw) ? raw : [];
  return [...new Set([...images, product?.image_url]
    .filter(item => typeof item === "string")
    .map(item => item.trim())
    .filter(Boolean))];
}

function canonicalFamily(value) {
  const family = normalizeText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\s_-]+/g, "");
  if (["arabes", "arabe", "arabic", "arabian"].includes(family)) return "arabes";
  if (["nicho", "niche"].includes(family)) return "nicho";
  if (["disenador", "designer", "design"].includes(family)) return "disenador";
  return family || "otras";
}

function familyLabel(family) {
  return ({
    arabes:"Árabe",
    nicho:"Nicho",
    disenador:"Diseñador"
  })[canonicalFamily(family)] || "Perfumería";
}

function syncFamilyNavigation() {
  const activeCategory = familySelect?.value || "all";
  document.querySelectorAll(".perfume-family-link").forEach(link => {
    const active = link.dataset.familyCategory === activeCategory && activeCategory !== "all";
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  });
}

function familyMatches(product) {
  return !selectedFamilies.size || selectedFamilies.has(canonicalFamily(product.perfume_details?.family));
}
function canonicalAudience(value) {
  const audience = normalizeText(value);
  if (["hombre","masculino","male","man"].includes(audience)) return "hombre";
  if (["mujer","femenino","female","woman"].includes(audience)) return "mujer";
  return audience === "unisex" ? "unisex" : "";
}
function audienceMatches(product) {
  return !selectedAudiences.size || selectedAudiences.has(canonicalAudience(product.perfume_details?.audience));
}
function productTypeMatches(product) {
  const type = product?.product_type === "set" ? "set" : "perfume";
  return !selectedProductTypes.size || selectedProductTypes.has(type);
}
function updateFilterButtons(container, attribute, selectedSet) {
  if (!container) return;
  container.querySelectorAll(".filter-chip").forEach(button => {
    const value = button.dataset[attribute] || "all";
    const active = value === "all" ? selectedSet.size === 0 : selectedSet.has(value);
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function formatUSD(value) {
  if (value === null || value === undefined || value === "") return "Consultar";
  const price = Number(value);
  if (!Number.isFinite(price)) return "Consultar";
  return "US$ " + new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(price);
}

function formatNIO(value) {
  if (value === null || value === undefined || value === "") return "";
  const price = Number(value);
  if (!Number.isFinite(price)) return "";
  return new Intl.NumberFormat("es-NI", {
    style:"currency", currency:"NIO", maximumFractionDigits:2
  }).format(price);
}

function statusLabel(value) {
  const normalized = normalizeText(value);
  if (["on_order","por pedido","order"].includes(normalized)) return "Por pedido";
  if (["out_of_stock","agotado","agotado temporalmente","unavailable"].includes(normalized)) return "Agotado temporalmente";
  return "Disponible";
}

function updateBrandFilterLabel() {
  if (brandFilterValue) brandFilterValue.textContent = selectedBrand || "Todas las marcas";
}

function renderBrandFilterOptions() {
  if (!brandFilterOptions) return;
  const brands = [...new Set(perfumes.map(product => String(product.brand || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
  const query = normalizeText(brandFilterSearch?.value);
  const matches = query ? brands.filter(brand => normalizeText(brand).startsWith(query)) : brands;
  const options = [];
  const all = document.createElement("button");
  all.type = "button";
  all.className = "brand-filter-option";
  all.dataset.brand = "";
  all.setAttribute("role", "option");
  all.setAttribute("aria-selected", String(!selectedBrand));
  all.textContent = "Todas las marcas";
  options.push(all);
  matches.forEach(brand => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "brand-filter-option";
    option.dataset.brand = brand;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(selectedBrand === brand));
    option.textContent = brand;
    options.push(option);
  });
  brandFilterOptions.replaceChildren(...options);
  if (!matches.length && query) {
    const empty = document.createElement("p");
    empty.className = "brand-filter-empty";
    empty.textContent = "No se encontraron marcas.";
    brandFilterOptions.append(empty);
  }
}

function closeBrandFilterMenu() {
  if (brandFilterMenu) brandFilterMenu.hidden = true;
  if (brandFilterToggle) brandFilterToggle.setAttribute("aria-expanded", "false");
}

function priceBound(input) {
  const raw = String(input?.value || "").trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function hasActiveFilters() {
  return Boolean(
    (searchInput?.value || "").trim() ||
    selectedBrand ||
    (perfumeSortSelect?.value || "recent") !== "recent" ||
    selectedFamilies.size > 0 ||
    selectedAudiences.size > 0 ||
    selectedProductTypes.size > 0 ||
    priceBound(minPriceInput) !== null ||
    priceBound(maxPriceInput) !== null
  );
}

function hasContentFilters() {
  return Boolean(
    (searchInput?.value || "").trim() ||
    selectedBrand ||
    selectedFamilies.size > 0 ||
    selectedAudiences.size > 0 ||
    selectedProductTypes.size > 0 ||
    priceBound(minPriceInput) !== null ||
    priceBound(maxPriceInput) !== null
  );
}

function productLink(product) {
  const url = new URL(window.location.pathname, window.location.origin);
  url.searchParams.set("fragancia", String(product.id));
  return url.href;
}

function productShareLink(product) {
  const configuredPublicUrl = String(window.CATALOG_CONFIG?.publicCatalogUrl || "https://jb-collections.pages.dev").trim();
  let shareOrigin = "https://jb-collections.pages.dev";
  try {
    shareOrigin = new URL(configuredPublicUrl).origin;
  } catch {
    shareOrigin = "https://jb-collections.pages.dev";
  }
  const share = new URL("/api/share", shareOrigin);
  share.searchParams.set("catalog", "perfumery");
  share.searchParams.set("id", String(product.id));
  return share.href;
}

function whatsappLink(message) {
  return "https://wa.me/" + whatsappNumber + "?text=" + encodeURIComponent(message);
}

function buildWhatsAppMessage(product, intent) {
  const detail = product.perfume_details || {};
  const family = familyLabel(detail.family);
  const concentration = String(detail.concentration || "").trim();
  const volume = detail.volume_ml ? Number(detail.volume_ml).toLocaleString("es-NI") + " ml" : "";
  const priceNio = formatNIO(product.price_nio);
  const notes = [
    "Hola, " + intent,
    (product.product_type === "set" ? "Set de perfumes: " : "Perfume / fragancia: ") + String(product.name || "sin nombre") + ".",
    product.brand ? "Marca: " + product.brand + "." : "",
    "Familia: " + family + ".",
    concentration ? "Concentración: " + concentration + "." : "",
    volume ? "Presentación: " + volume + "." : "",
    product.price_usd !== null && product.price_usd !== undefined ? "Precio: " + formatUSD(product.price_usd) + "." : "",
    priceNio ? "Precio en córdobas: " + priceNio + "." : "",
    "Disponibilidad: " + statusLabel(product.availability) + ".",
    "Enlace: " + productShareLink(product) + "."
  ].filter(Boolean);
  return notes.join(" ");
}


function isCatalogAdminActivityActive() {
  try {
    const timestamp = Number(window.localStorage.getItem("cat-logo-admin-activity-v1") || 0);
    return timestamp > 0 && Date.now() - timestamp < 180000;
  } catch {
    return false;
  }
}

let perfumeVisitorLocationPromise = null;
async function getPerfumeVisitorLocation() {
  if (!perfumeVisitorLocationPromise) {
    perfumeVisitorLocationPromise = fetch("../api/catalog-location", {
      method: "GET", credentials: "same-origin", cache: "no-store"
    }).then(response => response.ok ? response.json() : null)
      .then(value => ({
        country: typeof value?.country === "string" ? value.country.slice(0, 2).toUpperCase() : null,
        department: typeof value?.department === "string" ? value.department.slice(0, 80) : null
      }))
      .catch(() => ({ country: null, department: null }));
  }
  return perfumeVisitorLocationPromise;
}

async function recordPerfumeCatalogPageVisit() {
  if (!supabase || isCatalogAdminActivityActive()) return;
  const visitor = await getPerfumeVisitorLocation();
  const { error } = await supabase.from("catalog_events").insert({
    product_id: null,
    event_type: "catalog_view",
    catalog_type: "perfumery",
    visitor_country: visitor.country,
    visitor_department: visitor.department
  });
  if (error) console.info("No se pudo registrar la visita de catálogo.", error.message);
}

async function recordEvent(productId, eventType) {
  if (isCatalogAdminActivityActive() || !supabase || !productId || !["view","whatsapp_click"].includes(eventType)) return;
  try {
    const eventBase = {
      product_id: productId,
      event_type: eventType,
      variant_color: null,
      variant_ram: null,
      variant_storage: null
    };
    const visitor = await getPerfumeVisitorLocation();
    let { error } = await supabase.from("catalog_events").insert({
      ...eventBase,
      visitor_country: visitor.country,
      visitor_department: visitor.department
    });
    if (error && /visitor_(country|department)|schema cache|column .*does not exist/i.test(error.message || "")) {
      ({ error } = await supabase.from("catalog_events").insert(eventBase));
    }
    if (error) console.info("La analítica no está disponible:", error.message);
  } catch (error) {
    console.info("La analítica no está disponible.", error);
  }
}

// Detect a plain white/light background from the image corners when the image host permits CORS.
const perfumePhotoFitChecks = new Map();

function detectLightPhotoBackground(url, fallbackLightBackground = false) {
  return new Promise(resolve => {
    const probe = new Image();
    probe.crossOrigin = "anonymous";
    probe.decoding = "async";
    probe.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 32;
        canvas.height = 32;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return resolve(false);
        context.drawImage(probe, 0, 0, 32, 32);
        const pixels = context.getImageData(0, 0, 32, 32).data;
        const corners = [
          [2, 2], [5, 2], [2, 5],
          [29, 2], [26, 2], [29, 5],
          [2, 29], [5, 29], [2, 26],
          [29, 29], [26, 29], [29, 26]
        ];
        let lightPixels = 0;
        for (const [x, y] of corners) {
          const offset = (y * 32 + x) * 4;
          const red = pixels[offset];
          const green = pixels[offset + 1];
          const blue = pixels[offset + 2];
          const alpha = pixels[offset + 3];
          const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
          const brightness = (red + green + blue) / 3;
          if (alpha < 35 || (brightness >= 216 && red >= 205 && green >= 205 && blue >= 210 && spread <= 48)) {
            lightPixels += 1;
          }
        }
        resolve(lightPixels >= 7);
      } catch {
        // Cross-origin pixel access may be restricted; use the known-photo fallback.
        resolve(fallbackLightBackground);
      }
    };
    // Some external image hosts do not permit canvas pixel inspection. For the
    // white-margin product photos already identified in the catalog, use a
    // conservative named fallback rather than silently leaving them undersized.
    probe.onerror = () => resolve(fallbackLightBackground);
    probe.src = url;
  });
}

function applyAutomaticPerfumePhotoFit(image) {
  if (!(image instanceof HTMLImageElement) || image.dataset.perfumeImageFit) return;
  const url = image.currentSrc || image.src;
  if (!url) return;
  image.dataset.perfumeImageFit = "checking";
  const knownLightMarginPhoto = /\\b(?:sauvage(?:\\s+elixir)?|bleu\\s+de\\s+chanel|greenley)\\b/i.test(image.alt || "");
  let check = perfumePhotoFitChecks.get(url);
  if (!check) {
    check = detectLightPhotoBackground(url, knownLightMarginPhoto);
    perfumePhotoFitChecks.set(url, check);
  }
  check.then(hasLightBackground => {
    image.dataset.perfumeImageFit = hasLightBackground ? "cover" : "contain";
    const frame = image.closest(".perfume-product-image");
    if (frame && image.isConnected) {
      frame.classList.toggle("has-white-background", hasLightBackground);
    }
  }).catch(() => {
    image.dataset.perfumeImageFit = "contain";
  });
}

// Lazy-loaded photos are classified when they finish loading.
document.addEventListener("load", event => {
  const image = event.target;
  if (image instanceof HTMLImageElement && image.matches("img[data-perfume-image]")) {
    applyAutomaticPerfumePhotoFit(image);
  }
}, true);

function imageMarkup(product) {
  const url = getImages(product)[0] || "";
  return url
    ? '<img data-perfume-image src="' + escapeHtml(url) + '" alt="' + escapeHtml(product.name || "Fragancia") + '" loading="lazy">'
    : '<div class="perfume-photo-placeholder"><span aria-hidden="true">✦</span><small>Foto por agregar</small></div>';
}

function renderCard(product) {
  const detail = product.perfume_details || {};
  const family = familyLabel(detail.family);
  const concentration = String(detail.concentration || "").trim();
  const volume = detail.volume_ml ? Number(detail.volume_ml).toLocaleString("es-NI") + " ml" : "";
  const productTypeLabel = product.product_type === "set" ? "Set de perfumes" : "Perfume / fragancia";
  const image = imageMarkup(product);
  const tightPhotoFrame = /9\s*pm\s*elixir|sauvage\s+elixir/i.test(String(product.name || ""));
  const badge = product.featured ? '<span class="perfume-featured-badge">✦ DESTACADO</span>' : "";
  const state = statusLabel(product.availability);
  const stateBadge = state === "Disponible" ? "" : '<span class="perfume-state-badge">' + escapeHtml(state) + '</span>';
  const nio = formatNIO(product.price_nio);

  const badges = badge || stateBadge
    ? '<div class="perfume-product-badges">' + badge + stateBadge + '</div>'
    : "";

  return '<article class="product-card perfume-product-card' + (product.featured ? ' featured-product-card' : '') + '">' +
    badges +
    '<div class="product-image perfume-product-image' + (tightPhotoFrame ? ' is-tight-photo-frame' : '') + '">' + image + '</div>' +
    '<div class="product-card-content perfume-product-card-content">' +
      '<p class="perfume-card-family">' + escapeHtml(productTypeLabel + " · " + family) + '</p>' +
      '<h3>' + escapeHtml(product.name || "Fragancia sin nombre") + '</h3>' +
      (product.brand ? '<p class="perfume-card-brand">' + escapeHtml(product.brand) + '</p>' : '') +
      '<div class="perfume-product-meta">' + [concentration, volume, detail.audience].filter(Boolean).map(escapeHtml).join('<span aria-hidden="true">·</span>') + '</div>' +
      (detail.scent_family ? '<p class="perfume-card-scent">' + escapeHtml(detail.scent_family) + '</p>' : '') +
      '<div class="perfume-price-label">' + 'Precio' + '</div>' +
      '<div class="perfume-product-price">' + escapeHtml(formatUSD(product.price_usd)) + '</div>' +
      (nio ? '<p class="perfume-product-price-secondary">' + escapeHtml(nio) + '</p>' : '') +
      '<div class="product-actions"><a class="button perfume-view-button" href="' + escapeHtml(productLink(product)) + '" data-details="' + escapeHtml(product.id) + '">' + (product.product_type === "set" ? "Ver set" : "Ver fragancia") + ' <span aria-hidden="true">↗</span></a></div>' +
    '</div>' +
  '</article>';
}

function visibleProducts() {
  const rawQuery = (searchInput?.value || "").trim();
  const query = normalizeSearchQuery(rawQuery);
  const min = priceBound(minPriceInput);
  const max = priceBound(maxPriceInput);
  const validRange = min === null || max === null || min <= max;
  if (priceFeedback) priceFeedback.textContent = validRange ? "" : "El mínimo no puede superar al máximo.";
  if (!validRange) return [];

  // Prioritize name, brand and model. Search notes/details only if no identity matches exist.
  const identityMatches = rawQuery
    ? new Set(perfumes.filter(product => searchTokensMatch(perfumeIdentityText(product), query)))
    : null;
  const useIdentityMatches = Boolean(identityMatches?.size);

  return perfumes.filter(product => {
    if (!familyMatches(product) || !audienceMatches(product) || !productTypeMatches(product)) return false;
    if (selectedBrand && String(product.brand || "").trim().toLocaleLowerCase("es") !== selectedBrand.toLocaleLowerCase("es")) return false;
    const detail = product.perfume_details || {};
    const searchable = [
      product.name, product.brand, product.model, product.description, product.product_type,
      detail.family, detail.concentration, detail.volume_ml, detail.audience, detail.scent_family,
      ...(Array.isArray(detail.top_notes) ? detail.top_notes : []),
      ...(Array.isArray(detail.heart_notes) ? detail.heart_notes : []),
      ...(Array.isArray(detail.base_notes) ? detail.base_notes : [])
    ].filter(Boolean).join(" ");
    const haystack = normalizeSearchQuery(searchable);
    const queryMatches = !query || (useIdentityMatches
      ? identityMatches.has(product)
      : searchTokensMatch(haystack, query));
    if (!queryMatches) return false;
    if (min !== null || max !== null) {
      if (product.price_usd === null || product.price_usd === undefined || product.price_usd === "") return false;
      const price = Number(product.price_usd);
      if (!Number.isFinite(price) || (min !== null && price < min) || (max !== null && price > max)) return false;
    }
    return true;
  }).sort((a, b) => {
    const sort = perfumeSortSelect?.value || "recent";
    if (sort === "price-asc" || sort === "price-desc") {
      const rawA = a.price_usd;
      const rawB = b.price_usd;
      const priceA = rawA === null || rawA === undefined || rawA === "" ? NaN : Number(rawA);
      const priceB = rawB === null || rawB === undefined || rawB === "" ? NaN : Number(rawB);
      const validA = Number.isFinite(priceA) ? priceA : (sort === "price-asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
      const validB = Number.isFinite(priceB) ? priceB : (sort === "price-asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
      return sort === "price-asc" ? validA - validB : validB - validA;
    }
    if (sort === "name-asc") return String(a.name || "").localeCompare(String(b.name || ""), "es", { sensitivity: "base" });
    return new Date(b.published_at || b.created_at || 0).getTime() - new Date(a.published_at || a.created_at || 0).getTime();
  });
}

function renderProducts() {
  syncFamilyNavigation();
  const matched = visibleProducts();
  const filtering = hasContentFilters();
  const catalogEmpty = perfumes.length === 0;
  const hasMatchedProducts = matched.length > 0;

  resultsHeading.classList.toggle("hidden", catalogEmpty);
  resultsEyebrow.textContent = filtering ? "RESULTADOS" : "DESCUBRÍ";
  resultsTitle.textContent = filtering ? "Resultados de tu búsqueda" : "Toda la colección";

  categoryDefinitions.forEach(category => {
    const categoryProducts = matched.filter(product => canonicalFamily(product.perfume_details?.family) === category.key);
    const hasCategoryProducts = categoryProducts.length > 0;

    if (category.optional) {
      category.section.classList.toggle("hidden", !hasCategoryProducts);
    } else {
      category.section.classList.toggle("hidden", filtering && !hasCategoryProducts);
      category.empty.classList.toggle("hidden", hasCategoryProducts || filtering);
    }

    category.grid.innerHTML = categoryProducts.map(renderCard).join("");
    category.count.textContent = categoryProducts.length + (categoryProducts.length === 1 ? " fragancia" : " fragancias");
    category.grid.querySelectorAll("img[data-perfume-image]").forEach(image => {
      if (image.complete && image.naturalWidth > 0) applyAutomaticPerfumePhotoFit(image);
    });
  });

  const noResults = !catalogEmpty && !hasMatchedProducts;
  emptyNode.classList.toggle("hidden", !noResults);
  emptyNode.classList.remove("is-coming-soon");
  const emptyTitle = emptyNode.querySelector("h3");
  const emptyDescription = emptyNode.querySelector("p");
  if (emptyTitle) emptyTitle.textContent = "No encontramos esa fragancia";
  if (emptyDescription) emptyDescription.textContent = "Probá con otro nombre, categoría, género o rango de precio.";

  statusNode.textContent = catalogEmpty
    ? "Próximamente: estamos preparando la colección."
    : (filtering
      ? matched.length + (matched.length === 1 ? " producto encontrado" : " productos encontrados")
      : perfumes.length + (perfumes.length === 1 ? " producto publicado" : " productos publicados"));

  if (clearPriceButton) clearPriceButton.disabled = priceBound(minPriceInput) === null && priceBound(maxPriceInput) === null;
  if (familySelect) familySelect.value = selectedFamilies.values().next().value || "all";
  if (audienceSelect) audienceSelect.value = selectedAudiences.values().next().value || "all";
  updateFilterButtons(productTypeFilters, "productType", selectedProductTypes);
  const familyLabels = [...selectedFamilies].map(value => ({arabes:"Árabes",nicho:"Nicho",disenador:"Diseñador"})[canonicalFamily(value)] || value);
  const audienceLabels = [...selectedAudiences].map(value => ({hombre:"Hombre",mujer:"Mujer",unisex:"Unisex"})[value] || value);
  const productTypeLabels = [...selectedProductTypes].map(value => ({perfume:"Perfumes y fragancias",set:"Sets de perfumes"})[value] || value);
  if (filterSummary) filterSummary.textContent = [
    productTypeLabels.length ? productTypeLabels.join(" + ") : "Todos los formatos",
    familyLabels.length ? familyLabels.join(" + ") : "Todas las categorías",
    audienceLabels.length ? audienceLabels.join(" + ") : "Todos los géneros"
  ].join(" · ");
  if (clearAllFiltersButton) clearAllFiltersButton.disabled = !hasActiveFilters();
}

function notesSection(title, values) {
  const items = Array.isArray(values) ? values.filter(Boolean) : [];
  if (!items.length) return "";
  return '<section class="perfume-note-group"><h3>' + title + '</h3>' +
    '<ul>' + items.map(item => '<li>' + escapeHtml(item) + '</li>').join("") + '</ul>' +
    '</section>';
}

let catalogScrollLockSnapshot = null;

function lockCatalogScrollPosition() {
  if (catalogScrollLockSnapshot) return;

  const body = document.body;
  const root = document.documentElement;
  const scrollY = Math.max(0, window.scrollY || root.scrollTop || 0);
  const scrollbarWidth = Math.max(0, window.innerWidth - root.clientWidth);
  const computedPaddingRight = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;

  catalogScrollLockSnapshot = {
    scrollY,
    bodyStyle: {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
      paddingRight: body.style.paddingRight
    },
    rootScrollBehavior: root.style.scrollBehavior
  };

  // Freeze the document at its current scroll offset while the detail overlay is open.
  body.style.position = "fixed";
  body.style.top = "-" + scrollY + "px";
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
  body.style.overflow = "hidden";
  if (scrollbarWidth > 0) body.style.paddingRight = (computedPaddingRight + scrollbarWidth) + "px";
}

function restoreCatalogScrollPosition() {
  const snapshot = catalogScrollLockSnapshot;
  if (!snapshot) return;
  catalogScrollLockSnapshot = null;

  const body = document.body;
  const root = document.documentElement;
  // Override CSS scroll-behavior:smooth for this one restoration so it never animates
  // from the top through the whole catalog.
  root.style.scrollBehavior = "auto";
  body.style.position = snapshot.bodyStyle.position;
  body.style.top = snapshot.bodyStyle.top;
  body.style.left = snapshot.bodyStyle.left;
  body.style.right = snapshot.bodyStyle.right;
  body.style.width = snapshot.bodyStyle.width;
  body.style.overflow = snapshot.bodyStyle.overflow;
  body.style.paddingRight = snapshot.bodyStyle.paddingRight;
  window.scrollTo({ left: 0, top: snapshot.scrollY, behavior: "auto" });

  window.requestAnimationFrame(() => {
    root.style.scrollBehavior = snapshot.rootScrollBehavior;
  });
}

function setCatalogDetailOverlayOffset() {
  const header = document.querySelector(".site-header");
  const headerHeight = Math.max(0, Math.ceil(header?.getBoundingClientRect().height || 76));
  document.documentElement.style.setProperty("--catalog-detail-overlay-top", headerHeight + "px");
}

function openPerfume(product) {
  const detail = product.perfume_details || {};
  const images = getImages(product);
  const initialImage = images[0] || "";
  const family = familyLabel(detail.family);
  const productTypeLabel = product.product_type === "set" ? "Set de perfumes" : "Perfume / fragancia";
  const concentration = String(detail.concentration || "").trim();
  const volume = detail.volume_ml ? Number(detail.volume_ml).toLocaleString("es-NI") + " ml" : "No especificado";
  const nio = formatNIO(product.price_nio);
  const hasOlfactoryNotes = [detail.top_notes, detail.heart_notes, detail.base_notes]
    .some(values => Array.isArray(values) && values.some(value => String(value || "").trim()));
  dialogContent.dataset.productId = String(product.id);
  recordEvent(product.id, "view");

  const gallery = initialImage
    ? '<div class="perfume-dialog-main-image" data-inline-gallery><img id="perfume-dialog-main-image" src="' + escapeHtml(initialImage) + '" alt="' + escapeHtml(product.name) + '" loading="eager">' +
      (images.length > 1
        ? '<button type="button" class="perfume-gallery-nav perfume-gallery-prev" data-gallery-step="-1" aria-label="Ver fotografía anterior">‹</button><button type="button" class="perfume-gallery-nav perfume-gallery-next" data-gallery-step="1" aria-label="Ver fotografía siguiente">›</button>'
        : "") +
      '</div>' +
      (images.length > 1
        ? '<div class="perfume-dialog-thumbnails">' + images.map((url,index) =>
            '<button type="button" class="perfume-dialog-thumb ' + (index===0 ? "active" : "") + '" data-gallery-image="' + escapeHtml(url) + '" aria-label="Ver fotografía ' + (index+1) + '"><img src="' + escapeHtml(url) + '" alt="" loading="lazy"></button>'
          ).join("") + '</div>'
        : "")
    : '<div class="perfume-photo-placeholder perfume-dialog-photo-placeholder"><span aria-hidden="true">✦</span><small>Fotografía no disponible</small></div>';

  dialogContent.innerHTML =
    '<div class="perfume-dialog-layout">' +
      '<section class="perfume-dialog-gallery">' + gallery + '</section>' +
      '<section class="perfume-dialog-detail">' +
        '<p class="perfume-kicker">' + escapeHtml(productTypeLabel + " · " + family) + '</p>' +
        '<h2>' + escapeHtml(product.name || "Fragancia") + '</h2>' +
        (product.brand ? '<p class="perfume-dialog-brand">' + escapeHtml(product.brand) + '</p>' : '') +
        '<p class="perfume-dialog-description">' + escapeHtml(product.description || "Consultá por las notas y características de esta fragancia.") + '</p>' +
        '<dl class="perfume-dialog-facts">' +
          (concentration ? '<div><dt>Concentración</dt><dd>' + escapeHtml(concentration) + '</dd></div>' : '') +
          (detail.volume_ml ? '<div><dt>Contenido</dt><dd>' + escapeHtml(volume) + '</dd></div>' : '') +
          '<div><dt>Tipo de producto</dt><dd>' + escapeHtml(productTypeLabel) + '</dd></div>' +
          (detail.audience ? '<div><dt>Género</dt><dd>' + escapeHtml(detail.audience) + '</dd></div>' : '') +
          '<div><dt>Disponibilidad</dt><dd>' + escapeHtml(statusLabel(product.availability)) + '</dd></div>' +
          (detail.scent_family ? '<div><dt>Familia olfativa</dt><dd>' + escapeHtml(detail.scent_family) + '</dd></div>' : '') +
        '</dl>' +
        '<div class="perfume-dialog-price"><span>Precio</span><strong>' + escapeHtml(formatUSD(product.price_usd)) + '</strong>' + (nio ? '<small>' + escapeHtml(nio) + '</small>' : '') + '</div>' +
        '<div class="perfume-dialog-actions">' +
          '<a id="perfume-buy-link" class="perfume-primary-link" href="' + escapeHtml(whatsappLink(buildWhatsAppMessage(product, product.product_type === "set" ? "quiero comprar este set de perfumes." : "quiero comprar esta fragancia."))) + '" target="_blank" rel="noopener">' + (product.product_type === "set" ? "Quiero comprar este set" : "Quiero comprarla") + ' <span aria-hidden="true">↗</span></a>' +
          '<a id="perfume-question-link" class="perfume-outline-link" href="' + escapeHtml(whatsappLink(buildWhatsAppMessage(product, product.product_type === "set" ? "quisiera consultar opciones de pago para este set de perfumes." : "quisiera consultar las opciones de financiamiento o pago con tarjeta de crédito para esta fragancia."))) + '" target="_blank" rel="noopener">Consultar pago o financiamiento</a>' +
        '</div>' +
      '</section>' +
    '</div>' +
    (hasOlfactoryNotes
      ? '<div class="perfume-dialog-notes">' +
        notesSection("Notas de salida", detail.top_notes) +
        notesSection("Notas de corazón", detail.heart_notes) +
        notesSection("Notas de fondo", detail.base_notes) +
        '</div>'
      : '');
  setCatalogDetailOverlayOffset();
  lockCatalogScrollPosition();
  perfumeDetailPage?.classList.remove("hidden");
  if (perfumeHeaderBack) perfumeHeaderBack.hidden = false;
  document.querySelector("main")?.classList.add("is-perfume-detail-view");
  document.body.classList.add("perfume-detail-active");
  document.title = `${product.name || "Fragancia"} | JB Parfums`;
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) canonical.href = productLink(product);
}

function readPerfumeRoute() {
  const url = new URL(window.location.href);
  const queryId = url.searchParams.get("fragancia");
  if (queryId) return { id: queryId, legacy: false };
  const match = url.hash.match(/^#fragancia=(.+)$/);
  if (!match) return { id: "", legacy: false };
  let id = match[1];
  try { id = decodeURIComponent(id); } catch { /* Conservar el ID heredado. */ }
  return { id, legacy: true };
}

function showPerfumeCatalog() {
  perfumeDetailPage?.classList.add("hidden");
  if (perfumeHeaderBack) perfumeHeaderBack.hidden = true;
  document.querySelector("main")?.classList.remove("is-perfume-detail-view");
  document.body.classList.remove("perfume-detail-active");
  document.documentElement.style.removeProperty("--catalog-detail-overlay-top");
  document.title = catalogDocumentTitle;
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical && catalogCanonical) canonical.href = catalogCanonical;
  if (dialogContent) dialogContent.innerHTML = "";
  restoreCatalogScrollPosition();
}

function loadDeepLink() {
  const route = readPerfumeRoute();
  if (!route.id) {
    const wasDetail = document.body.classList.contains("perfume-detail-active");
    const scrollY = Number(window.history.state?.catalogScrollY) || 0;
    showPerfumeCatalog();
    if (wasDetail && Math.abs(window.scrollY - scrollY) > 2) {
      window.scrollTo({ top: scrollY, behavior: "instant" });
    }
    return;
  }

  const product = perfumes.find(item => String(item.id) === route.id);
  if (!product) {
    showPerfumeCatalog();
    statusNode.textContent = "La fragancia solicitada no está publicada o el enlace ya no es válido.";
    return;
  }
  if (route.legacy) {
    window.history.replaceState(window.history.state, document.title, productLink(product));
  }
  openPerfume(product);
}

function bindMultiSelect(container, attribute, selectedSet) {
  const dataAttribute = "data-" + attribute.replace(/[A-Z]/g, char => "-" + char.toLowerCase());
  container?.addEventListener("click", event => {
    const button = event.target.closest(".filter-chip");
    if (!button || !container.contains(button) || !button.hasAttribute(dataAttribute)) return;
    const value = button.getAttribute(dataAttribute) || "all";
    if (value === "all") selectedSet.clear();
    else if (attribute === "productType") {
      selectedSet.clear();
      selectedSet.add(value);
    } else if (selectedSet.has(value)) selectedSet.delete(value);
    else selectedSet.add(value);
    renderProducts();
  });
}
bindMultiSelect(productTypeFilters, "productType", selectedProductTypes);
function applyPerfumeSearch() {
  renderProducts();
  closeBrandFilterMenu();
  searchInput?.blur();
  const target = resultsHeading || categoryDefinitions[0]?.section;
  if (!target) return;
  const scrollToTarget = () => {
    const stickyHeader = document.querySelector(".site-header");
    const offset = (stickyHeader?.getBoundingClientRect().height || 0) + 12;
    const top = Math.max(0, window.scrollY + target.getBoundingClientRect().top - offset);
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    window.scrollTo({ top, behavior: reducedMotion ? "auto" : "smooth" });
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => requestAnimationFrame(scrollToTarget));
  else scrollToTarget();
}

searchInput.addEventListener("input", renderProducts);
searchInput.addEventListener("keydown", event => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  applyPerfumeSearch();
});
brandFilterToggle?.addEventListener("click", () => {
  const opening = Boolean(brandFilterMenu?.hidden);
  if (brandFilterMenu) brandFilterMenu.hidden = !opening;
  brandFilterToggle.setAttribute("aria-expanded", String(opening));
  if (opening) {
    if (brandFilterSearch) brandFilterSearch.value = "";
    renderBrandFilterOptions();
    brandFilterSearch?.focus();
  }
});
brandFilterSearch?.addEventListener("input", renderBrandFilterOptions);
brandFilterSearch?.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    closeBrandFilterMenu();
    brandFilterToggle?.focus();
  }
});
brandFilterOptions?.addEventListener("click", event => {
  const option = event.target.closest("[data-brand]");
  if (!option || !brandFilterOptions.contains(option)) return;
  selectedBrand = option.dataset.brand || "";
  if (brandFilterSearch) brandFilterSearch.value = "";
  updateBrandFilterLabel();
  closeBrandFilterMenu();
  renderProducts();
});
document.addEventListener("click", event => {
  if (!event.target.closest(".brand-filter-wrap")) closeBrandFilterMenu();
});
familySelect?.addEventListener("change", () => {
  selectedFamilies.clear();
  if (familySelect.value !== "all") selectedFamilies.add(familySelect.value);
  renderProducts();
});

audienceSelect?.addEventListener("change", () => {
  selectedAudiences.clear();
  if (audienceSelect.value !== "all") selectedAudiences.add(audienceSelect.value);
  renderProducts();
});
perfumeSortSelect?.addEventListener("change", renderProducts);
minPriceInput.addEventListener("input", renderProducts);
maxPriceInput.addEventListener("input", renderProducts);
clearPriceButton.addEventListener("click", () => {
  minPriceInput.value = "";
  maxPriceInput.value = "";
  renderProducts();
});
clearAllFiltersButton?.addEventListener("click", () => {
  selectedFamilies.clear();
  selectedAudiences.clear();
  selectedProductTypes.clear();
  searchInput.value = "";
  if (familySelect) familySelect.value = "all";
  if (audienceSelect) audienceSelect.value = "all";
  selectedBrand = "";
  if (brandFilterSearch) brandFilterSearch.value = "";
  updateBrandFilterLabel();
  closeBrandFilterMenu();
  if (perfumeSortSelect) perfumeSortSelect.value = "recent";
  minPriceInput.value = "";
  maxPriceInput.value = "";
  renderProducts();
});

document.querySelectorAll(".perfume-category-grid").forEach(productGrid => {
  productGrid.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    const link = target?.closest("a[data-details]");
    if (!link) return;
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const id = link.getAttribute("data-details");
    const product = perfumes.find(item => String(item.id) === id);
    if (!product) return;
    event.preventDefault();
    const scrollY = window.scrollY;
    window.history.replaceState({ ...(window.history.state || {}), catalogScrollY: scrollY }, document.title, window.location.href);
    window.history.pushState({ productDetailRoute: true, catalogScrollY: scrollY, productId: String(product.id) }, document.title, productLink(product));
    openPerfume(product);
  });
});

function movePerfumeGallery(step) {
  const thumbnails = Array.from(dialogContent.querySelectorAll(".perfume-dialog-thumbnails [data-gallery-image]"));
  if (thumbnails.length < 2) return;
  let currentIndex = thumbnails.findIndex(button => button.classList.contains("active"));
  if (currentIndex < 0) currentIndex = 0;
  thumbnails[(currentIndex + step + thumbnails.length) % thumbnails.length].click();
}

let perfumeGalleryTouchStart = null;
dialogContent.addEventListener("touchstart", event => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target?.closest(".perfume-dialog-main-image[data-inline-gallery]")) {
    perfumeGalleryTouchStart = null;
    return;
  }
  const touch = event.changedTouches && event.changedTouches[0];
  perfumeGalleryTouchStart = touch ? { x: touch.clientX, y: touch.clientY } : null;
}, { passive: true });

dialogContent.addEventListener("touchend", event => {
  if (!perfumeGalleryTouchStart) return;
  const start = perfumeGalleryTouchStart;
  perfumeGalleryTouchStart = null;
  const target = event.target instanceof Element ? event.target : null;
  if (!target?.closest(".perfume-dialog-main-image[data-inline-gallery]")) return;
  const touch = event.changedTouches && event.changedTouches[0];
  if (!touch) return;
  const deltaX = touch.clientX - start.x;
  const deltaY = touch.clientY - start.y;
  if (Math.abs(deltaX) < 42 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
  movePerfumeGallery(deltaX < 0 ? 1 : -1);
}, { passive: true });

dialogContent.addEventListener("click", event => {
  const target = event.target instanceof Element ? event.target : null;
  const galleryStep = target?.closest("[data-gallery-step]");
  if (galleryStep) {
    event.preventDefault();
    event.stopPropagation();
    movePerfumeGallery(Number(galleryStep.dataset.galleryStep) || 0);
    return;
  }
  const link = target?.closest('a[href*="wa.me"]');
  if (link) recordEvent(dialogContent.dataset.productId, "whatsapp_click");

  const thumb = target?.closest("[data-gallery-image]");
  if (!thumb) return;
  const hero = $("#perfume-dialog-main-image");
  if (hero) hero.src = thumb.dataset.galleryImage;
  dialogContent.querySelectorAll("[data-gallery-image]").forEach(item => item.classList.toggle("active", item === thumb));
});


/* Escape cierra la ficha sin mover el catálogo que queda detrás. */
document.addEventListener("keydown", event => {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  if (!document.body.classList.contains("perfume-detail-active")) return;
  if (document.querySelector("dialog[open]")) return;

  event.preventDefault();
  const nextState = { ...(window.history.state || {}) };
  delete nextState.productDetailRoute;
  delete nextState.productId;

  const url = new URL(window.location.href);
  url.searchParams.delete("fragancia");
  url.hash = "";
  window.history.replaceState(nextState, document.title, url.href);
  showPerfumeCatalog();
});

perfumeHeaderBack?.addEventListener("click", () => {
  if (window.history.state?.productDetailRoute) {
    window.history.back();
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.delete("fragancia");
  url.hash = "";
  window.history.replaceState(window.history.state, document.title, url.href);
  showPerfumeCatalog();
  window.scrollTo({ top: 0, behavior: "auto" });
});
window.addEventListener("popstate", loadDeepLink);
window.addEventListener("hashchange", loadDeepLink);

productGrids.forEach(container => container?.addEventListener("error", event => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement)) return;
  const placeholder = document.createElement("div");
  placeholder.className = "perfume-photo-placeholder";
  placeholder.innerHTML = '<span aria-hidden="true">✦</span><small>Fotografía no disponible</small>';
  const cardImage = image.closest(".product-image");
  if (cardImage) {
    image.remove();
    if (!cardImage.querySelector(".perfume-photo-placeholder")) cardImage.appendChild(placeholder);
  }
}, true));

dialogContent.addEventListener("error", event => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || !image.matches("#perfume-dialog-main-image")) return;
  const gallery = image.parentElement;
  image.remove();
  if (gallery && !gallery.querySelector(".perfume-photo-placeholder")) {
    const placeholder = document.createElement("div");
    placeholder.className = "perfume-photo-placeholder perfume-dialog-photo-placeholder";
    placeholder.innerHTML = '<span aria-hidden="true">✦</span><small>Fotografía no disponible</small>';
    gallery.appendChild(placeholder);
  }
}, true);

const generalWhatsAppMessage = "Hola, quisiera consultar en JB Parfums por fragancias, precios, disponibilidad y opciones de pago.";
["#perfume-footer-whatsapp", "#perfume-hero-whatsapp"].forEach(selector => {
  const link = $(selector);
  if (!link) return;
  link.href = whatsappLink(generalWhatsAppMessage);
  link.target = "_blank";
  link.rel = "noopener";
});

function showCategoryNotice(message) {
  categoryDefinitions.forEach(category => {
    if (category.optional || !category.section || !category.empty) return;
    category.section.classList.remove("hidden");
    category.grid.innerHTML = "";
    category.count.textContent = "No disponible";
    category.empty.classList.remove("hidden");
    const paragraph = category.empty.querySelector("p");
    if (paragraph) paragraph.textContent = message;
  });
}

async function initializePerfumes() {
  if (!supabase) {
    statusNode.textContent = "No se pudo conectar con el catálogo. Verificá la configuración pública de Supabase.";
    showCategoryNotice("No se pudo conectar con el catálogo. Recargá la página o intentá de nuevo más tarde.");
    return;
  }

  try {
    const { data, error } = await supabase.from("products")
      .select("*")
      .eq("catalog_type", "perfumery")
      .eq("is_published", true)
      .eq("workflow_status", "published")
      .is("deleted_at", null)
      .order("featured", { ascending: false })
      .order("published_at", { ascending: false });
    if (error) throw error;

    const products = data || [];
    if (!products.length) {
      perfumes = [];
      updateBrandFilterLabel();
      renderProducts();
      return;
    }

    const ids = products.map(product => product.id);
    const { data: detailRows, error: detailError } = await supabase.from("perfume_details")
      .select("*")
      .in("product_id", ids);
    if (detailError) throw detailError;

    const byProduct = new Map((detailRows || []).map(detail => [String(detail.product_id), detail]));
    perfumes = products.map(product => ({ ...product, perfume_details: byProduct.get(String(product.id)) || null }));
    updateBrandFilterLabel();
    renderProducts();
    loadDeepLink();
    restoreConciergeSelection();
  } catch (error) {
    statusNode.textContent = "No pudimos cargar las fragancias. Revisá las políticas de lectura y la tabla de detalles de Supabase.";
    productGrids.forEach(container => { if (container) container.innerHTML = ""; });
    showCategoryNotice("No pudimos cargar esta categoría. Recargá la página e intentá de nuevo.");
    console.error("Error al consultar el catálogo de perfumería:", error);
  }
}


const conciergeForm = $("#perfume-concierge-form");
const conciergeResults = $("#perfume-concierge-results");
const conciergeClearButton = $("#perfume-concierge-clear");
const CONCIERGE_SESSION_KEY = "jbparfums-concierge-selection-v1";

function persistConciergeSelection(submitted = !conciergeResults?.hidden) {
  if (!conciergeForm) return;
  const state = {
    family: $("#concierge-family")?.value || "all",
    scent: $("#concierge-scent")?.value || "all",
    audience: $("#concierge-audience")?.value || "all",
    budget: $("#concierge-budget")?.value || "",
    submitted: Boolean(submitted)
  };
  try { sessionStorage.setItem(CONCIERGE_SESSION_KEY, JSON.stringify(state)); } catch { /* La página sigue funcionando sin almacenamiento. */ }
}
function restoreConciergeSelection() {
  if (!conciergeForm) return;
  let state;
  try { state = JSON.parse(sessionStorage.getItem(CONCIERGE_SESSION_KEY) || "null"); } catch { state = null; }
  if (!state || typeof state !== "object") return;
  const allowed = {
    family: ["all", "nicho", "arabes", "disenador"],
    scent: ["all", "dulce", "fresco", "amaderado", "intenso", "floral"],
    audience: ["all", "hombre", "mujer", "unisex"]
  };
  if (allowed.family.includes(state.family)) $("#concierge-family").value = state.family;
  if (allowed.scent.includes(state.scent)) $("#concierge-scent").value = state.scent;
  if (allowed.audience.includes(state.audience)) $("#concierge-audience").value = state.audience;
  $("#concierge-budget").value = typeof state.budget === "string" && /^[0-9]*(?:\\.[0-9]*)?$/.test(state.budget) ? state.budget : "";
  if (state.submitted) conciergeForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}
conciergeForm?.addEventListener("input", () => persistConciergeSelection());
conciergeForm?.addEventListener("change", () => persistConciergeSelection());
conciergeClearButton?.addEventListener("click", () => {
  conciergeForm.reset();
  $("#concierge-family").value = "all";
  $("#concierge-scent").value = "all";
  $("#concierge-audience").value = "all";
  $("#concierge-budget").value = "";
  if (conciergeResults) { conciergeResults.hidden = true; conciergeResults.replaceChildren(); }
  try { sessionStorage.removeItem(CONCIERGE_SESSION_KEY); } catch { /* Almacenamiento opcional. */ }
});

function recommendPerfumes(preferences) {
  const scentTerms = {
    dulce: /dulc|vainill|caramel|pralin|tonka|chocolate|gourmand|miel/,
    fresco: /fresc|citr|bergamot|limon|naranja|marin|acuatic|verde/,
    amaderado: /mader|oud|agar|cedro|sandal|vetiver|pimienta|especiad|cuero/,
    intenso: /ambar|ambarad|resin|incienso|oud|almizcle|intens|oriental|especiad/,
    floral: /flor|rosa|jazmin|tuberosa|peonia|iris|violeta|floral/
  };
  return perfumes.map(product => {
    const detail = product.perfume_details || {};
    let score = 0;
    if (preferences.family !== "all" && canonicalFamily(detail.family) === preferences.family) score += 5;
    if (preferences.audience !== "all" && canonicalAudience(detail.audience) === preferences.audience) score += 3;
    if (preferences.scent !== "all") {
      const scentText = normalizeSearchQuery([
        detail.scent_family,
        ...(Array.isArray(detail.top_notes) ? detail.top_notes : []),
        ...(Array.isArray(detail.heart_notes) ? detail.heart_notes : []),
        ...(Array.isArray(detail.base_notes) ? detail.base_notes : []),
        product.description
      ].filter(Boolean).join(" "));
      const pattern = scentTerms[preferences.scent];
      if (pattern && pattern.test(scentText)) score += 4;
    }
    if (preferences.budget !== null) {
      const rawPrice = product.price_usd;
      if (rawPrice === null || rawPrice === undefined || String(rawPrice).trim() === "") return null;
      const price = Number(rawPrice);
      if (!Number.isFinite(price) || price < 0 || price > preferences.budget) return null;
      score += 2;
    }
    return { product, score };
  }).filter(Boolean)
    .sort((a, b) => b.score - a.score || Number(a.product.price_usd || Infinity) - Number(b.product.price_usd || Infinity))
    .slice(0, 3)
    .map(item => item.product);
}

if (conciergeForm && conciergeResults) {
  conciergeForm.addEventListener("submit", event => {
    event.preventDefault();
    if (!perfumes.length) {
      conciergeResults.hidden = false;
      conciergeResults.innerHTML = '<p class="perfume-concierge-message">Estamos cargando la colección. Probá de nuevo en unos segundos.</p>';
      return;
    }
    const rawBudget = $("#concierge-budget")?.value?.trim() || "";
    const budgetValue = rawBudget ? Number(rawBudget) : null;
    const preferences = {
      family: $("#concierge-family")?.value || "all",
      scent: $("#concierge-scent")?.value || "all",
      audience: $("#concierge-audience")?.value || "all",
      budget: budgetValue !== null && Number.isFinite(budgetValue) && budgetValue >= 0 ? budgetValue : null
    };
    persistConciergeSelection(true);
    const recommendations = recommendPerfumes(preferences);
    conciergeResults.hidden = false;
    if (!recommendations.length) {
      conciergeResults.innerHTML = '<p class="perfume-concierge-message">No encontramos coincidencias con ese presupuesto y perfil. Probá ampliar el presupuesto o cambiar alguna preferencia.</p>';
      return;
    }
    conciergeResults.innerHTML = '<div class="perfume-concierge-results-heading"><p class="perfume-kicker">SELECCIÓN PERSONALIZADA</p><h3>Opciones para vos</h3><p>Una selección orientativa basada en los datos disponibles de cada fragancia.</p></div><div class="product-grid perfume-product-grid perfume-concierge-grid">' + recommendations.map(renderCard).join("") + '</div>';
    const grid = conciergeResults.querySelector(".perfume-concierge-grid");
    grid?.addEventListener("click", event => {
      const target = event.target instanceof Element ? event.target : null;
      const link = target?.closest("a[data-details]");
      if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const product = recommendations.find(item => String(item.id) === String(link.dataset.details));
      if (!product) return;
      event.preventDefault();
      persistConciergeSelection(true);
      const scrollY = window.scrollY;
      window.history.replaceState({ ...(window.history.state || {}), catalogScrollY: scrollY }, document.title, window.location.href);
      window.history.pushState({ productDetailRoute: true, catalogScrollY: scrollY, productId: String(product.id) }, document.title, productLink(product));
      openPerfume(product);
    });
    grid?.querySelectorAll("a[data-details]").forEach(viewLink => {
      const product = recommendations.find(item => String(item.id) === String(viewLink.dataset.details));
      if (!product) return;
      const actions = viewLink.closest(".product-actions");
      if (!actions) return;
      const contact = document.createElement("a");
      contact.className = "perfume-concierge-whatsapp";
      contact.href = whatsappLink(buildWhatsAppMessage(product, "quisiera consultar por esta recomendación personalizada."));
      contact.target = "_blank";
      contact.rel = "noopener";
      contact.textContent = "Consultar por WhatsApp";
      contact.addEventListener("click", () => recordEvent(product.id, "whatsapp_click"));
      actions.appendChild(contact);
    });
  });
}

void recordPerfumeCatalogPageVisit();
initializePerfumes();

/* JB PARFUMS · carrusel ligero: una imagen inicial y precarga de una sola foto. */
(() => {
  const carousel = document.querySelector("#perfume-hero-carousel");
  const stage = document.querySelector("#perfume-carousel-stage");
  const imageA = document.querySelector("#perfume-carousel-image-a");
  const imageB = document.querySelector("#perfume-carousel-image-b");
  const previousButton = document.querySelector("#perfume-carousel-previous");
  const nextButton = document.querySelector("#perfume-carousel-next");
  const countNode = document.querySelector("#perfume-carousel-count");
  const titleNode = document.querySelector("#perfume-carousel-title");
  const dotsNode = document.querySelector("#perfume-carousel-dots");
  const progressNode = document.querySelector("#perfume-carousel-progress");
  const progressFill = document.querySelector("#perfume-carousel-progress-fill");
  if (!carousel || !stage || !imageA || !imageB || !previousButton || !nextButton || !countNode || !titleNode || !dotsNode || !progressNode || !progressFill) return;

  const slides = [
    { src: "../img/perfume-showcase/supremacy-pour-femme.webp?v=20261025-carousel-photos2", title: "Afnan Supremacy Pour Femme", alt: "Fragancia Afnan Supremacy Pour Femme en presentación de frasco y caja", maxWidth: 280 },
    { src: "../img/perfume-showcase/creed-wind-flowers.webp?v=20261025-carousel-photos2", title: "Creed Wind Flowers", alt: "Fragancia Creed Wind Flowers en frasco rosa con su caja" },
    { src: "../img/perfume-showcase/la-bomba.webp?v=20261025-carousel-photos2", title: "Carolina Herrera La Bomba", alt: "Fragancia Carolina Herrera La Bomba con frasco en forma de mariposa y caja rosa", maxWidth: 270 },
    { src: "../img/perfume-showcase/afnan-9pm.webp?v=20261025-carousel-photos2", title: "Afnan 9 PM", alt: "Perfume Afnan 9 PM junto a su caja negra" },
    { src: "../img/perfume-showcase/afnan-9am.webp?v=20261025-carousel-photos2", title: "Afnan 9 AM Dive", alt: "Perfume Afnan 9 AM Dive en tonos turquesa" },
    { src: "../img/perfume-hero-qaed.webp?v=20261025-carousel-fix3", title: "Lattafa Qaed Al Fursan", alt: "Perfume Lattafa Qaed Al Fursan con caja negra y detalles dorados" },
    { src: "../img/perfume-showcase/pdm-oajan.webp?v=20261025-carousel-photos2", title: "Parfums de Marly Oajan", alt: "Perfume Parfums de Marly Oajan en frasco oscuro y caja negra" },
    { src: "../img/perfume-showcase/creed-absolu-aventus.webp?v=20261025-carousel-photos2", title: "Creed Absolu Aventus", alt: "Frasco oscuro Creed Absolu Aventus" },
    { src: "../img/perfume-showcase/dior-sauvage.webp?v=20261025-carousel-photos2", title: "Dior Sauvage", alt: "Perfume Dior Sauvage acompañado por su caja" },
    { src: "../img/perfume-showcase/mandarin-sky.webp?v=20261025-carousel-photos2", title: "Afnan Odyssey Mandarin Sky", alt: "Perfume Afnan Odyssey Mandarin Sky con frasco azul y caja naranja" },
    { src: "../img/perfume-showcase/valentino-born-in-roma-intense.webp?v=20261025-carousel-photos2", title: "Valentino Born in Roma Intense Uomo", alt: "Perfume Valentino Born in Roma Intense Uomo en un ambiente oscuro", maxWidth: 240 }
  ];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const layers = [imageA, imageB];
  const cache = new Map();
  let currentIndex = 0;
  let activeLayer = 0;
  let changing = false;
  let autoplayTimer = 0;
  let preloadTimer = 0;
  let paused = false;
  let touchStart = null;

  function wrapIndex(index) {
    return (index + slides.length) % slides.length;
  }

  function preload(index) {
    index = wrapIndex(index);
    if (cache.has(index)) return cache.get(index);
    const promise = new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = async () => {
        try { if (image.decode) await image.decode(); } catch (_) {}
        resolve(image);
      };
      image.onerror = () => {
        cache.delete(index);
        reject(new Error("No se pudo cargar la fotografía " + slides[index].title));
      };
      image.src = slides[index].src;
    });
    cache.set(index, promise);
    return promise;
  }

  function renderDots() {
    Array.from(dotsNode.querySelectorAll("button")).forEach((button, index) => {
      const active = index === currentIndex;
      button.setAttribute("aria-current", active ? "true" : "false");
      button.setAttribute("aria-label", "Mostrar fragancia " + (index + 1) + ": " + slides[index].title);
    });
  }

  function renderCaption() {
    countNode.innerHTML = String(currentIndex + 1).padStart(2, "0") + ' <i aria-hidden="true">/</i> ' + String(slides.length).padStart(2, "0");
    titleNode.textContent = slides[currentIndex].title;
    progressNode.setAttribute("aria-valuemax", String(slides.length));
    progressNode.setAttribute("aria-valuenow", String(currentIndex + 1));
    progressFill.style.width = ((currentIndex + 1) / slides.length * 100).toFixed(2) + "%";
    renderDots();
  }

  function clearTimers() {
    if (autoplayTimer) window.clearTimeout(autoplayTimer);
    if (preloadTimer) window.clearTimeout(preloadTimer);
    autoplayTimer = 0;
    preloadTimer = 0;
  }

  function scheduleNextPreload() {
    if (preloadTimer) window.clearTimeout(preloadTimer);
    preloadTimer = window.setTimeout(() => {
      preload(wrapIndex(currentIndex + 1)).catch(() => {});
    }, 1100);
  }

  function scheduleAutoplay() {
    if (autoplayTimer) window.clearTimeout(autoplayTimer);
    autoplayTimer = 0;
    if (paused || reduceMotion.matches || document.hidden || changing) return;
    autoplayTimer = window.setTimeout(async () => {
      await showSlide(currentIndex + 1, false);
      scheduleAutoplay();
    }, 5600);
  }

  async function showSlide(index, fromUser) {
    index = wrapIndex(index);
    if (index === currentIndex || changing) return;
    changing = true;
    if (fromUser) {
      if (autoplayTimer) window.clearTimeout(autoplayTimer);
      autoplayTimer = 0;
    }
    const target = slides[index];
    const incomingLayerIndex = 1 - activeLayer;
    const incoming = layers[incomingLayerIndex];
    const outgoing = layers[activeLayer];
    try {
      await preload(index);
      incoming.onload = null;
      incoming.onerror = null;
      incoming.src = target.src;
      incoming.alt = target.alt;
      incoming.style.maxWidth = target.maxWidth ? target.maxWidth + "px" : "";
      incoming.removeAttribute("aria-hidden");
      try { if (incoming.decode) await incoming.decode(); } catch (_) {}
      incoming.classList.add("is-active");
      outgoing.classList.remove("is-active");
      outgoing.setAttribute("aria-hidden", "true");
      currentIndex = index;
      activeLayer = incomingLayerIndex;
      renderCaption();
      changing = false;
      scheduleNextPreload();
      scheduleAutoplay();
    } catch (error) {
      changing = false;
      carousel.dataset.loadError = "true";
      scheduleAutoplay();
      console.warn("JB Parfums: no se pudo cargar una imagen del carrusel.", error);
    }
  }

  slides.forEach((slide, index) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.setAttribute("aria-current", index === 0 ? "true" : "false");
    dot.setAttribute("aria-label", "Mostrar fragancia " + (index + 1) + ": " + slide.title);
    dot.addEventListener("click", () => showSlide(index, true));
    dotsNode.appendChild(dot);
  });

  previousButton.addEventListener("click", () => showSlide(currentIndex - 1, true));
  nextButton.addEventListener("click", () => showSlide(currentIndex + 1, true));
  carousel.addEventListener("mouseenter", () => { paused = true; clearTimers(); });
  carousel.addEventListener("mouseleave", () => { paused = false; scheduleNextPreload(); scheduleAutoplay(); });
  carousel.addEventListener("focusin", () => { paused = true; clearTimers(); });
  carousel.addEventListener("focusout", event => {
    if (!carousel.contains(event.relatedTarget)) {
      paused = false;
      scheduleNextPreload();
      scheduleAutoplay();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearTimers();
    else { scheduleNextPreload(); scheduleAutoplay(); }
  });
  if (reduceMotion.addEventListener) {
    reduceMotion.addEventListener("change", () => scheduleAutoplay());
  }
  stage.addEventListener("touchstart", event => {
    const touch = event.changedTouches && event.changedTouches[0];
    if (touch) touchStart = { x: touch.clientX, y: touch.clientY };
  }, { passive: true });
  stage.addEventListener("touchend", event => {
    const touch = event.changedTouches && event.changedTouches[0];
    if (!touch || !touchStart) return;
    const dx = touch.clientX - touchStart.x;
    const dy = touch.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.25) {
      showSlide(currentIndex + (dx < 0 ? 1 : -1), true);
    }
  }, { passive: true });
  carousel.addEventListener("keydown", event => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      showSlide(currentIndex - 1, true);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      showSlide(currentIndex + 1, true);
    }
  });

  imageA.style.maxWidth = slides[0].maxWidth ? slides[0].maxWidth + "px" : "";
  renderCaption();
  scheduleNextPreload();
  scheduleAutoplay();
})();
