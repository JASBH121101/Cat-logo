import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const CONFIG = window.CATALOG_CONFIG || {};

// Selector breve usado por los controles de la ficha de producto.
const $ = selector => document.querySelector(selector);
const whatsappNumber = String(CONFIG.whatsappNumber || "").replace(/\D/g, "");

const grid = document.querySelector("#product-grid");
const statusNode = document.querySelector("#catalog-status");
const emptyNode = document.querySelector("#empty-results");
const searchInput = document.querySelector("#search-input");
const brandFilterToggle = document.querySelector("#brand-filter-toggle");
const brandFilterValue = document.querySelector("#brand-filter-value");
const brandFilterMenu = document.querySelector("#brand-filter-menu");
const brandFilterSearch = document.querySelector("#brand-filter-search");
const brandFilterOptions = document.querySelector("#brand-filter-options");
const catalogSortSelect = document.querySelector("#catalog-sort-select");
const productDetailPage = document.querySelector("#product-detail-page");
const productHeaderBack = document.querySelector("#product-detail-header-back");
const dialogContent = document.querySelector("#dialog-content");
const catalogDocumentTitle = document.title;
const catalogCanonical = document.querySelector('link[rel="canonical"]')?.href || "";
const categoryFilters = document.querySelector("#category-filters");
const subcategoryFilter = document.querySelector("#subcategory-filter");
const featuredSection = document.querySelector("#featured-section");
const featuredGrid = document.querySelector("#featured-grid");
const featuredCount = document.querySelector("#featured-count");
const limitedEditionSection = document.querySelector("#limited-edition-section");
const limitedEditionGrid = document.querySelector("#limited-edition-grid");
const limitedEditionCount = document.querySelector("#limited-edition-count");
const highPerformanceSection = document.querySelector("#high-performance-section");
const highPerformanceGrid = document.querySelector("#high-performance-grid");
const highPerformanceCount = document.querySelector("#high-performance-count");
const qualityPriceSection = document.querySelector("#quality-price-section");
const qualityPriceGrid = document.querySelector("#quality-price-grid");
const qualityPriceCount = document.querySelector("#quality-price-count");
const topGamingSection = document.querySelector("#top-gaming-section");
const topGamingGrid = document.querySelector("#top-gaming-grid");
const topGamingCount = document.querySelector("#top-gaming-count");
const resultsHeading = document.querySelector("#catalog-results-heading");
const resultsEyebrow = document.querySelector("#catalog-results-eyebrow");
const resultsTitle = document.querySelector("#catalog-results-title");
const minPriceInput = document.querySelector("#price-min-input");
const maxPriceInput = document.querySelector("#price-max-input");
const clearPriceFilterButton = document.querySelector("#clear-price-filter");
const priceFilterFeedback = document.querySelector("#budget-filter-feedback");

let supabase = null;
let products = [];
let selectedCategory = "all";
let selectedSubcategory = "";
let selectedBrand = "";


function isCatalogAdminActivityActive() {
  try {
    const timestamp = Number(window.localStorage.getItem("cat-logo-admin-activity-v1") || 0);
    return timestamp > 0 && Date.now() - timestamp < 180000;
  } catch {
    return false;
  }
}

// Analytics: record product views, WhatsApp intent and aggregate region metrics; never persist raw IP addresses.
let catalogVisitorLocationPromise = null;
async function getCatalogVisitorLocation() {
  if (!catalogVisitorLocationPromise) {
    catalogVisitorLocationPromise = fetch("/api/catalog-location", {
      method: "GET", credentials: "same-origin", cache: "no-store"
    }).then(response => response.ok ? response.json() : null)
      .then(value => ({
        country: typeof value?.country === "string" ? value.country.slice(0, 2).toUpperCase() : null,
        department: typeof value?.department === "string" ? value.department.slice(0, 80) : null
      }))
      .catch(() => ({ country: null, department: null }));
  }
  return catalogVisitorLocationPromise;
}

async function recordCatalogEvent(productId, eventType, variant = {}) {
  if (isCatalogAdminActivityActive() || !supabase || !productId || !["view", "whatsapp_click"].includes(eventType)) return;

  const cleanValue = value => {
    const normalized = String(value ?? "").trim();
    return normalized || null;
  };

  try {
    const visitor = await getCatalogVisitorLocation();
    const eventBase = {
      product_id: productId,
      event_type: eventType,
      variant_color: cleanValue(variant.color),
      variant_ram: cleanValue(variant.ram),
      variant_storage: cleanValue(variant.storage)
    };
    let { error } = await supabase.from("catalog_events").insert({
      ...eventBase,
      visitor_country: visitor.country,
      visitor_department: visitor.department
    });
    if (error && /visitor_(country|department)|schema cache|column .*does not exist/i.test(error.message || "")) {
      ({ error } = await supabase.from("catalog_events").insert(eventBase));
    }
    if (error) console.warn("No se pudo registrar el evento de analítica:", error.message);
  } catch (error) {
    console.warn("No se pudo registrar el evento de analítica.", error);
  }
}

async function recordCatalogPageVisit(catalogType) {
  if (!supabase || isCatalogAdminActivityActive()) return;
  try {
    const visitor = await getCatalogVisitorLocation();
    const { error } = await supabase.from("catalog_events").insert({
      product_id: null,
      event_type: "catalog_view",
      catalog_type,
      visitor_country: visitor.country,
      visitor_department: visitor.department
    });
    if (error && /catalog_view|catalog_type|visitor_(country|department)|schema cache|column .*does not exist/i.test(error.message || "")) {
      console.info("Las visitas generales empezarán a registrarse al aplicar la migración de analítica geográfica.");
      return;
    }
    if (error) console.info("No se pudo registrar la visita al catálogo:", error.message);
  } catch (error) {
    console.info("No se pudo registrar la visita al catálogo.", error);
  }
}

const hasSupabaseConfig = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);

if (hasSupabaseConfig) {
  supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
}

document.querySelector("#brand-name").textContent =
  CONFIG.storeName || "Catálogo de Tecnología";

document.querySelectorAll(".footer-brand span:last-child").forEach(element => {
  element.textContent = CONFIG.storeName || "Catálogo de Tecnología";
});

const footerText = document.querySelector(".site-footer p");
if (footerText) {
  footerText.textContent =
    "Precios sujetos a confirmación. Financiamiento sujeto a requisitos y condiciones de aprobación.";
}

const yearNode = document.querySelector("#year");
if (yearNode) yearNode.textContent = new Date().getFullYear();

function buildWhatsAppLink(message) {
  return `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;
}

const generalMessage =
  "Hola, vi el catálogo de JB TECH y quisiera consultar por disponibilidad, precio, entrega y opciones de pago.";

["header-whatsapp", "footer-whatsapp"].forEach(id => {
  const element = document.getElementById(id);
  if (!element) return;
  element.href = buildWhatsAppLink(generalMessage);
  element.target = "_blank";
  element.rel = "noopener";
});

const catalogHelpWhatsApp = document.getElementById("catalog-help-whatsapp");
if (catalogHelpWhatsApp) {
  catalogHelpWhatsApp.href = buildWhatsAppLink(
    "Hola, no encontré lo que buscaba en el catálogo de JB TECH. ¿Me pueden ayudar a encontrar una opción?"
  );
  catalogHelpWhatsApp.target = "_blank";
  catalogHelpWhatsApp.rel = "noopener";
}


function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}


function renderCommercialDescription(value, fallbackText) {
  const source = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!source) return '<p class="commercial-copy-empty">' + escapeHtml(fallbackText || "Consultá más información en la tienda.") + '</p>';

  const lines = source.split(/\n+/).map(line => line.trim()).filter(Boolean);
  const blocks = [];
  let bullets = [];
  const flushBullets = () => {
    if (!bullets.length) return;
    blocks.push('<ul class="commercial-copy-list">' + bullets.map(item => '<li>' + escapeHtml(item) + '</li>').join("") + '</ul>');
    bullets = [];
  };

  for (const rawLine of lines) {
    const parts = rawLine.split(/\s+[•●▪]\s+/).map(part => part.trim()).filter(Boolean);
    if (parts.length > 1) {
      flushBullets();
      if (!/^(?:[-*•●▪]|\d+[.)])\s+/.test(parts[0])) blocks.push('<p>' + escapeHtml(parts.shift()) + '</p>');
      for (const part of parts) bullets.push(part.replace(/^(?:[-*•●▪]|\d+[.)])\s+/, ""));
      continue;
    }
    const bulletMatch = rawLine.match(/^(?:[-*•●▪]|\d+[.)])\s+(.+)$/);
    if (bulletMatch) {
      bullets.push(bulletMatch[1]);
      continue;
    }
    flushBullets();
    const sentences = rawLine.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÜÑ¿¡0-9])/u).filter(Boolean);
    if (sentences.length > 1 && rawLine.length > 150) {
      sentences.forEach(sentence => blocks.push('<p>' + escapeHtml(sentence.trim()) + '</p>'));
    } else {
      blocks.push('<p>' + escapeHtml(rawLine) + '</p>');
    }
  }
  flushBullets();
  if (blocks.length && blocks[0].startsWith("<p>")) blocks[0] = blocks[0].replace("<p>", '<p class="commercial-copy-lead">');
  return '<div class="commercial-copy-blocks">' + blocks.join("") + '</div>';
}

function parseJSON(value, fallback) {
  if (typeof value !== "string") return value ?? fallback;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function validHex(value, fallback = "#315A91") {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || "")) ? value : fallback;
}

function normalizeProductAvailability(value) {
  const normalized = String(value || "").trim().toLocaleLowerCase("es");

  if (["out_of_stock", "agotado temporalmente", "agotado"].includes(normalized)) {
    return "out_of_stock";
  }

  if (["on_order", "por pedido"].includes(normalized)) {
    return "on_order";
  }

  return "available";
}

function productAvailabilityLabel(value) {
  const normalized = normalizeProductAvailability(value);

  if (normalized === "out_of_stock") return "Agotado";
  if (normalized === "on_order") return "Por pedido";
  return "Disponible";
}

function formatUSD(value) {
  if (value === null || value === undefined || value === "") {
    return "Consultar";
  }

  const number = Number(value);
  if (!Number.isFinite(number)) return "Consultar";

  return "US$" + new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2
  }).format(number);
}

function formatNIO(value) {
  if (value === null || value === undefined || value === "") return "";

  const number = Number(value);
  if (!Number.isFinite(number)) return "";

  return new Intl.NumberFormat("es-NI", {
    style: "currency",
    currency: "NIO",
    maximumFractionDigits: 2
  }).format(number);
}

function isGeneratedSpecificationLabel(label) {
  return /^dato(?:\s+\d+)?$/i.test(String(label || "").trim());
}

function cleanSpecificationLine(value) {
  let line = String(value ?? "").trim();
  line = line.replace(/^(?:(?:[•●▪◦]|\*|-\s)\s*)+/g, "");
  line = line.replace(/^Dato\s*\d+\s*:\s*/i, "");
  line = line.replace(/^\s*\d+\s*[.):\-]\s*/, "");
  line = line.replace(/^(?:(?:[•●▪◦]|\*|-\s)\s*)+/g, "");
  return line.trim();
}

function specsArray(specs) {
  specs = parseJSON(specs, {});
  if (!specs) return [];

  let lines = [];
  if (Array.isArray(specs)) {
    lines = specs.map(item => {
      if (typeof item === "string") return String(item ?? "").trim();
      if (item && typeof item === "object") {
        const label = String(item.label || item.name || "").trim();
        const value = String(item.value || "").trim();
        return !label || isGeneratedSpecificationLabel(label) ? value : `${label}: ${value}`;
      }
      return String(item ?? "").trim();
    }).filter(Boolean);
  } else if (typeof specs === "object") {
    lines = Object.entries(specs)
      .map(([key, value]) => isGeneratedSpecificationLabel(key)
        ? String(value ?? "").trim()
        : `${key}: ${String(value ?? "").trim()}`)
      .filter(Boolean);
  } else {
    return [];
  }

  // Older JB TECH entries were saved with explicit sequence numbers. Sort by that
  // original sequence, then hide the implementation numbers in the customer UI.
  const numbered = lines.filter(line => /^\s*\d+\s*[.):\-]\s*/.test(line));
  if (numbered.length === lines.length && lines.length > 1) {
    lines = lines
      .map((line, index) => ({ line, index, order: Number(line.match(/^\s*(\d+)\s*[.):\-]\s*/)?.[1]) }))
      .sort((left, right) => left.order - right.order || left.index - right.index)
      .map(item => item.line);
  }
  return lines.map(cleanSpecificationLine).filter(Boolean);
}

function getProductImages(product) {
  const images = parseJSON(product?.images, []);
  const list = Array.isArray(images) ? images : [];

  return [...new Set([...list, product?.image_url]
    .filter(value => typeof value === "string")
    .map(value => value.trim())
    .filter(Boolean))];
}

function normalizeVariantAvailability(value) {
  const normalized = String(value || "").trim().toLocaleLowerCase("es");
  if (["order", "on_order", "por pedido"].includes(normalized)) return "order";
  if (["out_of_stock", "unavailable", "no disponible", "agotado", "agotado temporalmente"].includes(normalized)) {
    return "out_of_stock";
  }
  return "available";
}

function effectiveVariantAvailability(variant) {
  const colorStatus = normalizeVariantAvailability(variant?.availability);
  const configurationStatus = normalizeVariantAvailability(variant?.configuration_availability);
  if (colorStatus === "out_of_stock" || configurationStatus === "out_of_stock") return "out_of_stock";
  if (colorStatus === "order" || configurationStatus === "order") return "order";
  return "available";
}

function getProductVariants(product) {
  const raw = parseJSON(product?.variants, []);
  if (!Array.isArray(raw)) return [];

  return raw.map(item => {
    if (!item || typeof item !== "object") return null;

    const usd =
      item.price_usd === "" || item.price_usd === undefined || item.price_usd === null
        ? null : Number(item.price_usd);

    const nio =
      item.price_nio === "" || item.price_nio === undefined || item.price_nio === null
        ? null : Number(item.price_nio);

    return {
      storage: String(item.storage || item.capacity || "").trim(),
      ram: String(item.ram || "").trim(),
      color: String(item.color || item.name || "").trim(),
      color_hex: validHex(item.color_hex || item.hex),
      price_usd: Number.isFinite(usd) ? usd : null,
      price_nio: Number.isFinite(nio) ? nio : null,
      availability: normalizeVariantAvailability(item.availability),
      configuration_availability: normalizeVariantAvailability(item.configuration_availability),
      images: (() => {
        const legacyImage = String(item.image_url || item.imageUrl || "").trim();
        const storedImages = Array.isArray(item.images)
          ? [...new Set(item.images
              .filter(url => typeof url === "string")
              .map(url => url.trim())
              .filter(Boolean))]
          : [];
        return storedImages.length ? storedImages : (legacyImage ? [legacyImage] : []);
      })(),
      image_url: (() => {
        const legacyImage = String(item.image_url || item.imageUrl || "").trim();
        const firstStoredImage = Array.isArray(item.images)
          ? item.images.find(url => typeof url === "string" && url.trim())
          : "";
        return String(firstStoredImage || legacyImage).trim();
      })()
    };
  }).filter(item => item && (item.storage || item.ram || item.color))
    .sort((left, right) => {
      const dimension = value => {
        const text = String(value || "").trim();
        const match = text.match(/[0-9]+(?:[.,][0-9]+)?/);
        if (!match) return Number.POSITIVE_INFINITY;
        const amount = Number(match[0].replace(",", "."));
        return /\bTB\b/i.test(text) ? amount * 1000 : amount;
      };
      const storageDiff = dimension(left.storage) - dimension(right.storage);
      if (storageDiff) return storageDiff;
      const ramDiff = dimension(left.ram) - dimension(right.ram);
      if (ramDiff) return ramDiff;
      return left.color.localeCompare(right.color, "es");
    });
}

function colorStatusLabel(value) {
  return value === "order" || value === "on_order" ? "Bajo pedido" : value === "out_of_stock" ? "No disponible" : "Disponible";
}

function getProductColors(product, configuration = null) {
  const variants = getProductVariants(product);

  if (variants.length) {
    const scopedVariants = configuration
      ? variants.filter(variant =>
          variant.storage === configuration.storage &&
          variant.ram === configuration.ram
        )
      : variants;
    const map = new Map();

    scopedVariants.forEach(variant => {
      const key = variant.color.toLocaleLowerCase("es");
      if (!key) return;

      const previous = map.get(key);

      if (!previous) {
        map.set(key, {
          name: variant.color,
          type: effectiveVariantAvailability(variant),
          image_url: variant.image_url,
          color_hex: variant.color_hex
        });
      } else {
        const currentStatus = effectiveVariantAvailability(variant);
        if (currentStatus === "available") {
          previous.type = "available";
        } else if (currentStatus === "order" && previous.type !== "available") {
          previous.type = "order";
        }
        if (!previous.image_url && variant.image_url) {
          previous.image_url = variant.image_url;
        }
      }
    });

    return [...map.values()];
  }

  const colors = parseJSON(product?.colors, []);
  if (!Array.isArray(colors)) return [];

  return colors.map(color => {
    if (typeof color === "string") {
      return {
        name: color.trim(),
        type: "available",
        image_url: "",
        color_hex: "#315A91"
      };
    }

    if (!color || typeof color !== "object") return null;

    return {
      name: String(color.name || color.color || "").trim(),
      type: normalizeVariantAvailability(color.type),
      image_url: String(color.image_url || color.imageUrl || "").trim(),
      color_hex: validHex(color.color_hex || color.hex)
    };
  }).filter(color => color && color.name);
}

function displayColorHex(name, hex) {
  const normalized = String(name || "").toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const inferred = [
    [/negro|black|onyx|phantom|graphite|grafito|carbon|obsidian/, "#20242d"],
    [/blanco|white|pearl|perla|ivory|marfil/, "#f3f4f6"],
    [/silver|plata|plateado|gris|gray|grey|titanium silver/, "#aeb7c4"],
    [/azul|blue|navy|ocean|cobalt|celeste/, "#3568d4"],
    [/verde|green|mint|menta|emerald/, "#2f9567"],
    [/rojo|red|coral|burgundy|vino/, "#c8424b"],
    [/rosa|pink|rose/, "#e78cae"],
    [/morado|purple|violet|violeta|lavender|lila/, "#8a65c7"],
    [/dorado|gold|champagne/, "#c8a34f"],
    [/beige|cream|crema/, "#d9c9a8"],
    [/naranja|orange/, "#e77a35"],
    [/cafe|brown|marron/, "#80583f"]
  ];
  if (!hex || String(hex).toUpperCase() === "#315A91") {
    const match = inferred.find(([pattern]) => pattern.test(normalized));
    if (match) return match[1];
  }
  return validHex(hex);
}

function renderProductColorSwatches(product, configuration = null) {
  const colors = getProductColors(product, configuration)
    .filter(color => color.name && color.type !== "out_of_stock");
  if (!colors.length) return "";

  const visible = colors.slice(0, 6).map(color => {
    const hex = displayColorHex(color.name, color.color_hex);
    const status = color.type === "order" ? "Disponible por pedido" : "Disponible";
    return `
      <span class="product-card-color-option"
            title="${escapeHtml(color.name)} · ${status}">
        <span class="product-card-color-swatch"
              role="img"
              aria-label="${escapeHtml(color.name)}"
              style="--swatch-color: ${hex}"></span>
        <span class="product-card-color-name">${escapeHtml(color.name)}</span>
      </span>
    `;
  }).join("");
  const more = colors.length > 6
    ? `<span class="product-card-color-more" aria-label="${colors.length - 6} colores más">+${colors.length - 6}</span>`
    : "";

  return `
    <div class="product-card-colors" aria-label="Colores disponibles">
      <span class="product-card-colors-label">Colores disponibles</span>
      <div class="product-card-color-list" role="group" aria-label="Colores disponibles">${visible}${more}</div>
    </div>
  `;
}

function renderColorSummary(product) {
  const colors = getProductColors(product);
  if (!colors.length) return "";

  const visible = colors.slice(0, 4).map(color => `
    <span class="product-color-chip">
      ${
        color.image_url
          ? `<img src="${escapeHtml(color.image_url)}" alt="" loading="lazy" onerror="this.style.display='none'">`
          : `<span class="product-color-dot" style="background:${validHex(color.color_hex)}" aria-hidden="true"></span>`
      }
      ${escapeHtml(color.name)}
      ${color.type === "order" ? "<small>Por pedido</small>" : ""}
    </span>
  `).join("");

  const more = colors.length > 4
    ? `<span class="product-color-more">+${colors.length - 4}</span>`
    : "";

  return `
    <div class="product-color-summary">
      <span class="product-color-heading">Colores</span>
      <div class="product-color-chips">${visible}${more}</div>
    </div>
  `;
}

function imageMarkup(product) {
  const url = getProductImages(product)[0] || "";

  if (url) {
    return `
      <img src="${escapeHtml(url)}"
           alt="${escapeHtml(product.name)}"
           loading="lazy"
           data-product-image>
    `;
  }

  return `
    <div class="photo-placeholder">
      <span class="placeholder-icon">▧</span>
      <span>Foto por agregar</span>
    </div>
  `;
}

// Sustituir imágenes de catálogo rotas por un estado visible, no por un hueco vacío.
document.querySelectorAll("#product-grid, #featured-grid, #high-performance-grid, #quality-price-grid, #top-gaming-grid").forEach(catalogGrid => catalogGrid.addEventListener("error", event => {
  const img = event.target;
  if (!(img instanceof HTMLImageElement) || !img.matches("[data-product-image]")) return;
  const container = img.closest(".product-image");
  img.remove();
  if (container && !container.querySelector(".photo-placeholder")) {
    container.insertAdjacentHTML("beforeend", `<div class="photo-placeholder"><span class="placeholder-icon">▧</span><span>Imagen no disponible</span></div>`);
  }
}, true));

function productLink(product) {
  const page = new URL(window.location.pathname, window.location.origin);
  page.searchParams.set("producto", String(product.id));
  return page.href;
}

function productShareLink(product, variant = null, fallbackColor = null) {
  const configuredPublicUrl = String(window.CATALOG_CONFIG?.publicCatalogUrl || "https://jb-collections.pages.dev").trim();
  let shareOrigin = "https://jb-collections.pages.dev";
  try {
    shareOrigin = new URL(configuredPublicUrl).origin;
  } catch {
    shareOrigin = "https://jb-collections.pages.dev";
  }
  const share = new URL("/api/share", shareOrigin);
  share.searchParams.set("catalog", "technology");
  share.searchParams.set("id", String(product.id));
  const storage = String(variant?.storage || "").trim();
  const ram = String(variant?.ram || "").trim();
  const color = String(variant?.color || fallbackColor?.name || fallbackColor?.color || "").trim();
  if (storage) share.searchParams.set("storage", storage);
  if (ram) share.searchParams.set("ram", ram);
  if (color) share.searchParams.set("color", color);
  return share.href;
}

function buildProductWhatsAppMessage(product, variant = null, fallbackColor = null) {
  const rawAvailability = variant ? effectiveVariantAvailability(variant) : (fallbackColor?.type ?? product.availability);
  const availability = normalizeVariantAvailability(rawAvailability);
  const opening = availability === "order"
    ? "Hola, quisiera consultar cómo pedir este producto"
    : availability === "out_of_stock"
      ? "Hola, quisiera consultar si habrá reposición de este producto"
      : "Hola, quiero consultar para comprar este producto";
  const parts = [`${opening}: ${product.name}.`];

  if (variant) {
    const configuration = [variant.storage, variant.ram, variant.color].filter(Boolean).join(" · ");
    if (configuration) parts.push(`Configuración seleccionada: ${configuration}.`);
    parts.push(`Precio en dólares: ${formatUSD(variant.price_usd)}.`);
    const nio = formatNIO(variant.price_nio);
    if (nio) parts.push(`Precio en córdobas: ${nio}.`);
    parts.push(`Estado de la variante: ${colorStatusLabel(effectiveVariantAvailability(variant))}.`);
  } else {
    parts.push(`Precio de referencia: ${formatUSD(product.price_usd)}.`);
    if (fallbackColor) {
      parts.push(`Color de interés: ${fallbackColor.name} (${colorStatusLabel(fallbackColor.type)}).`);
    } else {
      parts.push(`Disponibilidad: ${colorStatusLabel(product.availability)}.`);
    }
  }

  parts.push(`Enlace del artículo: ${productShareLink(product, variant, fallbackColor)}.`);
  parts.push("Quisiera confirmar disponibilidad final, forma de pago y costo de entrega antes de decidir.");
  return parts.join(" ");
}

function buildPaymentWhatsAppMessage(product, variant = null, paymentType = "financing") {
  const normalizedType = paymentType === "credit_card" ? "credit_card" : "financing";
  const displayName = [product.brand, product.model].filter(Boolean).join(" ").trim() || String(product.name || "este producto");
  const intent = normalizedType === "credit_card"
    ? "quisiera información sobre la compra con tarjeta de crédito."
    : "quisiera información sobre las opciones de financiamiento.";
  const parts = [`Hola, ${intent}`, `Producto: ${displayName}.`];
  if (variant) {
    const configuration = [variant.storage, variant.ram, variant.color].filter(Boolean).join(" · ");
    if (configuration) parts.push(`Versión de interés: ${configuration}.`);
    if (variant.price_usd !== null && variant.price_usd !== undefined) parts.push(`Precio en dólares: ${formatUSD(variant.price_usd)}.`);
    const nio = formatNIO(variant.price_nio);
    if (nio) parts.push(`Precio en córdobas: ${nio}.`);
    parts.push(`Disponibilidad de esta variante: ${colorStatusLabel(effectiveVariantAvailability(variant))}.`);
  } else {
    const usdPrice = startingPrice(product, "price_usd");
    if (usdPrice !== null && usdPrice !== undefined) parts.push(`Precio de referencia: ${formatUSD(usdPrice)}.`);
    const nio = formatNIO(startingPrice(product, "price_nio"));
    if (nio) parts.push(`Precio en córdobas: ${nio}.`);
  }
  parts.push(`Enlace del producto: ${productShareLink(product, variant)}.`);
  parts.push(normalizedType === "credit_card"
    ? "Quisiera saber qué tarjetas aceptan, si hay posibilidad de pagar en cuotas, y cuáles son los requisitos, recargos o comisiones aplicables."
    : "Quisiera conocer los requisitos, plazos, cuotas y condiciones de aprobación disponibles.");
  return parts.join(" ");
}

function buildFinancingWhatsAppMessage(product, variant = null) {
  return buildPaymentWhatsAppMessage(product, variant, "financing");
}

function buildAIProductPrompt(product, variant = null, fallbackColor = null, paymentType = "") {
  const normalizedType = paymentType === "credit_card" || paymentType === "financing" ? paymentType : "";
  const displayName = [product.brand, product.model].filter(Boolean).join(" ").trim() || String(product.name || "este producto");
  const intent = normalizedType === "credit_card"
    ? "Quiero consultar el pago con tarjeta de crédito."
    : normalizedType === "financing"
      ? "Quiero consultar las opciones de financiamiento."
      : "Quiero consultar este producto.";
  const parts = [intent, "Producto: " + displayName + "."];
  if (variant) {
    const configuration = [variant.storage, variant.ram].filter(Boolean).join(" / ");
    if (configuration) parts.push("Configuración: " + configuration + ".");
    const colorName = String(variant.color || fallbackColor?.name || "").trim();
    if (colorName) parts.push("Color: " + colorName + ".");
    if (variant.price_usd !== null && variant.price_usd !== undefined) parts.push("Precio publicado: " + formatUSD(variant.price_usd) + ".");
    const nio = formatNIO(variant.price_nio);
    if (nio) parts.push("Precio en córdobas: " + nio + ".");
  } else {
    if (fallbackColor?.name) parts.push("Color: " + fallbackColor.name + ".");
    const usd = startingPrice(product, "price_usd");
    const nio = formatNIO(startingPrice(product, "price_nio"));
    if (usd !== null && usd !== undefined) parts.push("Precio publicado: " + formatUSD(usd) + ".");
    if (nio) parts.push("Precio en córdobas: " + nio + ".");
  }
  return parts.join(" ").slice(0, 360);
}

async function startPrivateChatFromTechnology(paymentTopic = "product", sourceButton = null) {
  const context = activeContactContext;
  if (!context?.product) {
    window.alert("No pudimos identificar el producto. Cerrá esta ventana y volvé a abrir la ficha.");
    return;
  }
  const { product, variant, fallbackColor } = context;
  const baseUrl = String(window.CATALOG_CONFIG?.publicCatalogUrl || "https://jb-collections.pages.dev").replace(/\/+$/, "");
  const configuration = variant
    ? [variant.storage, variant.ram].filter(Boolean).join(" / ")
    : "";
  const colorName = String(variant?.color || fallbackColor?.name || "").trim();
  const priceUsd = variant?.price_usd !== null && variant?.price_usd !== undefined
    ? variant.price_usd
    : startingPrice(product, "price_usd");
  const contextName = [
    String(product.name || [product.brand, product.model].filter(Boolean).join(" ") || "Producto"),
    configuration,
    colorName,
    priceUsd !== null && priceUsd !== undefined ? formatUSD(priceUsd) : ""
  ].filter(Boolean).join(" · ").slice(0, 160);
  const selectedVariant = variant || null;
  const productUrl = productShareLink(product, selectedVariant, fallbackColor);
  const contactButton = sourceButton || document.querySelector("#dialog-jb-contact, #dialog-payment-jb");
  if (contactButton) {
    contactButton.disabled = true;
    contactButton.setAttribute("aria-busy", "true");
  }
  try {
    const response = await fetch(baseUrl + "/api/private-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      credentials: "omit",
      body: JSON.stringify({
        action: "start",
        catalogType: "technology",
        productId: product.id,
        productName: contextName,
        productUrl,
        paymentTopic: ["financing", "credit_card", "other", "product"].includes(paymentTopic) ? paymentTopic : "product"
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok || !data.inviteUrl) {
      throw new Error(data.message || "No se pudo abrir la mensajería privada. Intentá de nuevo o elegí WhatsApp.");
    }
    window.location.assign(data.inviteUrl);
  } catch (error) {
    window.alert(error.message || "No se pudo abrir la mensajería privada. Intentá de nuevo o elegí WhatsApp.");
    if (contactButton) {
      contactButton.disabled = false;
      contactButton.removeAttribute("aria-busy");
    }
  }
}

let activeContactContext = null;

function refreshPaymentChannelChoices() {
  const paymentType = $("#dialog-payment-type")?.value || "";
  const channelPanel = $("#dialog-payment-channel-panel");
  const whatsappChoice = $("#dialog-payment-whatsapp");
  const aiChoice = $("#dialog-payment-jb");
  if (channelPanel) channelPanel.hidden = !paymentType;
  if (!activeContactContext || !paymentType) return;

  const { product, variant, fallbackColor } = activeContactContext;
  if (whatsappChoice) {
    whatsappChoice.href = buildWhatsAppLink(buildPaymentWhatsAppMessage(product, variant, paymentType));
    whatsappChoice.setAttribute("aria-label", paymentType === "credit_card"
      ? "Consultar tarjeta de crédito por WhatsApp"
      : "Consultar financiamiento por WhatsApp");
  }
  if (aiChoice) {
    aiChoice.dataset.paymentType = paymentType;
    aiChoice.setAttribute("aria-label", paymentType === "credit_card"
      ? "Abrir mensajería privada de JB Collections para consultar tarjeta de crédito"
      : "Abrir mensajería privada de JB Collections para consultar financiamiento");
  }
}

function updateProductContactLinks(product, variant = null, fallbackColor = null) {
  activeContactContext = { product, variant, fallbackColor };
  const buyLink = $("#dialog-buy-link");
  const buyLabel = $("#dialog-buy-label");
  const jbContact = $("#dialog-jb-contact");
  const rawAvailability = variant ? effectiveVariantAvailability(variant) : (fallbackColor?.type ?? product.availability);
  const availability = normalizeVariantAvailability(rawAvailability);

  if (buyLink) {
    buyLink.href = buildWhatsAppLink(buildProductWhatsAppMessage(product, variant, fallbackColor));
    buyLink.setAttribute("aria-label", availability === "order"
      ? "Consultar pedido de este producto por WhatsApp"
      : availability === "out_of_stock"
        ? "Consultar disponibilidad de este producto por WhatsApp"
        : "Consultar compra de este producto por WhatsApp");
  }
  if (buyLabel) buyLabel.textContent = "WhatsApp";
  if (jbContact) {
    jbContact.dataset.aiPrompt = buildAIProductPrompt(product, variant, fallbackColor);
    jbContact.setAttribute("aria-label", "Consultar este producto con el asesor IA de JB Collections");
  }
  refreshPaymentChannelChoices();
}
function startingPrice(product, field = "price_usd") {
  const variants = getProductVariants(product);

  const pricedVariants = variants.filter(variant =>
    variant[field] !== null &&
    variant[field] !== undefined &&
    variant[field] !== "" &&
    Number.isFinite(Number(variant[field]))
  );

  /* Priorizar precios de variantes disponibles. */
  const availableVariants = pricedVariants.filter(
    variant => effectiveVariantAvailability(variant) === "available"
  );
  if (availableVariants.length) {
    return Math.min(...availableVariants.map(variant => Number(variant[field])));
  }

  /* Si hay variantes disponibles pero no tienen precio, no anunciar el precio
     de una variante agotada o solo por pedido como si fuera la opción disponible. */
  const hasAvailableUnpricedVariant = variants.some(
    variant => effectiveVariantAvailability(variant) === "available"
  );
  if (hasAvailableUnpricedVariant) return product[field];

  const values = pricedVariants.map(variant => Number(variant[field]));

  /* Si no existe una variante disponible, conservar el precio de referencia existente. */
  return values.length ? Math.min(...values) : product[field];
}

function normalizedProductTags(product) {
  return [...new Set((Array.isArray(product?.tags) ? product.tags : []).map(tag => String(tag || "").trim().toLowerCase()).filter(tag => Boolean(tag) && tag !== "recommended"))];
}

function formatCustomProductTag(value) {
  return String(value || "")
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("es")
    .replace(/(^|[\s/])([a-záéíóúñ])/g, (_, separator, letter) =>
      separator + letter.toLocaleUpperCase("es")
    )
    .replace(/\b(3d|2d)\b/gi, match => match.toUpperCase())
    .replace(/\b(4k|8k)\b/gi, match => match.toUpperCase())
    .replace(/\bwi\s*fi\b/gi, "Wi-Fi")
    .replace(/\busb\s*c\b/gi, "USB-C")
    .replace(/\besim\b/gi, "eSIM")
    .replace(/\b(ram|rom|ssd|oled|amoled|nfc|hdr|vr|ar|cpu|gpu)\b/gi, match => match.toUpperCase())
    .replace(/\b([45])g\b/gi, "$1G");
}

const PRODUCT_TAG_LABELS = {
  limited_edition: "▦ EDICIÓN LIMITADA",
  high_performance: "⚡ ALTO RENDIMIENTO",
  quality_price: "💎 CALIDAD-PRECIO",
  top_gaming: "🎮 TOP GAMING",
  best_seller: "MÁS VENDIDO",
  new_arrival: "NUEVO INGRESO",
  offer: "OFERTA"
};



function renderCard(product) {
  const image = imageMarkup(product);
  const variants = getProductVariants(product);
  const tags = normalizedProductTags(product);
  const rawTagLabels = new Map(
    (Array.isArray(product?.tags) ? product.tags : []).map(rawTag => {
      const raw = String(rawTag || "").trim();
      return [raw.toLocaleLowerCase("es"), raw];
    })
  );
  const isExclusive = Boolean(product.featured || product.is_exclusive || tags.includes("exclusive"));
  const cardThemeClasses = [
    ...(isExclusive ? ["product-card-tag-exclusive"] : []),
    ...tags.filter(tag => ["high_performance", "top_gaming", "quality_price"].includes(tag)).map(tag => "product-card-tag-" + tag)
  ].join(" ");
  const badge = [
    ...(isExclusive ? ['<span class="product-badge featured-badge">✦ EXCLUSIVO</span>'] : []),
    ...tags.filter(tag => tag !== "exclusive").map(tag => {
      const label = PRODUCT_TAG_LABELS[tag] || formatCustomProductTag(rawTagLabels.get(tag) || tag);
      const badgeClass = PRODUCT_TAG_LABELS[tag] ? tag.replace(/[^a-z0-9_-]/g, "") : "custom";
      return '<span class="product-badge product-tag-badge tag-' + badgeClass + '">' + escapeHtml(label) + '</span>';
    })
  ].join("");
  
  const productStatus = normalizeProductAvailability(product.availability);
  const availabilityBadge =
    productStatus === "out_of_stock"
      ? '<span class="product-badge">AGOTADO</span>'
      : productStatus === "on_order"
        ? '<span class="product-badge">POR PEDIDO</span>'
        : "";

  const brand = String(product.brand || "").trim();
  const model = String(product.model || "").trim();
  const title = brand && model ? `${brand} ${model}` : String(product.name || brand || model || "Producto");
  const price = startingPrice(product, "price_usd");
  const cardConfiguration =
    variants
      .filter(variant =>
        effectiveVariantAvailability(variant) === "available" &&
        variant.price_usd !== null &&
        Number.isFinite(variant.price_usd)
      )
      .sort((left, right) => left.price_usd - right.price_usd)[0] ||
    variants.find(variant => effectiveVariantAvailability(variant) === "available") ||
    variants[0] ||
    null;
  const cardRam = String(cardConfiguration?.ram || "").trim();
  const cardStorage = String(cardConfiguration?.storage || "").trim();
  const capacity = cardRam && cardStorage
    ? `${/\bram\b/i.test(cardRam) ? cardRam : `${cardRam} RAM`} / ${cardStorage}`
    : cardRam || cardStorage;
  const nioPrice = cardConfiguration ? cardConfiguration.price_nio : startingPrice(product, "price_nio");
  const nio = formatNIO(nioPrice);

  return `
    <article class="product-card${product.featured ? " featured-product-card" : ""}${cardThemeClasses ? " " + cardThemeClasses : ""}">
      <div class="product-image">
        ${image}
      </div>
      <div class="product-card-content">
        <div class="product-card-badges">${badge}${availabilityBadge}</div>
        <h3>${escapeHtml(title)}</h3>
        ${capacity ? `<p class="product-card-capacity">${escapeHtml(capacity)}</p>` : ""}
        <div class="product-price-label">${variants.length ? "Precio desde" : "Precio"}</div>
        <div class="product-price">${escapeHtml(formatUSD(price))}</div>
        ${nio ? `<div class="product-price-secondary">${escapeHtml(nio)}</div>` : ""}
        <div class="product-actions">
          <a class="buy-button product-view-button"
             href="${escapeHtml(productLink(product))}"
             data-details="${escapeHtml(product.id)}"
             aria-label="Ver producto: ${escapeHtml(title)}">
            Ver producto <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>
    </article>
  `;
}

function updateBrandFilterLabel() {
  if (brandFilterValue) brandFilterValue.textContent = selectedBrand || "Todas las marcas";
}

function renderBrandFilterOptions() {
  if (!brandFilterOptions) return;
  const brands = [...new Set(products.map(product => String(product.brand || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
  const query = String(brandFilterSearch?.value || "").trim().toLocaleLowerCase("es");
  const matches = query ? brands.filter(brand => brand.toLocaleLowerCase("es").startsWith(query)) : brands;
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

function readPriceBound(input) {
  if (!input) return null;
  const raw = String(input.value || "").trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizeCatalogSearch(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/\bplay\s*station\s*(\d+)\b/g, "ps$1")
    .replace(/\bps\s*(\d+)\b/g, "ps$1")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function searchTokensMatch(haystack, query) {
  const tokens = normalizeCatalogSearch(query).split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every(token => haystack.includes(token));
}

function productIdentityText(product) {
  return normalizeCatalogSearch([product.name, product.brand, product.model, product.category, product.subcategory, ...normalizedProductTags(product)].filter(Boolean).join(" "));
}

function hasActiveCatalogFilters() {
  // Sorting changes order, not the result set. Keep category sections and the
  // featured-products area visible when the customer only changes sort order.
  return Boolean((searchInput?.value || "").trim() || selectedBrand ||
    selectedCategory !== "all" || selectedSubcategory || readPriceBound(minPriceInput) !== null ||
    readPriceBound(maxPriceInput) !== null);
}


function updateSubcategoryFilter() {
  if (!subcategoryFilter) return;
  const availableProducts = products.filter(product => matchesSelectedCatalogCategory(product));
  const seen = new Map();
  availableProducts.forEach(product => {
    const value = String(product?.subcategory || "").trim();
    const key = value.toLocaleLowerCase("es");
    if (value && !seen.has(key)) seen.set(key, value);
  });
  const options = [...seen.values()].sort((left, right) => left.localeCompare(right, "es", { sensitivity: "base" }));
  if (selectedSubcategory && !options.some(value => value.toLocaleLowerCase("es") === selectedSubcategory.toLocaleLowerCase("es"))) selectedSubcategory = "";
  subcategoryFilter.replaceChildren();
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "Todas las subcategorías";
  subcategoryFilter.append(allOption);
  options.forEach(value => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    subcategoryFilter.append(option);
  });
  subcategoryFilter.value = selectedSubcategory;
  subcategoryFilter.disabled = options.length === 0;
  subcategoryFilter.setAttribute("aria-label", options.length ? "Filtrar por subcategoría" : "No hay subcategorías disponibles para esta categoría");
}

function visibleProducts() {
  const rawQuery = (searchInput?.value || "").trim();
  const query = normalizeCatalogSearch(rawQuery);
  const minPrice = readPriceBound(minPriceInput);
  const maxPrice = readPriceBound(maxPriceInput);
  const validRange = minPrice === null || maxPrice === null || minPrice <= maxPrice;
  if (priceFilterFeedback) priceFilterFeedback.textContent = validRange ? "" : "El mínimo no puede superar al máximo.";

  /*
   * Prioritize name/brand/model matches. This prevents terms found only in
   * a spec (for example "Ultra HD" for a console) matching unrelated products
   * when the customer searches for "Ultra". Search specs only if no primary
   * product-identity match exists anywhere in the current catalogue.
   */
  const identityMatches = rawQuery
    ? new Set(products.filter(product => searchTokensMatch(productIdentityText(product), query)))
    : null;
  const useIdentityMatches = Boolean(identityMatches?.size);

  return products.filter(product => {
    if (!validRange) return false;
    const categoryMatches = matchesSelectedCatalogCategory(product);
    const rawSubcategory = String(product?.subcategory || "").trim();
    const subcategoryMatches = !selectedSubcategory || rawSubcategory.toLocaleLowerCase("es") === selectedSubcategory.toLocaleLowerCase("es");
    const variants = getProductVariants(product);
    const searchableFields = [
      product.name, product.brand, product.model, product.category, product.description,
      ...getProductColors(product).map(color => color.name),
      ...variants.flatMap(variant => [variant.storage, variant.ram, variant.color]),
      ...specsArray(product.specifications)
    ];
    const haystack = normalizeCatalogSearch(searchableFields.filter(Boolean).join(" "));
    const queryMatches = !query || (useIdentityMatches
      ? identityMatches.has(product)
      : searchTokensMatch(haystack, query));
    const brandMatches = !selectedBrand || String(product.brand || "").trim().toLocaleLowerCase("es") === selectedBrand.toLocaleLowerCase("es");
    let priceMatches = true;
    if (minPrice !== null || maxPrice !== null) {
      const rawPrice = startingPrice(product, "price_usd");
      const price = rawPrice === null || rawPrice === undefined || rawPrice === "" ? NaN : Number(rawPrice);
      priceMatches = Number.isFinite(price) && (minPrice === null || price >= minPrice) && (maxPrice === null || price <= maxPrice);
    }
    return categoryMatches && subcategoryMatches && queryMatches && brandMatches && priceMatches;
  }).sort((a, b) => {
    const sort = catalogSortSelect?.value || "recent";
    if (sort === "price-asc" || sort === "price-desc") {
      // Compare the actual starting price, including variant prices, instead
      // of relying only on the product-level reference price.
      const rawA = startingPrice(a, "price_usd");
      const rawB = startingPrice(b, "price_usd");
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

const CATALOG_CATEGORY_ORDER = [
  "Celulares",
  "Laptops",
  "Tablets",
  "Gaming",
  "Consolas",
  "Televisores",
  "Audio",
  "Accesorios",
  "Otros"
];

function canonicalCatalogCategory(product) {
  const raw = String(product?.category || "").trim();
  const normalized = normalizeCatalogSearch(raw);
  const aliases = [
    ["Celulares", ["celular", "celulares", "telefono", "telefonos", "smartphone", "smartphones", "movil", "moviles"]],
    ["Laptops", ["laptop", "laptops", "portatil", "portatiles", "notebook", "notebooks"]],
    ["Tablets", ["tablet", "tablets"]],
    ["Gaming", ["gaming", "gaming gear", "gaming equipment"]],
    ["Consolas", ["consola", "consolas", "console", "consoles", "videojuego", "videojuegos", "gaming console", "gaming consoles"]],
    ["Televisores", ["televisor", "televisores", "television", "televisiones", "tv"]],
    ["Audio", ["audio", "auriculares", "parlantes", "bocinas", "altavoces", "headphones", "earbuds"]],
    ["Accesorios", ["accesorio", "accesorios", "accessory", "accessories"]],
    ["Otros", ["otro", "otros"]]
  ];
  for (const [label, values] of aliases) {
    if (values.includes(normalized)) return label;
  }
  return raw ? "Otros" : "Otros";
}

// Consolas is a public navigation option for console products whose stored primary
// category stays "Gaming" and whose subcategory stays "Consolas" (for example, PS5).
function matchesSelectedCatalogCategory(product, category = selectedCategory) {
  const selected = normalizeCatalogSearch(category);
  if (!selected || selected === "all") return true;
  if (normalizeCatalogSearch(canonicalCatalogCategory(product)) === selected) return true;
  return selected === "consolas" && normalizeCatalogSearch(product?.subcategory) === selected;
}

function renderCategorizedProducts(productList) {
  const grouped = new Map(CATALOG_CATEGORY_ORDER.map(category => [category, []]));
  for (const product of productList) {
    const category = canonicalCatalogCategory(product);
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category).push(product);
  }

  return [...grouped.entries()]
    .filter(([, items]) => items.length > 0)
    .map(([category, items]) => {
      const slug = normalizeCatalogSearch(category).replace(/\s+/g, "-");
      const titleId = "catalog-category-" + slug;
      const countLabel = items.length + " producto" + (items.length === 1 ? "" : "s");
      return `
        <section class="catalog-category-section" aria-labelledby="${titleId}">
          <header class="catalog-category-heading">
            <span class="catalog-category-heading-mark" aria-hidden="true"></span>
            <div class="catalog-category-heading-copy">
              <p class="catalog-category-eyebrow">EXPLORÁ POR CATEGORÍA</p>
              <h3 id="${titleId}">${escapeHtml(category)}</h3>
            </div>
            <span class="catalog-category-count">${countLabel}</span>
          </header>
          <div class="catalog-category-grid">${items.map(renderCard).join("")}</div>
        </section>
      `;
    }).join("");
}

function renderProducts() {
  updateSubcategoryFilter();
  const list = visibleProducts();
  const hasFilters = hasActiveCatalogFilters();
  const isExclusiveProduct = product => Boolean(
    product.featured || product.is_exclusive || normalizedProductTags(product).includes("exclusive")
  );
  const featured = hasFilters ? [] : list.filter(isExclusiveProduct);
  const limitedEdition = hasFilters ? [] : list.filter(product => normalizedProductTags(product).includes("limited_edition"));
  const highPerformance = hasFilters ? [] : list.filter(product => {
    const tags = normalizedProductTags(product);
    return tags.includes("high_performance") && !isExclusiveProduct(product);
  });
  const qualityPrice = hasFilters ? [] : list.filter(product => normalizedProductTags(product).includes("quality_price"));
  const topGaming = hasFilters ? [] : list.filter(product => normalizedProductTags(product).includes("top_gaming"));
  const regularProducts = hasFilters ? list : list.filter(product => {
    const tags = normalizedProductTags(product);
    return !isExclusiveProduct(product) &&
      !tags.includes("limited_edition") &&
      !tags.includes("high_performance") &&
      !tags.includes("quality_price") &&
      !tags.includes("top_gaming");
  });
  if (highPerformanceSection && highPerformanceGrid) {
    highPerformanceSection.classList.toggle("hidden", highPerformance.length === 0);
    highPerformanceGrid.innerHTML = highPerformance.map(renderCard).join("");
  }
  if (highPerformanceCount) {
    highPerformanceCount.textContent = highPerformance.length
      ? highPerformance.length + " equipo" + (highPerformance.length === 1 ? "" : "s")
      : "";
  }
  if (qualityPriceSection && qualityPriceGrid) {
    qualityPriceSection.classList.toggle("hidden", qualityPrice.length === 0);
    qualityPriceGrid.innerHTML = qualityPrice.map(renderCard).join("");
  }
  if (qualityPriceCount) qualityPriceCount.textContent = qualityPrice.length
    ? qualityPrice.length + " producto" + (qualityPrice.length === 1 ? "" : "s")
    : "";
  if (topGamingSection && topGamingGrid) {
    topGamingSection.classList.toggle("hidden", topGaming.length === 0);
    topGamingGrid.innerHTML = topGaming.map(renderCard).join("");
  }
  if (topGamingCount) topGamingCount.textContent = topGaming.length ? (topGaming.length + " equipo" + (topGaming.length === 1 ? "" : "s")) : "";
  if (featuredSection && featuredGrid) {
    featuredSection.classList.toggle("hidden", featured.length === 0);
    featuredGrid.innerHTML = featured.map(renderCard).join("");
  }
  if (featuredCount) featuredCount.textContent = featured.length ? `${featured.length} exclusivo${featured.length === 1 ? "" : "s"}` : "";
  if (limitedEditionSection && limitedEditionGrid) {
    limitedEditionSection.classList.toggle("hidden", limitedEdition.length === 0);
    limitedEditionGrid.innerHTML = limitedEdition.map(renderCard).join("");
  }
  if (limitedEditionCount) limitedEditionCount.textContent = limitedEdition.length
    ? limitedEdition.length + " edición" + (limitedEdition.length === 1 ? "" : "es")
    : "";
  if (resultsEyebrow) resultsEyebrow.textContent = hasFilters ? "TU BÚSQUEDA" : "CATÁLOGO COMPLETO";
  if (resultsTitle) resultsTitle.textContent = hasFilters ? "Resultados" : "Explorá todo el catálogo";
  if (resultsHeading) resultsHeading.classList.toggle("hidden", !hasFilters && regularProducts.length === 0);
  const groupByCategory = !hasFilters && regularProducts.length > 0;
  grid.classList.toggle("is-categorized", groupByCategory);
  grid.innerHTML = groupByCategory
    ? renderCategorizedProducts(regularProducts)
    : regularProducts.map(renderCard).join("");
  emptyNode.classList.toggle("hidden", list.length > 0);
  if (clearPriceFilterButton) clearPriceFilterButton.disabled = !hasActiveCatalogFilters();
  statusNode.textContent = products.length
    ? hasFilters
      ? `${list.length} resultado${list.length === 1 ? "" : "s"} de ${products.length} producto${products.length === 1 ? "" : "s"} publicado${products.length === 1 ? "" : "s"}`
      : `${products.length} producto${products.length === 1 ? "" : "s"} publicado${products.length === 1 ? "" : "s"}${featured.length ? ` · ${featured.length} destacado${featured.length === 1 ? "" : "s"} en su sección` : ""}`
    : "Todavía no hay productos publicados.";
  categoryFilters.querySelectorAll("[data-category]").forEach(button => {
    const isSelected = button.dataset.category === selectedCategory;
    button.classList.toggle("active", isSelected);
    button.setAttribute("aria-pressed", String(isSelected));
  });
}
function uniqueValues(variants, field) {
  const seen = new Set();
  const values = [];

  variants.forEach(variant => {
    const value = String(variant[field] || "").trim();
    const key = value.toLocaleLowerCase("es");
    if (value && !seen.has(key)) {
      seen.add(key);
      values.push(value);
    }
  });

  if (field === "storage" || field === "ram") {
    const amount = value => {
      const match = String(value || "").match(/[0-9]+(?:[.,][0-9]+)?/);
      return match ? Number(match[0].replace(",", ".")) : Number.POSITIVE_INFINITY;
    };
    values.sort((left, right) => amount(left) - amount(right) || left.localeCompare(right, "es"));
  }

  return values;
}

function chooseVariant(variants, current, field, value) {
  const candidates = variants.filter(variant =>
    String(variant[field] || "").trim() === String(value || "").trim()
  );

  if (!candidates.length) return current;

  let best = candidates[0];
  let bestScore = -1;

  candidates.forEach(candidate => {
    let score = 0;

    ["storage", "ram", "color"].forEach(otherField => {
      if (
        otherField !== field &&
        current[otherField] &&
        candidate[otherField] === current[otherField]
      ) {
        score++;
      }
    });

    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  });

  return best;
}

function renderVariantButtonGroup(variants, selected, field, title) {
  // Los colores pertenecen a la configuración RAM/almacenamiento seleccionada.
  if (field === "color") {
    variants = variants.filter(variant =>
      String(variant.storage || "").trim() === String(selected.storage || "").trim() &&
      String(variant.ram || "").trim() === String(selected.ram || "").trim()
    );
  }

  if (field === "storage") {
    const values = [];
    const seen = new Set();
    const hasTechnicalConfigurations = variants.some(variant =>
      String(variant.storage || "").trim() || String(variant.ram || "").trim()
    );
    // Base-color rows have no RAM or capacity. Do not expose them as an extra
    // "Estándar" choice when this product has explicit technical configurations.
    const configurationVariants = hasTechnicalConfigurations
      ? variants.filter(variant =>
          String(variant.storage || "").trim() || String(variant.ram || "").trim()
        )
      : variants;
    configurationVariants.forEach(variant => {
      const storage = String(variant.storage || "").trim();
      const ram = String(variant.ram || "").trim();
      const label = storage && ram ? `${storage} / ${ram}` : storage || ram || "Estándar";
      const key = `${storage.toLocaleLowerCase("es")}| ${ram.toLocaleLowerCase("es")}`;
      const matching = variants.filter(candidate =>
        String(candidate.storage || "").trim() === storage &&
        String(candidate.ram || "").trim() === ram
      );
      const status = matching.some(candidate => effectiveVariantAvailability(candidate) === "available")
        ? "available"
        : matching.some(candidate => effectiveVariantAvailability(candidate) === "order") ? "order" : "out_of_stock";
      if (label && !seen.has(key)) { seen.add(key); values.push({label, storage, ram, status}); }
    });
    const buttons = values.map(item => {
      const isSelected = selected.storage === item.storage && selected.ram === item.ram;
      const statusLabel = colorStatusLabel(item.status);
      return `<button type="button" class="variant-choice ${isSelected ? "selected" : ""}" data-variant-dimension="configuration" data-variant-storage="${escapeHtml(item.storage)}" data-variant-ram="${escapeHtml(item.ram)}" aria-pressed="${isSelected ? "true" : "false"}" aria-label="${escapeHtml(item.label + ": " + statusLabel)}" title="${escapeHtml(item.label + " · " + statusLabel)}"><span>${escapeHtml(item.label)}</span><small class="variant-choice-status status-${item.status}">${escapeHtml(statusLabel)}</small></button>`;
    }).join("");
    return `<section class="variant-option-group"><h3>${title}</h3><div class="variant-choice-list">${buttons}</div></section>`;
  }

  const values = uniqueValues(variants, field);
  if (!values.length) return "";

  if (field === "color") {
    const buttons = values.map(value => {
      const candidate = chooseVariant(variants, selected, field, value);
      const isSelected = selected.color === value;
      const swatch = validHex(candidate?.color_hex);
      const status = colorStatusLabel(effectiveVariantAvailability(candidate));

      return `
        <button type="button"
                class="variant-choice color-choice ${isSelected ? "selected" : ""}"
                data-variant-dimension="color"
                data-variant-value="${escapeHtml(value)}"
                aria-pressed="${isSelected ? "true" : "false"}"
                title="${escapeHtml(`${value} · ${status}`)}"
                aria-label="${escapeHtml(`${value}: ${status}`)}">
          <span class="variant-color-dot" style="background:${swatch}" aria-hidden="true"></span>
          <span class="variant-color-name">${escapeHtml(value)}</span>
        </button>
      `;
    }).join("");

    return `
      <section class="variant-option-group variant-option-color-group">
        <h3>${title}</h3>
        <div class="variant-choice-list color-choice-list">${buttons}</div>
      </section>
    `;
  }

  const buttons = values.map(value => {
    const isSelected = selected[field] === value;

    return `
      <button type="button"
              class="variant-choice ${isSelected ? "selected" : ""}"
              data-variant-dimension="${field}"
              data-variant-value="${escapeHtml(value)}"
              aria-pressed="${isSelected ? "true" : "false"}">${escapeHtml(value)}</button>
    `;
  }).join("");

  return `
    <section class="variant-option-group">
      <h3>${title}</h3>
      <div class="variant-choice-list">${buttons}</div>
    </section>
  `;
}

function renderProductGallery(product, images, caption = "") {
  const photoUrls = [...new Set((Array.isArray(images) ? images : [])
    .filter(url => typeof url === "string")
    .map(url => url.trim())
    .filter(Boolean))];
  if (!photoUrls.length) {
    return '<div class="photo-placeholder"><span class="placeholder-icon">▧</span><span>Foto por agregar</span></div>';
  }

  const productName = String(product?.name || "Producto").trim();
  const imageAlt = [productName, caption].filter(Boolean).join(" · ");
  const multiple = photoUrls.length > 1;

  return `
    <div class="dialog-gallery-main" data-inline-gallery>
      ${multiple ? '<button type="button" class="dialog-gallery-nav dialog-gallery-prev" data-gallery-step="-1" aria-label="Ver fotografía anterior">‹</button>' : ""}
      <button type="button" class="dialog-image-zoom" aria-label="Ampliar fotografía del producto">
        <img id="dialog-main-image" class="dialog-main-image"
             src="${escapeHtml(photoUrls[0])}"
             alt="${escapeHtml(imageAlt)}"
             loading="eager" decoding="async">
      </button>
      ${multiple ? '<button type="button" class="dialog-gallery-nav dialog-gallery-next" data-gallery-step="1" aria-label="Ver fotografía siguiente">›</button>' : ""}
    </div>
    ${multiple
      ? `<div class="dialog-gallery-thumbs" aria-label="Fotografías del producto">
          ${photoUrls.map((url, index) => `
            <button type="button"
                    class="dialog-gallery-thumb ${index === 0 ? "active" : ""}"
                    data-gallery-image="${escapeHtml(url)}"
                    aria-label="Ver fotografía ${index + 1}">
              <img src="${escapeHtml(url)}" alt="" loading="lazy">
            </button>
          `).join("")}
        </div>`
      : ""}
  `;
}

function renderVariantControls(product, variants, selected) {
  const area = $("#variant-options-area");
  if (!area || !selected) return;

  dialogContent.dataset.analyticsVariantColor = String(selected.color || "");
  dialogContent.dataset.analyticsVariantRam = String(selected.ram || "");
  dialogContent.dataset.analyticsVariantStorage = String(selected.storage || "");

  const configuration = [
    selected.storage,
    selected.ram,
    selected.color
  ].filter(Boolean).join(" · ");

  const usd = formatUSD(selected.price_usd);
  const nio = formatNIO(selected.price_nio);
  const selectedAvailability = effectiveVariantAvailability(selected);
  const status = colorStatusLabel(selectedAvailability);
  const isOrder = selectedAvailability === "order";
  const isUnavailable = selectedAvailability === "out_of_stock";

  area.innerHTML = `
    <div class="variant-selector">
      ${renderVariantButtonGroup(variants, selected, "storage", "Configuración")}
      ${renderVariantButtonGroup(variants, selected, "color", "Color")}
    </div>

    <div class="variant-bottom-row">
      <div class="variant-selected-summary">
        <span>Versión seleccionada</span>
        <strong>${escapeHtml(configuration || "Configuración estándar")}</strong>
        <span class="variant-status-badge ${isOrder ? "order" : isUnavailable ? "unavailable" : "available"}">${status}</span>
      </div>

      <div class="variant-price-box">
        <span>Precio de esta versión</span>
        <strong>${escapeHtml(usd)}</strong>
        ${nio ? `<small>${escapeHtml(nio)}</small>` : ""}
      </div>
    </div>

  `;

  updateProductContactLinks(product, selected);

  const productDescription = dialogContent.querySelector(".dialog-product-description");
  if (productDescription && area.parentElement) {
    area.insertAdjacentElement("afterend", productDescription);
  }

  const dialogImage = $("#dialog-image");
  if (dialogImage) {
    // Never substitute a different variant's general gallery when this variant has no photos.
    const chosenImages = selected.images?.length
      ? selected.images
      : selected.image_url
        ? [selected.image_url]
        : [];
    dialogImage.innerHTML = renderProductGallery(product, chosenImages, configuration);
  }
}

function renderLegacyColorOptions(product, selectedColorName = "") {
  const colors = getProductColors(product);
  if (!colors.length) return "";

  return `
    <section class="dialog-colors" aria-labelledby="dialog-colors-title">
      <h3 id="dialog-colors-title">Colores disponibles y por pedido</h3>

      <div class="dialog-color-grid">
        ${colors.map(color => `
          <article class="dialog-color-card ${String(color.name).trim().toLocaleLowerCase("es") === String(selectedColorName).trim().toLocaleLowerCase("es") ? "is-selected" : ""}">
            <div class="dialog-color-image">
              ${
                color.image_url
                  ? `<img src="${escapeHtml(color.image_url)}" alt="${escapeHtml(`${product.name} color ${color.name}`)}" loading="lazy">`
                  : `<span class="product-color-dot" style="background:${validHex(color.color_hex)}" aria-hidden="true"></span>`
              }
            </div>

            <div class="dialog-color-info">
              <strong>${escapeHtml(color.name)}</strong>
              <span class="color-availability ${color.type === "order" ? "order" : color.type === "out_of_stock" ? "unavailable" : "available"}">
                ${escapeHtml(colorStatusLabel(color.type))}
              </span>
              <a href="${escapeHtml(buildWhatsAppLink(buildProductWhatsAppMessage(product, null, color)))}"
                 data-analytics-color="${escapeHtml(color.name)}"
                 target="_blank"
                 rel="noopener">Consultar este color ↗</a>
            </div>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function openProductImageLightbox(src, alt, galleryItems = []) {
  if (!src) return;

  let lightbox = document.querySelector("#product-image-lightbox");
  if (!lightbox) {
    lightbox = document.createElement("dialog");
    lightbox.id = "product-image-lightbox";
    lightbox.className = "product-image-lightbox";
    lightbox.setAttribute("aria-label", "Fotografías del producto a pantalla completa");
    lightbox.innerHTML = `
      <button type="button" class="product-image-lightbox-close" aria-label="Cerrar fotografías ampliadas">×</button>
      <button type="button" class="product-image-lightbox-nav product-image-lightbox-prev" aria-label="Ver fotografía anterior" hidden>‹</button>
      <img class="product-image-lightbox-photo" alt="">
      <button type="button" class="product-image-lightbox-nav product-image-lightbox-next" aria-label="Ver fotografía siguiente" hidden>›</button>
      <span class="product-image-lightbox-counter" aria-live="polite"></span>
    `;
    document.body.appendChild(lightbox);

    const photo = lightbox.querySelector(".product-image-lightbox-photo");
    const previous = lightbox.querySelector(".product-image-lightbox-prev");
    const next = lightbox.querySelector(".product-image-lightbox-next");
    const counter = lightbox.querySelector(".product-image-lightbox-counter");

    function renderPhoto() {
      const photos = lightbox._galleryItems || [];
      if (!photos.length) return;
      const index = Math.max(0, Math.min(lightbox._galleryIndex || 0, photos.length - 1));
      lightbox._galleryIndex = index;
      photo.src = photos[index].src;
      photo.alt = photos[index].alt || "Fotografía del producto";
      const multiple = photos.length > 1;
      previous.hidden = !multiple;
      next.hidden = !multiple;
      counter.hidden = !multiple;
      counter.textContent = multiple ? (index + 1) + " / " + photos.length : "";
    }

    function movePhoto(amount) {
      const photos = lightbox._galleryItems || [];
      if (photos.length < 2) return;
      lightbox._galleryIndex = (lightbox._galleryIndex + amount + photos.length) % photos.length;
      renderPhoto();
    }

    previous.addEventListener("click", () => movePhoto(-1));
    next.addEventListener("click", () => movePhoto(1));
    lightbox.querySelector(".product-image-lightbox-close").addEventListener("click", () => {
      if (typeof lightbox.close === "function" && lightbox.open) lightbox.close();
      else lightbox.removeAttribute("open");
    });
    lightbox.addEventListener("click", event => {
      if (event.target !== lightbox) return;
      if (typeof lightbox.close === "function" && lightbox.open) lightbox.close();
      else lightbox.removeAttribute("open");
    });
    lightbox.addEventListener("keydown", event => {
      if (event.key === "ArrowLeft" && !previous.hidden) {
        event.preventDefault();
        movePhoto(-1);
      } else if (event.key === "ArrowRight" && !next.hidden) {
        event.preventDefault();
        movePhoto(1);
      }
    });

    let touchStartX = 0;
    let touchStartY = 0;
    lightbox.addEventListener("touchstart", event => {
      const touch = event.changedTouches && event.changedTouches[0];
      if (!touch) return;
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
    }, {passive:true});
    lightbox.addEventListener("touchend", event => {
      const touch = event.changedTouches && event.changedTouches[0];
      if (!touch || !lightbox.open) return;
      const deltaX = touch.clientX - touchStartX;
      const deltaY = touch.clientY - touchStartY;
      if (Math.abs(deltaX) < 45 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
      // Rightward swipe = previous photo; leftward swipe = next photo.
      movePhoto(deltaX > 0 ? -1 : 1);
    }, {passive:true});

    lightbox._renderPhoto = renderPhoto;
  }

  const comparable = value => {
    try { return new URL(value, window.location.href).href; }
    catch { return String(value || ""); }
  };
  const unique = [];
  const seen = new Set();
  [...galleryItems, {src, alt}].forEach((item, index) => {
    if (!item || !item.src) return;
    const key = comparable(item.src);
    if (seen.has(key)) return;
    seen.add(key);
    unique.push({src:item.src, alt:item.alt || alt || ("Fotografía " + (index + 1))});
  });
  let startIndex = unique.findIndex(item => comparable(item.src) === comparable(src));
  if (startIndex < 0) {
    unique.unshift({src, alt:alt || "Fotografía del producto"});
    startIndex = 0;
  }
  lightbox._galleryItems = unique;
  lightbox._galleryIndex = startIndex;
  lightbox._renderPhoto();

  if (typeof lightbox.showModal === "function") {
    if (!lightbox.open) lightbox.showModal();
  } else {
    lightbox.setAttribute("open", "open");
  }
}

function moveTechnologyGallery(step) {
  const thumbnails = Array.from(dialogContent.querySelectorAll("#dialog-image [data-gallery-image]"));
  if (thumbnails.length < 2) return;
  let currentIndex = thumbnails.findIndex(button => button.classList.contains("active"));
  if (currentIndex < 0) currentIndex = 0;
  thumbnails[(currentIndex + step + thumbnails.length) % thumbnails.length].click();
}


/* Gallery resilience: broken full-size images are shown as a useful fallback,
   and broken thumbnails are hidden instead of displaying a broken-image icon. */
dialogContent.addEventListener("error", event => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement)) return;

  if (image.matches("#dialog-image .dialog-main-image")) {
    image.style.visibility = "hidden";
    const gallery = image.closest(".dialog-gallery-main");
    if (gallery && !gallery.querySelector(".dialog-image-load-error")) {
      const fallback = document.createElement("div");
      fallback.className = "dialog-image-load-error";
      fallback.setAttribute("role", "status");
      fallback.textContent = "No se pudo cargar esta fotografía. Probá otra imagen de la galería.";
      gallery.appendChild(fallback);
    }
    return;
  }

  if (image.matches("#dialog-image .dialog-gallery-thumb img")) {
    const thumbnail = image.closest(".dialog-gallery-thumb");
    if (thumbnail) thumbnail.hidden = true;
  }
}, true);

let technologyGalleryTouchStart = null;
dialogContent.addEventListener("touchstart", event => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target?.closest("#dialog-image .dialog-gallery-main")) {
    technologyGalleryTouchStart = null;
    return;
  }
  const touch = event.changedTouches && event.changedTouches[0];
  technologyGalleryTouchStart = touch ? { x: touch.clientX, y: touch.clientY } : null;
}, { passive: true });

dialogContent.addEventListener("touchend", event => {
  if (!technologyGalleryTouchStart) return;
  const start = technologyGalleryTouchStart;
  technologyGalleryTouchStart = null;
  const target = event.target instanceof Element ? event.target : null;
  if (!target?.closest("#dialog-image .dialog-gallery-main")) return;
  const touch = event.changedTouches && event.changedTouches[0];
  if (!touch) return;
  const deltaX = touch.clientX - start.x;
  const deltaY = touch.clientY - start.y;
  if (Math.abs(deltaX) < 42 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
  moveTechnologyGallery(deltaX < 0 ? 1 : -1);
}, { passive: true });

dialogContent.addEventListener("change", event => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.matches("#dialog-payment-type")) refreshPaymentChannelChoices();
});

dialogContent.addEventListener("click", event => {
  const target = event.target instanceof Element ? event.target : null;
  const aiContactButton = target?.closest("#dialog-jb-contact, #dialog-payment-jb");
  if (aiContactButton) {
    event.preventDefault();
    const paymentTopic = aiContactButton.id === "dialog-payment-jb"
      ? ($("#dialog-payment-type")?.value || "product")
      : "product";
    void startPrivateChatFromTechnology(paymentTopic, aiContactButton);
    return;
  }
  const galleryStep = target?.closest("[data-gallery-step]");
  if (galleryStep) {
    event.preventDefault();
    event.stopPropagation();
    moveTechnologyGallery(Number(galleryStep.dataset.galleryStep) || 0);
    return;
  }
  const paymentToggle = target?.closest("#dialog-payment-options-toggle");
  if (paymentToggle) {
    const panel = $("#dialog-payment-choice-panel");
    if (panel) {
      panel.hidden = !panel.hidden;
      paymentToggle.setAttribute("aria-expanded", String(!panel.hidden));
      paymentToggle.classList.toggle("is-expanded", !panel.hidden);
    }
    return;
  }
  const whatsappLink = target?.closest('a[href*="wa.me"], a[href*="api.whatsapp.com"]');
  if (whatsappLink) {
    const product = products.find(item => String(item.id) === String(dialogContent.dataset.analyticsProductId));
    if (product) {
      recordCatalogEvent(product.id, "whatsapp_click", {
        color: whatsappLink.dataset.analyticsColor || dialogContent.dataset.analyticsVariantColor || "",
        ram: whatsappLink.dataset.analyticsRam || dialogContent.dataset.analyticsVariantRam || "",
        storage: whatsappLink.dataset.analyticsStorage || dialogContent.dataset.analyticsVariantStorage || ""
      });
    }
  }
  const zoomButton = target?.closest(".dialog-image-zoom");
  if (zoomButton) {
    const image = zoomButton.querySelector(".dialog-main-image");
    if (image) {
      const photoButtons = Array.from(dialogContent.querySelectorAll("[data-gallery-image]"));
      const photos = photoButtons.map((button, index) => ({
        src:button.dataset.galleryImage || "",
        alt:(image.alt || "Fotografía del producto") + " · foto " + (index + 1)
      })).filter(item => item.src);
      openProductImageLightbox(image.getAttribute("src") || image.currentSrc || image.src, image.alt, photos);
    }
    return;
  }

  const thumbnail = target?.closest("[data-gallery-image]");
  if (!thumbnail) return;
  const mainImage = dialogContent.querySelector("#dialog-main-image");
  if (mainImage) {
    mainImage.src = thumbnail.dataset.galleryImage;
    const productName = dialogContent.querySelector(".dialog-detail h2")?.textContent?.trim() || "Producto";
    const photoLabel = thumbnail.getAttribute("aria-label") || "";
    mainImage.alt = photoLabel ? `${productName} — ${photoLabel.toLocaleLowerCase("es")}` : productName;
    mainImage.style.visibility = "visible";
    mainImage.closest(".dialog-gallery-main")?.querySelector(".dialog-image-load-error")?.remove();
  }
  dialogContent.querySelectorAll("[data-gallery-image]").forEach(button => {
    button.classList.toggle("active", button === thumbnail);
  });
});

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

function openProduct(product, requestedVariant = null) {
  dialogContent.dataset.analyticsProductId = String(product.id);
  dialogContent.dataset.analyticsVariantColor = "";
  dialogContent.dataset.analyticsVariantRam = "";
  dialogContent.dataset.analyticsVariantStorage = "";
  recordCatalogEvent(product.id, "view");
  const variants = getProductVariants(product);
  const specs = specsArray(product.specifications);
  const requestedColorName = String(requestedVariant?.color || "").trim();
  const requestedColor = !variants.length && requestedColorName
    ? getProductColors(product).find(color => String(color.name || "").trim().toLocaleLowerCase("es") === requestedColorName.toLocaleLowerCase("es"))
    : null;
  const productImages = getProductImages(product);
  const fallbackColorImages = !variants.length
    ? getProductColors(product).map(color => color.image_url).filter(Boolean)
    : [];
  // Legacy products also get the full image gallery. If a URL explicitly opens a color,
  // prioritize that color-specific photo rather than a generic image of another finish.
  const initialImages = requestedColor?.image_url
    ? [requestedColor.image_url]
    : productImages.length
      ? productImages
      : fallbackColorImages;
  const initialImage = initialImages[0] || "";

  const warranty =
    product.warranty_months !== null &&
    product.warranty_months !== undefined &&
    product.warranty_months !== ""
      ? `<p><b>Garantía:</b> ${escapeHtml(product.warranty_months)} meses, según catálogo.</p>`
      : "";

  const nio = formatNIO(product.price_nio);

  dialogContent.innerHTML = `
    <div class="dialog-layout">
      <div class="dialog-image" id="dialog-image">
        ${
          initialImage
            ? renderProductGallery(product, initialImages)
            : `<div class="photo-placeholder"><span class="placeholder-icon">▧</span><span>Foto por agregar</span></div>`
        }
      </div>

      <div class="dialog-detail">
        <div class="product-category">${escapeHtml(product.category || "Tecnología")}</div>
        <h2>${escapeHtml(product.name)}</h2>

        ${
          variants.length
            ? `<div id="variant-options-area"></div>`
            : `<div class="product-price-label">Precio de referencia</div>
               <div class="product-price">${escapeHtml(formatUSD(product.price_usd))}</div>
               ${nio ? `<p>${escapeHtml(nio)}</p>` : ""}
               ${renderLegacyColorOptions(product, requestedColorName)}`
        }

        <div class="dialog-product-description">${renderCommercialDescription(product.description, "Consultá disponibilidad y características.")}</div>

        <div class="product-contact-actions">
          <div class="product-contact-channel-actions">
            <a id="dialog-buy-link" class="button button-primary contact-channel-button contact-channel-button--whatsapp" href="#" target="_blank" rel="noopener"><span class="contact-channel-icon" aria-hidden="true"><svg class="contact-channel-svg" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path fill="currentColor" d="M16.02 3.1A12.83 12.83 0 0 0 5.05 22.57L3.3 28.8l6.4-1.68A12.86 12.86 0 1 0 16.02 3.1Zm0 23.38h-.01a10.5 10.5 0 0 1-5.35-1.47l-.38-.22-3.8 1 1.01-3.7-.25-.4A10.47 10.47 0 1 1 16.02 26.48Zm5.75-7.85c-.32-.16-1.9-.94-2.2-1.05-.3-.11-.51-.16-.72.16-.22.32-.83 1.05-1.02 1.26-.19.22-.38.24-.7.08-.33-.16-1.38-.51-2.62-1.62-.97-.86-1.63-1.93-1.82-2.25-.19-.32-.02-.49.14-.65.14-.14.32-.38.48-.57.16-.19.22-.32.32-.54.11-.21.05-.4-.03-.56-.08-.16-.72-1.73-.99-2.37-.26-.63-.53-.54-.72-.55h-.62c-.22 0-.57.08-.86.4-.3.32-1.13 1.1-1.13 2.68s1.16 3.1 1.32 3.31c.16.22 2.27 3.47 5.5 4.86.77.33 1.37.53 1.84.68.77.25 1.47.21 2.02.13.62-.09 1.9-.78 2.17-1.53.27-.75.27-1.4.19-1.53-.08-.14-.29-.22-.62-.38Z"/></svg></span><span id="dialog-buy-label">WhatsApp</span></a>
            <button id="dialog-jb-contact" class="button button-secondary contact-channel-button contact-channel-button--jb" type="button"><span class="contact-channel-icon" aria-hidden="true"><svg class="contact-channel-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span>Contactar JB Collections</span></button>
          </div>
        </div>
        <section id="dialog-payment-choice-panel" class="payment-choice-panel" aria-label="Opciones de pago">
          <div class="payment-choice-heading">
            <label for="dialog-payment-type">¿Qué querés consultar?</label>
            <p>Elegí el tema y después el canal por el que preferís continuar.</p>
          </div>
          <select id="dialog-payment-type" class="payment-choice-select">
            <option value="">Seleccioná una opción</option>
            <option value="financing">Financiamiento</option>
            <option value="credit_card">Compra con tarjeta de crédito</option>
          </select>
          <div id="dialog-payment-channel-panel" class="payment-channel-panel" hidden>
            <p>¿Por cuál canal querés continuar?</p>
            <div class="payment-channel-actions">
              <a id="dialog-payment-whatsapp" class="payment-channel-button contact-channel-button--whatsapp" href="#" target="_blank" rel="noopener"><svg class="contact-channel-svg" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path fill="currentColor" d="M16.02 3.1A12.83 12.83 0 0 0 5.05 22.57L3.3 28.8l6.4-1.68A12.86 12.86 0 1 0 16.02 3.1Zm0 23.38h-.01a10.5 10.5 0 0 1-5.35-1.47l-.38-.22-3.8 1 1.01-3.7-.25-.4A10.47 10.47 0 1 1 16.02 26.48Zm5.75-7.85c-.32-.16-1.9-.94-2.2-1.05-.3-.11-.51-.16-.72.16-.22.32-.83 1.05-1.02 1.26-.19.22-.38.24-.7.08-.33-.16-1.38-.51-2.62-1.62-.97-.86-1.63-1.93-1.82-2.25-.19-.32-.02-.49.14-.65.14-.14.32-.38.48-.57.16-.19.22-.32.32-.54.11-.21.05-.4-.03-.56-.08-.16-.72-1.73-.99-2.37-.26-.63-.53-.54-.72-.55h-.62c-.22 0-.57.08-.86.4-.3.32-1.13 1.1-1.13 2.68s1.16 3.1 1.32 3.31c.16.22 2.27 3.47 5.5 4.86.77.33 1.37.53 1.84.68.77.25 1.47.21 2.02.13.62-.09 1.9-.78 2.17-1.53.27-.75.27-1.4.19-1.53-.08-.14-.29-.22-.62-.38Z"/></svg><span>WhatsApp</span></a>
              <button id="dialog-payment-jb" class="payment-channel-button contact-channel-button--jb" type="button"><svg class="contact-channel-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span>JB Collections</span></button>
            </div>
          </div>
        </section>

        ${warranty}

        <h3>Especificaciones</h3>
        ${
          specs.length
            ? `<ul class="dialog-specs">${specs.map(spec => `<li>${escapeHtml(spec)}</li>`).join("")}</ul>`
            : "<p>Consultá las especificaciones confirmadas de este modelo.</p>"
        }

        <p><b>Financiamiento:</b>
          ${escapeHtml(product.financing_note || "Mediante crédito o tarjeta; consultar requisitos y condiciones.")}
        </p>

        <p><b>Entrega:</b>
          Centro de Managua gratis. Fuera del centro, costo según kilometraje.
          Departamentos por CargoTrans, con costo según destino.
        </p>
      </div>
    </div>
  `;

  updateProductContactLinks(product, null, requestedColor);

  if (variants.length) {
    const requestedVariantPresent = Boolean(
      String(requestedVariant?.storage || "").trim() ||
      String(requestedVariant?.ram || "").trim() ||
      String(requestedVariant?.color || "").trim()
    );
    const routeVariant = requestedVariantPresent
      ? variants.find(variant =>
          (!String(requestedVariant?.storage || "").trim() || String(variant.storage || "").trim().toLocaleLowerCase("es") === String(requestedVariant.storage).trim().toLocaleLowerCase("es")) &&
          (!String(requestedVariant?.ram || "").trim() || String(variant.ram || "").trim().toLocaleLowerCase("es") === String(requestedVariant.ram).trim().toLocaleLowerCase("es")) &&
          (!String(requestedVariant?.color || "").trim() || String(variant.color || "").trim().toLocaleLowerCase("es") === String(requestedVariant.color).trim().toLocaleLowerCase("es"))
        )
      : null;
    let selectedVariant =
      routeVariant ||
      variants.find(variant => effectiveVariantAvailability(variant) === "available") ||
      variants[0];

    const variantArea = $("#variant-options-area");

    renderVariantControls(product, variants, selectedVariant);

    variantArea?.addEventListener("click", event => {
      const button = event.target.closest("[data-variant-dimension]");
      if (!button) return;

      if (button.dataset.variantDimension === "configuration") {
        const matching = variants.filter(variant =>
          variant.storage === (button.dataset.variantStorage || "") &&
          variant.ram === (button.dataset.variantRam || "")
        );
        selectedVariant = matching.find(variant => variant.color === selectedVariant.color && effectiveVariantAvailability(variant) === "available")
          || matching.find(variant => effectiveVariantAvailability(variant) === "available")
          || matching.find(variant => variant.color === selectedVariant.color)
          || matching[0]
          || selectedVariant;
      } else {
        const candidates = button.dataset.variantDimension === "color"
          ? variants.filter(variant =>
              String(variant.storage || "").trim() === String(selectedVariant.storage || "").trim() &&
              String(variant.ram || "").trim() === String(selectedVariant.ram || "").trim()
            )
          : variants;
        selectedVariant = chooseVariant(candidates, selectedVariant, button.dataset.variantDimension, button.dataset.variantValue);
      }
      renderVariantControls(product, variants, selectedVariant);
    });
  }

  setCatalogDetailOverlayOffset();
  lockCatalogScrollPosition();
  productDetailPage?.classList.remove("hidden");
  if (productHeaderBack) productHeaderBack.hidden = false;
  document.querySelector("main")?.classList.add("is-product-detail-view");
  document.body.classList.add("product-detail-active");
  document.title = `${product.name || "Producto"} | JB TECH`;
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) canonical.href = productLink(product);
}

document.querySelectorAll("#product-grid, #featured-grid, #high-performance-grid, #quality-price-grid, #top-gaming-grid").forEach(productGrid => productGrid.addEventListener("click", event => {
  const target = event.target instanceof Element ? event.target : null;
  const link = target?.closest("a[data-details]");
  if (!link) return;
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;

  const productId = link.getAttribute("data-details");
  const product = products.find(item => String(item.id) === productId);
  if (!product) return;

  event.preventDefault();
  const scrollY = window.scrollY;
  window.history.replaceState({ ...(window.history.state || {}), catalogScrollY: scrollY }, document.title, window.location.href);
  window.history.pushState({ productDetailRoute: true, catalogScrollY: scrollY, productId: String(product.id) }, document.title, productLink(product));
  openProduct(product);
}));

categoryFilters.addEventListener("click", event => {
  const button = event.target.closest("[data-category]");
  if (!button) return;

  selectedCategory = button.dataset.category;
  updateSubcategoryFilter();
  renderProducts();
});

function applyCatalogSearch() {
  renderProducts();
  closeBrandFilterMenu();
  searchInput?.blur();

  const target = resultsHeading || grid;
  if (!target) return;
  const scrollToTarget = () => {
    const stickyHeader = document.querySelector(".site-header");
    const headerOffset = (stickyHeader?.getBoundingClientRect().height || 0) + 12;
    const top = Math.max(0, window.scrollY + target.getBoundingClientRect().top - headerOffset);
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    window.scrollTo({ top, behavior: reducedMotion ? "auto" : "smooth" });
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => requestAnimationFrame(scrollToTarget));
  } else {
    scrollToTarget();
  }
}

searchInput?.addEventListener("input", renderProducts);
searchInput?.addEventListener("keydown", event => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  applyCatalogSearch();
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
subcategoryFilter?.addEventListener("change", () => {
  selectedSubcategory = subcategoryFilter.value || "";
  renderProducts();
});
catalogSortSelect?.addEventListener("change", renderProducts);
minPriceInput?.addEventListener("input", renderProducts);
maxPriceInput?.addEventListener("input", renderProducts);
clearPriceFilterButton?.addEventListener("click", () => {
  if (searchInput) searchInput.value = "";
  selectedBrand = "";
  selectedSubcategory = "";
  if (subcategoryFilter) subcategoryFilter.value = "";
  if (brandFilterSearch) brandFilterSearch.value = "";
  updateBrandFilterLabel();
  closeBrandFilterMenu();
  if (catalogSortSelect) catalogSortSelect.value = "recent";
  if (minPriceInput) minPriceInput.value = "";
  if (maxPriceInput) maxPriceInput.value = "";
  const allCategoryButton = categoryFilters?.querySelector('[data-category="all"]');
  if (allCategoryButton) allCategoryButton.click();
  else {
    selectedCategory = "all";
    renderProducts();
  }
});

function readProductRoute() {
  const url = new URL(window.location.href);
  const variant = {
    storage: url.searchParams.get("storage") || "",
    ram: url.searchParams.get("ram") || "",
    color: url.searchParams.get("color") || ""
  };
  const queryId = url.searchParams.get("producto");
  if (queryId) return { id: queryId, legacy: false, ...variant };
  const match = url.hash.match(/^#producto=(.+)$/);
  if (!match) return { id: "", legacy: false, ...variant };
  let id = match[1];
  try { id = decodeURIComponent(id); } catch { /* Conservar el ID heredado. */ }
  return { id, legacy: true, ...variant };
}

function showCatalogView() {
  productDetailPage?.classList.add("hidden");
  if (productHeaderBack) productHeaderBack.hidden = true;
  document.querySelector("main")?.classList.remove("is-product-detail-view");
  document.body.classList.remove("product-detail-active");
  document.documentElement.style.removeProperty("--catalog-detail-overlay-top");
  document.title = catalogDocumentTitle;
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical && catalogCanonical) canonical.href = catalogCanonical;
  if (dialogContent) dialogContent.innerHTML = "";
  restoreCatalogScrollPosition();
}

function handleProductRoute() {
  const route = readProductRoute();
  if (!route.id) {
    const wasDetail = document.body.classList.contains("product-detail-active");
    const scrollY = Number(window.history.state?.catalogScrollY) || 0;
    showCatalogView();
    if (wasDetail && Math.abs(window.scrollY - scrollY) > 2) {
      window.scrollTo({ top: scrollY, behavior: "instant" });
    }
    return;
  }
  const product = products.find(item => String(item.id) === route.id);
  if (!product) {
    showCatalogView();
    statusNode.textContent = "El producto solicitado no está publicado o el enlace ya no es válido.";
    return;
  }
  if (route.legacy) {
    window.history.replaceState(window.history.state, document.title, productLink(product));
  }
  openProduct(product, route);
}


/* Cierre por teclado de la ficha de producto sin desplazar el catálogo. */
document.addEventListener("keydown", event => {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  if (!document.body.classList.contains("product-detail-active")) return;
  if (document.querySelector("dialog[open]")) return;

  event.preventDefault();
  const nextState = { ...(window.history.state || {}) };
  delete nextState.productDetailRoute;
  delete nextState.productId;

  const url = new URL(window.location.href);
  url.searchParams.delete("producto");
  url.hash = "";
  window.history.replaceState(nextState, document.title, url.href);
  showCatalogView();
});

productHeaderBack?.addEventListener("click", () => {
  if (window.history.state?.productDetailRoute) {
    window.history.back();
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.delete("producto");
  url.hash = "";
  window.history.replaceState(window.history.state, document.title, url.href);
  showCatalogView();
  window.scrollTo({ top: 0, behavior: "auto" });
});

async function initializeCatalog() {
  if (!supabase) {
    statusNode.textContent =
      "Catálogo en preparación: falta conectar el proyecto de Supabase en config.js.";
    grid.innerHTML = "";
    return;
  }

  let data;
  try {
    const response = await supabase
      .from("products")
      .select("*")
      .eq("catalog_type", "technology")
      .eq("is_published", true)
      .eq("workflow_status", "published")
      .is("deleted_at", null)
      .order("featured", { ascending: false })
      .order("published_at", { ascending: false });

    if (response.error) throw response.error;
    data = response.data || [];
  } catch (error) {
    statusNode.textContent =
      "No pudimos consultar los productos en Supabase. " +
      (error?.message || "Revisá la conexión, la tabla products y sus políticas de lectura.");
    grid.innerHTML = "";
    console.error("Error real al consultar productos en Supabase:", error);
    return;
  }

  products = data;
  updateBrandFilterLabel();
  try {
    renderProducts();
  } catch (error) {
    statusNode.textContent =
      "Los productos llegaron, pero hubo un error al mostrarlos. Revisá la consola del navegador.";
    console.error("Error al dibujar las tarjetas del catálogo:", error);
    return;
  }

  try {
    handleProductRoute();
  } catch (error) {
    statusNode.textContent =
      "Encontramos el producto, pero falló la ficha de detalles. " +
      (error?.message || "Revisá la consola del navegador.");
    console.error("Error al abrir la ficha del producto:", error);
  }
  window.addEventListener("popstate", handleProductRoute);
  window.addEventListener("hashchange", handleProductRoute);
}

void recordCatalogPageVisit("technology");
initializeCatalog();
