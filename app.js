import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const CONFIG = window.CATALOG_CONFIG || {};

// Selector breve usado por los controles de la ficha de producto.
const $ = selector => document.querySelector(selector);
const whatsappNumber = String(CONFIG.whatsappNumber || "").replace(/\D/g, "");

const grid = document.querySelector("#product-grid");
const statusNode = document.querySelector("#catalog-status");
const emptyNode = document.querySelector("#empty-results");
const searchInput = document.querySelector("#search-input");
const dialog = document.querySelector("#product-dialog");
const dialogContent = document.querySelector("#dialog-content");
const categoryFilters = document.querySelector("#category-filters");
const featuredSection = document.querySelector("#featured-section");
const featuredGrid = document.querySelector("#featured-grid");
const featuredCount = document.querySelector("#featured-count");
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

// Analytics: record product views and WhatsApp intent, including the selected variant.
async function recordCatalogEvent(productId, eventType, variant = {}) {
  if (!supabase || !productId || !["view", "whatsapp_click"].includes(eventType)) return;

  const cleanValue = value => {
    const normalized = String(value ?? "").trim();
    return normalized || null;
  };

  try {
    const { error } = await supabase.from("catalog_events").insert({
      product_id: productId,
      event_type: eventType,
      variant_color: cleanValue(variant.color),
      variant_ram: cleanValue(variant.ram),
      variant_storage: cleanValue(variant.storage)
    });
    if (error) console.warn("No se pudo registrar el evento de analítica:", error.message);
  } catch (error) {
    console.warn("No se pudo registrar el evento de analítica.", error);
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
  "Hola, quisiera consultar por los productos del catálogo, disponibilidad, precio y opciones de pago.";

["header-whatsapp", "footer-whatsapp"].forEach(id => {
  const element = document.getElementById(id);
  if (!element) return;

  element.href = buildWhatsAppLink(generalMessage);
  element.target = "_blank";
  element.rel = "noopener";
});


function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
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

function specsArray(specs) {
  specs = parseJSON(specs, {});
  if (!specs) return [];

  if (Array.isArray(specs)) {
    return specs.map(item => typeof item === "string"
      ? item
      : `${item.label || item.name || "Dato"}: ${item.value || ""}`)
      .filter(Boolean);
  }

  if (typeof specs === "object") {
    return Object.entries(specs)
      .map(([key, value]) => `${key}: ${value}`)
      .filter(Boolean);
  }

  return [];
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
  return value === "order" || value === "on_order" ? "Por pedido" : value === "out_of_stock" ? "No disponible" : "Disponible";
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
          type: variant.availability,
          image_url: variant.image_url,
          color_hex: variant.color_hex
        });
      } else {
        if (variant.availability === "available") {
          previous.type = "available";
        } else if (variant.availability === "order" && previous.type !== "available") {
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
grid.addEventListener("error", event => {
  const img = event.target;
  if (!(img instanceof HTMLImageElement) || !img.matches("[data-product-image]")) return;
  const container = img.closest(".product-image");
  img.remove();
  if (container && !container.querySelector(".photo-placeholder")) {
    container.insertAdjacentHTML("beforeend", `<div class="photo-placeholder"><span class="placeholder-icon">▧</span><span>Imagen no disponible</span></div>`);
  }
}, true);

function productLink(product) {
  const page = new URL("./", window.location.href);
  page.hash = `producto=${encodeURIComponent(product.id)}`;
  return page.href;
}

function buildProductWhatsAppMessage(product, variant = null, fallbackColor = null) {
  const parts = [`Hola, estoy seguro de mi elección y quiero comprar este producto: ${product.name}.`];

  if (variant) {
    const configuration = [
      variant.storage,
      variant.ram,
      variant.color
    ].filter(Boolean).join(" · ");

    if (configuration) {
      parts.push(`Configuración seleccionada: ${configuration}.`);
    }

    parts.push(`Precio en dólares: ${formatUSD(variant.price_usd)}.`);

    const nio = formatNIO(variant.price_nio);
    if (nio) parts.push(`Precio en córdobas: ${nio}.`);

    parts.push(`Estado de la variante: ${colorStatusLabel(variant.availability)}.`);
  } else {
    parts.push(`Precio de referencia: ${formatUSD(product.price_usd)}.`);

    if (fallbackColor) {
      parts.push(
        `Color de interés: ${fallbackColor.name} (${colorStatusLabel(fallbackColor.type)}).`
      );
    }
  }

  parts.push(`Enlace del artículo: ${productLink(product)}.`);
  parts.push("Quisiera confirmar la disponibilidad final, la forma de pago y el costo de entrega para realizar la compra.");

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
    parts.push(`Disponibilidad de esta variante: ${colorStatusLabel(variant.availability)}.`);
  } else {
    const usdPrice = startingPrice(product, "price_usd");
    if (usdPrice !== null && usdPrice !== undefined) parts.push(`Precio de referencia: ${formatUSD(usdPrice)}.`);
    const nio = formatNIO(startingPrice(product, "price_nio"));
    if (nio) parts.push(`Precio en córdobas: ${nio}.`);
  }
  parts.push(`Enlace del producto: ${productLink(product)}.`);
  parts.push(normalizedType === "credit_card"
    ? "Quisiera saber qué tarjetas aceptan, si hay posibilidad de pagar en cuotas, y cuáles son los requisitos, recargos o comisiones aplicables."
    : "Quisiera conocer los requisitos, plazos, cuotas y condiciones de aprobación disponibles.");
  return parts.join(" ");
}

function buildFinancingWhatsAppMessage(product, variant = null) {
  return buildPaymentWhatsAppMessage(product, variant, "financing");
}

function updateProductContactLinks(product, variant = null, fallbackColor = null) {
  const buyLink = $("#dialog-buy-link");
  const financingChoice = $("#dialog-financing-choice");
  const creditCardChoice = $("#dialog-credit-card-choice");
  if (buyLink) buyLink.href = buildWhatsAppLink(buildProductWhatsAppMessage(product, variant, fallbackColor));
  if (financingChoice) financingChoice.href = buildWhatsAppLink(buildPaymentWhatsAppMessage(product, variant, "financing"));
  if (creditCardChoice) creditCardChoice.href = buildWhatsAppLink(buildPaymentWhatsAppMessage(product, variant, "credit_card"));
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
    variant => variant.availability === "available"
  );
  if (availableVariants.length) {
    return Math.min(...availableVariants.map(variant => Number(variant[field])));
  }

  /* Si hay variantes disponibles pero no tienen precio, no anunciar el precio
     de una variante agotada o solo por pedido como si fuera la opción disponible. */
  const hasAvailableUnpricedVariant = variants.some(
    variant => variant.availability === "available"
  );
  if (hasAvailableUnpricedVariant) return product[field];

  const values = pricedVariants.map(variant => Number(variant[field]));

  /* Si no existe una variante disponible, conservar el precio de referencia existente. */
  return values.length ? Math.min(...values) : product[field];
}

function renderCard(product) {
  const image = imageMarkup(product);
  const variants = getProductVariants(product);
  const badge = product.featured
    ? '<span class="product-badge featured-badge">✦ DESTACADO</span>'
    : "";
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
        variant.availability === "available" &&
        variant.price_usd !== null &&
        Number.isFinite(variant.price_usd)
      )
      .sort((left, right) => left.price_usd - right.price_usd)[0] ||
    variants.find(variant => variant.availability === "available") ||
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
    <article class="product-card${product.featured ? " featured-product-card" : ""}">
      <div class="product-image">
        ${badge}
        ${availabilityBadge}
        ${image}
      </div>
      <div class="product-card-content">
        <div class="product-category">${escapeHtml(product.category || "Tecnología")}</div>
        <h3>${escapeHtml(title)}</h3>
        ${capacity ? `<p class="product-card-capacity">${escapeHtml(capacity)}</p>` : ""}
        ${renderProductColorSwatches(product, cardConfiguration)}
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

function readPriceBound(input) {
  if (!input) return null;
  const raw = String(input.value || "").trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function hasActiveCatalogFilters() {
  return Boolean((searchInput?.value || "").trim() || selectedCategory !== "all" ||
    readPriceBound(minPriceInput) !== null || readPriceBound(maxPriceInput) !== null);
}

function visibleProducts() {
  const query = (searchInput.value || "").trim().toLocaleLowerCase("es");
  const minPrice = readPriceBound(minPriceInput);
  const maxPrice = readPriceBound(maxPriceInput);
  const validRange = minPrice === null || maxPrice === null || minPrice <= maxPrice;
  if (priceFilterFeedback) priceFilterFeedback.textContent = validRange ? "" : "El mínimo no puede superar al máximo."; 
  return products.filter(product => {
    if (!validRange) return false;
    const categoryMatches = selectedCategory === "all" || String(product.category || "").toLocaleLowerCase("es") === selectedCategory.toLocaleLowerCase("es");
    const variants = getProductVariants(product);
    const searchableFields = [
      product.name, product.brand, product.model, product.category, product.description,
      ...getProductColors(product).map(color => color.name),
      ...variants.flatMap(variant => [variant.storage, variant.ram, variant.color]),
      ...specsArray(product.specifications)
    ];
    const haystack = searchableFields.join(" ").toLocaleLowerCase("es");
    const queryMatches = !query || haystack.includes(query);
    let priceMatches = true;
    if (minPrice !== null || maxPrice !== null) {
      const rawPrice = startingPrice(product, "price_usd");
      const price = rawPrice === null || rawPrice === undefined || rawPrice === "" ? NaN : Number(rawPrice);
      priceMatches = Number.isFinite(price) && (minPrice === null || price >= minPrice) && (maxPrice === null || price <= maxPrice);
    }
    return categoryMatches && queryMatches && priceMatches;
  });
}

function renderProducts() {
  const list = visibleProducts();
  const hasFilters = hasActiveCatalogFilters();
  const featured = hasFilters ? [] : list.filter(product => Boolean(product.featured));
  const regularProducts = hasFilters ? list : list.filter(product => !product.featured);
  if (featuredSection && featuredGrid) {
    featuredSection.classList.toggle("hidden", featured.length === 0);
    featuredGrid.innerHTML = featured.map(renderCard).join("");
  }
  if (featuredCount) featuredCount.textContent = featured.length ? `${featured.length} destacado${featured.length === 1 ? "" : "s"}` : "";
  if (resultsEyebrow) resultsEyebrow.textContent = hasFilters ? "TU BÚSQUEDA" : "CATÁLOGO COMPLETO";
  if (resultsTitle) resultsTitle.textContent = hasFilters ? "Resultados" : "Explorá todo el catálogo";
  if (resultsHeading) resultsHeading.classList.toggle("hidden", !hasFilters && regularProducts.length === 0);
  grid.innerHTML = regularProducts.map(renderCard).join("");
  emptyNode.classList.toggle("hidden", list.length > 0);
  if (clearPriceFilterButton) clearPriceFilterButton.disabled = readPriceBound(minPriceInput) === null && readPriceBound(maxPriceInput) === null;
  statusNode.textContent = products.length
    ? hasFilters
      ? `${list.length} resultado${list.length === 1 ? "" : "s"} de ${products.length} producto${products.length === 1 ? "" : "s"} publicado${products.length === 1 ? "" : "s"}`
      : `${products.length} producto${products.length === 1 ? "" : "s"} publicado${products.length === 1 ? "" : "s"}${featured.length ? ` · ${featured.length} destacado${featured.length === 1 ? "" : "s"} en su sección` : ""}`
    : "Todavía no hay productos publicados.";
  categoryFilters.querySelectorAll("[data-category]").forEach(button => {
    button.classList.toggle("active", button.dataset.category === selectedCategory);
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
      if (label && !seen.has(key)) { seen.add(key); values.push({label, storage, ram}); }
    });
    const buttons = values.map(item => {
      const isSelected = selected.storage === item.storage && selected.ram === item.ram;
      return `<button type="button" class="variant-choice ${isSelected ? "selected" : ""}" data-variant-dimension="configuration" data-variant-storage="${escapeHtml(item.storage)}" data-variant-ram="${escapeHtml(item.ram)}" aria-pressed="${isSelected ? "true" : "false"}">${escapeHtml(item.label)}</button>`;
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
      const status = colorStatusLabel(candidate?.availability);

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
      <section class="variant-option-group">
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
  const status = colorStatusLabel(selected.availability);
  const isOrder = selected.availability === "order";
  const isUnavailable = selected.availability === "out_of_stock";

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

  const dialogImage = $("#dialog-image");
  if (dialogImage) {
    const chosenImages = selected.images?.length
      ? selected.images
      : selected.image_url
        ? [selected.image_url]
        : getProductImages(product);
    dialogImage.innerHTML = chosenImages.length
      ? `
        <div class="dialog-gallery-main">
          <img id="dialog-main-image" class="dialog-main-image"
               src="${escapeHtml(chosenImages[0])}"
               alt="${escapeHtml(`${product.name} ${configuration}`)}"
               loading="eager" decoding="async">
        </div>
        ${chosenImages.length > 1
          ? `<div class="dialog-gallery-thumbs" aria-label="Fotografías del producto">
              ${chosenImages.map((url, index) => `
                <button type="button"
                        class="dialog-gallery-thumb ${index === 0 ? "active" : ""}"
                        data-gallery-image="${escapeHtml(url)}"
                        aria-label="Ver fotografía ${index + 1}">
                  <img src="${escapeHtml(url)}" alt="" loading="lazy">
                </button>
              `).join("")}
            </div>`
          : ""}
      `
      : `<div class="photo-placeholder"><span class="placeholder-icon">▧</span><span>Foto por agregar</span></div>`;
  }
}

function renderLegacyColorOptions(product) {
  const colors = getProductColors(product);
  if (!colors.length) return "";

  return `
    <section class="dialog-colors" aria-labelledby="dialog-colors-title">
      <h3 id="dialog-colors-title">Colores disponibles y por pedido</h3>

      <div class="dialog-color-grid">
        ${colors.map(color => `
          <article class="dialog-color-card">
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

dialogContent.addEventListener("click", event => {
  const target = event.target instanceof Element ? event.target : null;
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
  const thumbnail = target?.closest("[data-gallery-image]");
  if (!thumbnail) return;
  const mainImage = dialogContent.querySelector("#dialog-main-image");
  if (mainImage) {
    mainImage.src = thumbnail.dataset.galleryImage;
    mainImage.style.visibility = "visible";
  }
  dialogContent.querySelectorAll("[data-gallery-image]").forEach(button => {
    button.classList.toggle("active", button === thumbnail);
  });
});

function openProduct(product) {
  dialogContent.dataset.analyticsProductId = String(product.id);
  dialogContent.dataset.analyticsVariantColor = "";
  dialogContent.dataset.analyticsVariantRam = "";
  dialogContent.dataset.analyticsVariantStorage = "";
  recordCatalogEvent(product.id, "view");
  const variants = getProductVariants(product);
  const specs = specsArray(product.specifications);
  const initialImage = getProductImages(product)[0] || "";

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
            ? `<img id="dialog-main-image" class="dialog-main-image" src="${escapeHtml(initialImage)}" alt="${escapeHtml(product.name)}" loading="eager" decoding="async" onerror="this.style.visibility='hidden'">`
            : `<div class="photo-placeholder"><span class="placeholder-icon">▧</span><span>Foto por agregar</span></div>`
        }
      </div>

      <div class="dialog-detail">
        <div class="product-category">${escapeHtml(product.category || "Tecnología")}</div>
        <h2>${escapeHtml(product.name)}</h2>

        <p>${escapeHtml(product.description || "Consultá disponibilidad y características.")}</p>

        ${
          variants.length
            ? `<div id="variant-options-area"></div>`
            : `<div class="product-price-label">Precio de referencia</div>
               <div class="product-price">${escapeHtml(formatUSD(product.price_usd))}</div>
               ${nio ? `<p>${escapeHtml(nio)}</p>` : ""}
               ${renderLegacyColorOptions(product)}`
        }

        <div class="product-contact-actions">
          <a id="dialog-buy-link" class="button button-primary dialog-buy-button" href="#" target="_blank" rel="noopener"><span aria-hidden="true">✓</span> Quiero comprar este producto</a>
          <button id="dialog-payment-options-toggle" class="button button-secondary dialog-payment-toggle" type="button" aria-expanded="false" aria-controls="dialog-payment-choice-panel">Consultar opciones de pago <span aria-hidden="true">⌄</span></button>
        </div>
        <div id="dialog-payment-choice-panel" class="payment-choice-panel" hidden>
          <div><strong>¿Qué querés consultar?</strong><p>Elegí el tema y WhatsApp abrirá el mensaje con los datos de este producto.</p></div>
          <div class="payment-choice-actions">
            <a id="dialog-financing-choice" class="button button-secondary payment-choice-button" href="#" target="_blank" rel="noopener">Financiamiento</a>
            <a id="dialog-credit-card-choice" class="button button-secondary payment-choice-button" href="#" target="_blank" rel="noopener">Compra con tarjeta de crédito</a>
          </div>
        </div>

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

  updateProductContactLinks(product);

  if (variants.length) {
    let selectedVariant =
      variants.find(variant => variant.availability === "available") ||
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
        selectedVariant = matching.find(variant => variant.color === selectedVariant.color && variant.availability === "available")
          || matching.find(variant => variant.availability === "available")
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

  if (typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
  } else {
    dialog.setAttribute("open", "open");
  }
}

document.querySelectorAll("#product-grid, #featured-grid").forEach(productGrid => productGrid.addEventListener("click", event => {
  const target = event.target instanceof Element ? event.target : null;
  const link = target?.closest("a[data-details]");
  if (!link) return;

  const productId = link.getAttribute("data-details");
  const product = products.find(item => String(item.id) === productId);
  if (!product) return;

  event.preventDefault();
  const productUrl = productLink(product);
  if (window.location.hash !== `#producto=${encodeURIComponent(product.id)}`) {
    window.history.pushState(window.history.state, document.title, productUrl);
  }
  openProduct(product);
}));

categoryFilters.addEventListener("click", event => {
  const button = event.target.closest("[data-category]");
  if (!button) return;

  selectedCategory = button.dataset.category;
  renderProducts();
});

searchInput.addEventListener("input", renderProducts);
minPriceInput?.addEventListener("input", renderProducts);
maxPriceInput?.addEventListener("input", renderProducts);
clearPriceFilterButton?.addEventListener("click", () => {
  if (minPriceInput) minPriceInput.value = "";
  if (maxPriceInput) maxPriceInput.value = "";
  renderProducts();
});

document.querySelector("#dialog-close").addEventListener("click", () => {
  if (dialog.open && typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
  if (window.location.hash.startsWith("#producto=")) {
    window.history.replaceState(window.history.state, document.title, window.location.pathname + window.location.search);
  }
});

dialog.addEventListener("click", event => {
  if (event.target !== dialog) return;
  if (dialog.open && typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
  if (window.location.hash.startsWith("#producto=")) {
    window.history.replaceState(window.history.state, document.title, window.location.pathname + window.location.search);
  }
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
      .eq("is_published", true)
      .order("featured", { ascending: false })
      .order("created_at", { ascending: false });

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
  try {
    renderProducts();
  } catch (error) {
    statusNode.textContent =
      "Los productos llegaron, pero hubo un error al mostrarlos. Revisá la consola del navegador.";
    console.error("Error al dibujar las tarjetas del catálogo:", error);
    return;
  }

  const openProductFromHash = () => {
    const match = window.location.hash.match(/^#producto=(.+)$/);
    if (!match) return;
    let id = match[1];
    try { id = decodeURIComponent(id); } catch { /* Usa el ID recibido. */ }
    const product = products.find(item => String(item.id) === id);
    if (!product) {
      statusNode.textContent =
        "El producto solicitado no está publicado o el enlace ya no es válido.";
      return;
    }

    try {
      openProduct(product);
    } catch (error) {
      statusNode.textContent =
        "Encontramos el producto, pero falló la ficha de detalles. " +
        (error?.message || "Revisá la consola del navegador.");
      console.error("Error al abrir la ficha del producto:", error);
    }
  };

  openProductFromHash();
  window.addEventListener("hashchange", openProductFromHash);
}

initializeCatalog();
