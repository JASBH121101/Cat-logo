import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const CONFIG = window.CATALOG_CONFIG || {};
const $ = selector => document.querySelector(selector);
const whatsappNumber = String(CONFIG.whatsappNumber || "").replace(/\D/g, "");
const grid = $("#product-grid");
const statusNode = $("#catalog-status");
const emptyNode = $("#empty-results");
const searchInput = $("#perfume-search-input");
const brandSearchInput = $("#perfume-brand-search-input");
const perfumeSortSelect = $("#perfume-sort-select");
const categoryFilters = $("#category-filters");
const audienceFilters = $("#audience-filters");
const productTypeFilters = $("#product-type-filters");
const clearAllFiltersButton = $("#clear-all-filters");
const filterSummary = $("#perfume-filter-summary");
const featuredSection = $("#featured-section");
const featuredGrid = $("#featured-grid");
const featuredCount = $("#featured-count");
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

const hasConfig = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
if (hasConfig) supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);

const yearNode = $("#perfume-year");
if (yearNode) yearNode.textContent = new Date().getFullYear();

const normalizeText = value => String(value || "").trim().toLocaleLowerCase("es");
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

function familyLabel(family) {
  return ({
    arabes:"Árabes",
    nicho:"Nicho",
    disenador:"Diseñador"
  })[normalizeText(family)] || "Perfumería";
}

function familyMatches(product) {
  return !selectedFamilies.size || selectedFamilies.has(normalizeText(product.perfume_details?.family));
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
  return "US$" + new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(price);
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

function refreshBrandSuggestions() {
  const list = document.getElementById("perfume-brand-suggestions");
  if (!list) return;
  const brands = [...new Set(perfumes
    .map(product => String(product.brand || "").trim())
    .filter(Boolean))].sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
  list.replaceChildren(...brands.map(brand => {
    const option = document.createElement("option");
    option.value = brand;
    return option;
  }));
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
    (brandSearchInput?.value || "").trim() ||
    (perfumeSortSelect?.value || "recent") !== "recent" ||
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
  const currentHost = window.location.hostname.toLocaleLowerCase();
  const shareOrigin = currentHost.endsWith(".github.io")
    ? "https://cat-logo-preview.vercel.app"
    : window.location.origin;
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

async function recordEvent(productId, eventType) {
  if (!supabase || !productId || !["view","whatsapp_click"].includes(eventType)) return;
  try {
    const { error } = await supabase.from("catalog_events").insert({
      product_id: productId,
      event_type: eventType,
      variant_color: null,
      variant_ram: null,
      variant_storage: null
    });
    if (error) console.info("La analítica no está disponible:", error.message);
  } catch (error) {
    console.info("La analítica no está disponible.", error);
  }
}

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
  const badge = product.featured ? '<span class="perfume-featured-badge">✦ DESTACADO</span>' : "";
  const state = statusLabel(product.availability);
  const stateBadge = state === "Disponible" ? "" : '<span class="perfume-state-badge">' + escapeHtml(state) + '</span>';
  const nio = formatNIO(product.price_nio);

  return '<article class="product-card perfume-product-card' + (product.featured ? ' featured-product-card' : '') + '">' +
    '<div class="product-image perfume-product-image">' + badge + stateBadge + image + '</div>' +
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
  const query = normalizeText(searchInput?.value);
  const brandQuery = normalizeText(brandSearchInput?.value);
  const min = priceBound(minPriceInput);
  const max = priceBound(maxPriceInput);
  const validRange = min === null || max === null || min <= max;
  if (priceFeedback) priceFeedback.textContent = validRange ? "" : "El mínimo no puede superar al máximo.";
  if (!validRange) return [];

  return perfumes.filter(product => {
    if (!familyMatches(product) || !audienceMatches(product) || !productTypeMatches(product)) return false;
    if (brandQuery && !normalizeText(product.brand).startsWith(brandQuery)) return false;
    const detail = product.perfume_details || {};
    const searchable = [
      product.name, product.brand, product.model, product.description, product.product_type,
      detail.family, detail.concentration, detail.volume_ml, detail.audience, detail.scent_family,
      ...(Array.isArray(detail.top_notes) ? detail.top_notes : []),
      ...(Array.isArray(detail.heart_notes) ? detail.heart_notes : []),
      ...(Array.isArray(detail.base_notes) ? detail.base_notes : [])
    ].join(" ").toLocaleLowerCase("es");
    if (query && !searchable.includes(query)) return false;
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
  const matched = visibleProducts();
  const filtering = hasActiveFilters();
  const featured = filtering ? [] : matched.filter(product => Boolean(product.featured));
  const regular = filtering ? matched : matched.filter(product => !product.featured);

  featuredSection.classList.toggle("hidden", featured.length === 0);
  featuredGrid.innerHTML = featured.map(renderCard).join("");
  featuredCount.textContent = featured.length ? featured.length + (featured.length === 1 ? " fragancia" : " fragancias") : "";
  resultsHeading.classList.toggle("hidden", perfumes.length === 0 || (!filtering && regular.length === 0));
  resultsEyebrow.textContent = filtering ? "RESULTADOS" : "DESCUBRÍ";
  resultsTitle.textContent = filtering ? "Fragancias para vos" : "Toda la colección";
  grid.innerHTML = regular.map(renderCard).join("");
  const isComingSoon = perfumes.length === 0;
  emptyNode.classList.toggle("hidden", matched.length > 0);
  emptyNode.classList.toggle("is-coming-soon", isComingSoon);
  const emptyTitle = emptyNode.querySelector("h3");
  const emptyDescription = emptyNode.querySelector("p");
  if (emptyTitle) emptyTitle.textContent = isComingSoon ? "Próximamente" : "No encontramos ese producto";
  if (emptyDescription) {
    emptyDescription.textContent = isComingSoon
      ? "Estamos preparando nuestra selección de fragancias. Volvé pronto para descubrirla."
      : "Probá con otro nombre, formato, familia, género o rango de precio.";
  }
  statusNode.textContent = perfumes.length
    ? (filtering
      ? matched.length + (matched.length === 1 ? " producto encontrado" : " productos encontrados")
      : perfumes.length + (perfumes.length === 1 ? " producto publicado" : " productos publicados") + (featured.length ? " · " + featured.length + " destacadas" : ""))
    : "Próximamente: estamos preparando la colección.";
  if (clearPriceButton) clearPriceButton.disabled = priceBound(minPriceInput) === null && priceBound(maxPriceInput) === null;
  updateFilterButtons(categoryFilters, "category", selectedFamilies);
  updateFilterButtons(audienceFilters, "audience", selectedAudiences);
  updateFilterButtons(productTypeFilters, "productType", selectedProductTypes);
  const familyLabels = [...selectedFamilies].map(value => ({arabes:"Árabes",nicho:"Nicho",disenador:"Diseñador"})[value] || value);
  const audienceLabels = [...selectedAudiences].map(value => ({hombre:"Hombre",mujer:"Mujer",unisex:"Unisex"})[value] || value);
  const productTypeLabels = [...selectedProductTypes].map(value => ({perfume:"Perfumes y fragancias",set:"Sets de perfumes"})[value] || value);
  if (filterSummary) filterSummary.textContent = [productTypeLabels.length ? productTypeLabels.join(" + ") : "Todos los formatos", familyLabels.length ? familyLabels.join(" + ") : "Todas las familias", audienceLabels.length ? audienceLabels.join(" + ") : "Todos los géneros"].join(" · ");
  if (clearAllFiltersButton) clearAllFiltersButton.disabled = !hasActiveFilters();
}

function notesSection(title, values) {
  const items = Array.isArray(values) ? values.filter(Boolean) : [];
  if (!items.length) return "";
  return '<section class="perfume-note-group"><h3>' + title + '</h3>' +
    '<ul>' + items.map(item => '<li>' + escapeHtml(item) + '</li>').join("") + '</ul>' +
    '</section>';
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
          (detail.is_original === true ? '<div><dt>Originalidad</dt><dd>Original confirmado</dd></div>' : '') +
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
  perfumeDetailPage?.classList.remove("hidden");
  if (perfumeHeaderBack) perfumeHeaderBack.hidden = false;
  document.querySelector("main")?.classList.add("is-perfume-detail-view");
  document.body.classList.add("perfume-detail-active");
  document.title = `${product.name || "Fragancia"} | JB Parfums`;
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) canonical.href = productLink(product);
  window.scrollTo({ top: 0, behavior: "auto" });
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
  document.title = catalogDocumentTitle;
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical && catalogCanonical) canonical.href = catalogCanonical;
  if (dialogContent) dialogContent.innerHTML = "";
}

function loadDeepLink() {
  const route = readPerfumeRoute();
  if (!route.id) {
    const wasDetail = document.body.classList.contains("perfume-detail-active");
    const scrollY = Number(window.history.state?.catalogScrollY) || 0;
    showPerfumeCatalog();
    if (wasDetail) window.scrollTo({ top: scrollY, behavior: "auto" });
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
    else if (selectedSet.has(value)) selectedSet.delete(value);
    else selectedSet.add(value);
    renderProducts();
  });
}
bindMultiSelect(categoryFilters, "category", selectedFamilies);
bindMultiSelect(audienceFilters, "audience", selectedAudiences);
bindMultiSelect(productTypeFilters, "productType", selectedProductTypes);
searchInput.addEventListener("input", renderProducts);
brandSearchInput?.addEventListener("input", renderProducts);
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
  if (brandSearchInput) brandSearchInput.value = "";
  if (perfumeSortSelect) perfumeSortSelect.value = "recent";
  minPriceInput.value = "";
  maxPriceInput.value = "";
  renderProducts();
});

document.querySelectorAll("#product-grid, #featured-grid").forEach(productGrid => {
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

[grid, featuredGrid].forEach(container => container?.addEventListener("error", event => {
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

async function initializePerfumes() {
  if (!supabase) {
    statusNode.textContent = "No se pudo conectar con el catálogo. Verificá la configuración pública de Supabase.";
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
      refreshBrandSuggestions();
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
    refreshBrandSuggestions();
    renderProducts();
    loadDeepLink();
  } catch (error) {
    statusNode.textContent = "No pudimos cargar las fragancias. Revisá las políticas de lectura y la tabla de detalles de Supabase.";
    grid.innerHTML = "";
    console.error("Error al consultar el catálogo de perfumería:", error);
  }
}

initializePerfumes();