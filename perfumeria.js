import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const CONFIG = window.CATALOG_CONFIG || {};
const $ = selector => document.querySelector(selector);
const whatsappNumber = String(CONFIG.whatsappNumber || "").replace(/\D/g, "");
const grid = $("#product-grid");
const statusNode = $("#catalog-status");
const emptyNode = $("#empty-results");
const searchInput = $("#perfume-search-input");
const categoryFilters = $("#category-filters");
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
const dialog = $("#perfume-dialog");
const dialogContent = $("#perfume-dialog-content");

let supabase = null;
let perfumes = [];
let selectedFamily = "all";

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

function familyMatches(product, family) {
  return family === "all" || normalizeText(product.perfume_details?.family) === family;
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

function priceBound(input) {
  const raw = String(input?.value || "").trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function hasActiveFilters() {
  return Boolean(
    (searchInput?.value || "").trim() ||
    selectedFamily !== "all" ||
    priceBound(minPriceInput) !== null ||
    priceBound(maxPriceInput) !== null
  );
}

function productLink(product) {
  const url = new URL("./", window.location.href);
  url.hash = "fragancia=" + encodeURIComponent(product.id);
  return url.href;
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
    "Fragancia: " + String(product.name || "sin nombre") + ".",
    product.brand ? "Marca: " + product.brand + "." : "",
    "Familia: " + family + ".",
    concentration ? "Concentración: " + concentration + "." : "",
    volume ? "Presentación: " + volume + "." : "",
    product.price_usd !== null && product.price_usd !== undefined ? "Precio: " + formatUSD(product.price_usd) + "." : "",
    priceNio ? "Precio en córdobas: " + priceNio + "." : "",
    "Disponibilidad: " + statusLabel(product.availability) + ".",
    "Enlace: " + productLink(product) + "."
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
  const image = imageMarkup(product);
  const badge = product.featured ? '<span class="perfume-featured-badge">✦ DESTACADO</span>' : "";
  const state = statusLabel(product.availability);
  const stateBadge = state === "Disponible" ? "" : '<span class="perfume-state-badge">' + escapeHtml(state) + '</span>';
  const nio = formatNIO(product.price_nio);

  return '<article class="product-card perfume-product-card' + (product.featured ? ' featured-product-card' : '') + '">' +
    '<div class="product-image perfume-product-image">' + badge + stateBadge + image + '</div>' +
    '<div class="product-card-content perfume-product-card-content">' +
      '<p class="perfume-card-family">' + escapeHtml(family) + '</p>' +
      '<h3>' + escapeHtml(product.name || "Fragancia sin nombre") + '</h3>' +
      (product.brand ? '<p class="perfume-card-brand">' + escapeHtml(product.brand) + '</p>' : '') +
      '<div class="perfume-product-meta">' + [concentration, volume, detail.audience].filter(Boolean).map(escapeHtml).join('<span aria-hidden="true">·</span>') + '</div>' +
      (detail.scent_family ? '<p class="perfume-card-scent">' + escapeHtml(detail.scent_family) + '</p>' : '') +
      '<div class="perfume-price-label">' + 'Precio' + '</div>' +
      '<div class="perfume-product-price">' + escapeHtml(formatUSD(product.price_usd)) + '</div>' +
      (nio ? '<p class="perfume-product-price-secondary">' + escapeHtml(nio) + '</p>' : '') +
      '<div class="product-actions"><a class="button perfume-view-button" href="' + escapeHtml(productLink(product)) + '" data-details="' + escapeHtml(product.id) + '">Ver fragancia <span aria-hidden="true">↗</span></a></div>' +
    '</div>' +
  '</article>';
}

function visibleProducts() {
  const query = normalizeText(searchInput?.value);
  const min = priceBound(minPriceInput);
  const max = priceBound(maxPriceInput);
  const validRange = min === null || max === null || min <= max;
  if (priceFeedback) priceFeedback.textContent = validRange ? "" : "El mínimo no puede superar al máximo.";
  if (!validRange) return [];

  return perfumes.filter(product => {
    if (!familyMatches(product, selectedFamily)) return false;
    const detail = product.perfume_details || {};
    const searchable = [
      product.name, product.brand, product.model, product.description,
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
  if (emptyTitle) emptyTitle.textContent = isComingSoon ? "Próximamente" : "No encontramos esa fragancia";
  if (emptyDescription) {
    emptyDescription.textContent = isComingSoon
      ? "Estamos preparando nuestra selección de fragancias. Volvé pronto para descubrirla."
      : "Probá con otra búsqueda, familia o rango de precio.";
  }
  statusNode.textContent = perfumes.length
    ? (filtering
      ? matched.length + (matched.length === 1 ? " fragancia encontrada" : " fragancias encontradas")
      : perfumes.length + (perfumes.length === 1 ? " fragancia publicada" : " fragancias publicadas") + (featured.length ? " · " + featured.length + " destacadas" : ""))
    : "Próximamente: estamos preparando la colección.";
  if (clearPriceButton) clearPriceButton.disabled = priceBound(minPriceInput) === null && priceBound(maxPriceInput) === null;
  categoryFilters.querySelectorAll("[data-category]").forEach(button => {
    const active = button.dataset.category === selectedFamily;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
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
  const concentration = String(detail.concentration || "").trim();
  const volume = detail.volume_ml ? Number(detail.volume_ml).toLocaleString("es-NI") + " ml" : "No especificado";
  const nio = formatNIO(product.price_nio);
  const hasOlfactoryNotes = [detail.top_notes, detail.heart_notes, detail.base_notes]
    .some(values => Array.isArray(values) && values.some(value => String(value || "").trim()));
  dialogContent.dataset.productId = String(product.id);
  recordEvent(product.id, "view");

  const gallery = initialImage
    ? '<div class="perfume-dialog-main-image"><img id="perfume-dialog-main-image" src="' + escapeHtml(initialImage) + '" alt="' + escapeHtml(product.name) + '" loading="eager"></div>' +
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
        '<p class="perfume-kicker">' + escapeHtml(family) + '</p>' +
        '<h2>' + escapeHtml(product.name || "Fragancia") + '</h2>' +
        (product.brand ? '<p class="perfume-dialog-brand">' + escapeHtml(product.brand) + '</p>' : '') +
        '<p class="perfume-dialog-description">' + escapeHtml(product.description || "Consultá por las notas y características de esta fragancia.") + '</p>' +
        '<dl class="perfume-dialog-facts">' +
          (concentration ? '<div><dt>Concentración</dt><dd>' + escapeHtml(concentration) + '</dd></div>' : '') +
          (detail.volume_ml ? '<div><dt>Contenido</dt><dd>' + escapeHtml(volume) + '</dd></div>' : '') +
          (detail.audience ? '<div><dt>Público</dt><dd>' + escapeHtml(detail.audience) + '</dd></div>' : '') +
          '<div><dt>Disponibilidad</dt><dd>' + escapeHtml(statusLabel(product.availability)) + '</dd></div>' +
          (detail.is_original === true ? '<div><dt>Originalidad</dt><dd>Original confirmado</dd></div>' : '') +
          (detail.scent_family ? '<div><dt>Familia olfativa</dt><dd>' + escapeHtml(detail.scent_family) + '</dd></div>' : '') +
        '</dl>' +
        '<div class="perfume-dialog-price"><span>Precio</span><strong>' + escapeHtml(formatUSD(product.price_usd)) + '</strong>' + (nio ? '<small>' + escapeHtml(nio) + '</small>' : '') + '</div>' +
        '<div class="perfume-dialog-actions">' +
          '<a id="perfume-buy-link" class="perfume-primary-link" href="' + escapeHtml(whatsappLink(buildWhatsAppMessage(product, "quiero comprar esta fragancia."))) + '" target="_blank" rel="noopener">Quiero comprarla <span aria-hidden="true">↗</span></a>' +
          '<a id="perfume-question-link" class="perfume-outline-link" href="' + escapeHtml(whatsappLink(buildWhatsAppMessage(product, "quisiera consultar las opciones de financiamiento o pago con tarjeta de crédito para esta fragancia."))) + '" target="_blank" rel="noopener">Consultar financiamiento o tarjeta</a>' +
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
  if (typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
  } else {
    dialog.setAttribute("open", "open");
  }
}

function loadDeepLink() {
  const match = window.location.hash.match(/^#fragancia=(.+)$/);
  if (!match) return;
  let id = match[1];
  try { id = decodeURIComponent(id); } catch { /* Mantener ID original */ }
  const product = perfumes.find(item => String(item.id) === id);
  if (product) {
    openPerfume(product);
  } else {
    statusNode.textContent = "La fragancia solicitada no está publicada o el enlace ya no es válido.";
  }
}

categoryFilters.addEventListener("click", event => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  selectedFamily = button.dataset.category || "all";
  renderProducts();
});
searchInput.addEventListener("input", renderProducts);
minPriceInput.addEventListener("input", renderProducts);
maxPriceInput.addEventListener("input", renderProducts);
clearPriceButton.addEventListener("click", () => {
  minPriceInput.value = "";
  maxPriceInput.value = "";
  renderProducts();
});

document.querySelectorAll("#product-grid, #featured-grid").forEach(productGrid => {
  productGrid.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    const link = target?.closest("a[data-details]");
    if (!link) return;
    const id = link.getAttribute("data-details");
    const product = perfumes.find(item => String(item.id) === id);
    if (!product) return;
    event.preventDefault();
    const url = productLink(product);
    if (window.location.hash !== "#fragancia=" + encodeURIComponent(product.id)) {
      window.history.pushState(window.history.state, document.title, url);
    }
    openPerfume(product);
  });
});

dialogContent.addEventListener("click", event => {
  const target = event.target instanceof Element ? event.target : null;
  const link = target?.closest('a[href*="wa.me"]');
  if (link) recordEvent(dialogContent.dataset.productId, "whatsapp_click");

  const thumb = target?.closest("[data-gallery-image]");
  if (!thumb) return;
  const hero = $("#perfume-dialog-main-image");
  if (hero) hero.src = thumb.dataset.galleryImage;
  dialogContent.querySelectorAll("[data-gallery-image]").forEach(item => item.classList.toggle("active", item === thumb));
});

function closeDialog() {
  if (dialog.open && typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
  if (window.location.hash.startsWith("#fragancia=")) {
    window.history.replaceState(window.history.state, document.title, window.location.pathname + window.location.search);
  }
}
$("#perfume-dialog-close").addEventListener("click", closeDialog);
dialog.addEventListener("click", event => { if (event.target === dialog) closeDialog(); });
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
      .order("featured", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;

    const products = data || [];
    if (!products.length) {
      perfumes = [];
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
    renderProducts();
    loadDeepLink();
  } catch (error) {
    statusNode.textContent = "No pudimos cargar las fragancias. Revisá las políticas de lectura y la tabla de detalles de Supabase.";
    grid.innerHTML = "";
    console.error("Error al consultar el catálogo de perfumería:", error);
  }
}

initializePerfumes();