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

  return [...new Set([...list, product?.image_url].filter(value => typeof value === "string" && value.trim()))];
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
      availability: item.availability === "order" ? "order" : item.availability === "out_of_stock" ? "out_of_stock" : "available",
      images: Array.isArray(item.images) ? item.images.filter(url => typeof url === "string" && url.trim()) : [String(item.image_url || item.imageUrl || "").trim()].filter(Boolean),
      image_url: String((Array.isArray(item.images) && item.images[0]) || item.image_url || item.imageUrl || "").trim()
    };
  }).filter(item => item && (item.storage || item.ram || item.color))
    .sort((left, right) => {
      const dimension = value => {
        const match = String(value || "").match(/[0-9]+(?:[.,][0-9]+)?/);
        return match ? Number(match[0].replace(",", ".")) : Number.POSITIVE_INFINITY;
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

function getProductColors(product) {
  const variants = getProductVariants(product);

  if (variants.length) {
    const map = new Map();

    variants.forEach(variant => {
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
      type: color.type === "order" ? "order" : "available",
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

function renderProductColorSwatches(product) {
  const colors = getProductColors(product)
    .filter(color => color.name && color.type !== "out_of_stock");
  if (!colors.length) return "";

  const visible = colors.slice(0, 6).map(color => {
    const hex = displayColorHex(color.name, color.color_hex);
    const status = color.type === "order" ? "Disponible por pedido" : "Disponible";
    return `
      <span class="product-card-color-option">
        <button class="product-card-color-swatch"
                type="button"
                style="--swatch-color: ${hex}"
                title="${escapeHtml(color.name)}"
                data-product-color="${escapeHtml(color.name)}"
                aria-label="${escapeHtml(color.name)} · ${status}"
                aria-pressed="false"></button>
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
           onerror="this.remove()">
    `;
  }

  return `
    <div class="photo-placeholder">
      <span class="placeholder-icon">▧</span>
      <span>Foto por agregar</span>
    </div>
  `;
}

function productLink(product) {
  const page = new URL("./", window.location.href);
  page.hash = `producto=${encodeURIComponent(product.id)}`;
  return page.href;
}

function buildProductWhatsAppMessage(product, variant = null, fallbackColor = null) {
  const parts = [`Hola, me interesa este producto: ${product.name}.`];

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
  parts.push("Quisiera confirmar disponibilidad, condiciones de financiamiento y costo de entrega.");

  return parts.join(" ");
}

function startingPrice(product, field = "price_usd") {
  const variants = getProductVariants(product);

  const pricedVariants = variants.filter(variant =>
    variant[field] !== null &&
    variant[field] !== undefined &&
    variant[field] !== "" &&
    Number.isFinite(Number(variant[field]))
  );

  /* Priorizar configuraciones disponibles para no anunciar primero un precio agotado. */
  const availableVariants = pricedVariants.filter(
    variant => variant.availability === "available"
  );
  const candidates = availableVariants.length ? availableVariants : pricedVariants;
  const values = candidates.map(variant => Number(variant[field]));

  /* Si las variantes no tienen precio, mostrar el precio base registrado. */
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
  const configurations = [...new Set(variants.map(variant => {
    const storage = String(variant.storage || "").trim();
    const ram = String(variant.ram || "").trim();
    if (storage && ram) return `${/\bram\b/i.test(ram) ? ram : `${ram} RAM`} / ${storage}`;
    return ram || storage;
  }).filter(Boolean))];
  const capacity = configurations[0] || "";
  const price = startingPrice(product, "price_usd");
  const nioPrice = startingPrice(product, "price_nio");
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
        ${renderProductColorSwatches(product)}
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

function visibleProducts() {
  const query = (searchInput.value || "").trim().toLocaleLowerCase("es");

  return products.filter(product => {
    const categoryMatches =
      selectedCategory === "all" ||
      String(product.category || "").toLocaleLowerCase("es") ===
        selectedCategory.toLocaleLowerCase("es");

    const variants = getProductVariants(product);

    const searchableFields = [
      product.name,
      product.brand,
      product.model,
      product.category,
      product.description,
      ...getProductColors(product).map(color => color.name),
      ...variants.flatMap(variant => [
        variant.storage,
        variant.ram,
        variant.color
      ]),
      ...specsArray(product.specifications)
    ];

    const haystack = searchableFields.join(" ").toLocaleLowerCase("es");
    return categoryMatches && (!query || haystack.includes(query));
  });
}

function renderProducts() {
  const list = visibleProducts();

  grid.innerHTML = list.map(renderCard).join("");
  emptyNode.classList.toggle("hidden", list.length > 0);

  statusNode.textContent = products.length
    ? `${list.length} de ${products.length} producto${products.length === 1 ? "" : "s"} publicado${products.length === 1 ? "" : "s"}`
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
    variants.forEach(variant => {
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

  const financingLink = $("#dialog-financing-link");
  if (financingLink) {
    financingLink.href = buildWhatsAppLink(buildProductWhatsAppMessage(product, selected));
  }

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

    <a id="variant-whatsapp-link"
       class="button button-primary variant-whatsapp-button"
       href="${escapeHtml(buildWhatsAppLink(buildProductWhatsAppMessage(product, selected)))}"
       target="_blank"
       rel="noopener">Consultar por WhatsApp ↗</a>
  `;

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
              <span class="color-availability ${color.type === "order" ? "order" : "available"}">
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
               ${renderLegacyColorOptions(product)}
               <a class="button button-primary"
                  href="${escapeHtml(buildWhatsAppLink(buildProductWhatsAppMessage(product)))}"
                  target="_blank" rel="noopener">Consultar por WhatsApp ↗</a>`
        }

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

        <a id="dialog-financing-link"
           class="button button-secondary dialog-financing-button"
           href="${escapeHtml(buildWhatsAppLink(buildProductWhatsAppMessage(product)))}"
           target="_blank"
           rel="noopener">Consultar financiación por WhatsApp ↗</a>

        <p><b>Disponibilidad general:</b>
          ${escapeHtml(productAvailabilityLabel(product.availability))}
        </p>

        <p><b>Entrega:</b>
          Centro de Managua gratis. Fuera del centro, costo según kilometraje.
          Departamentos por CargoTrans, con costo según destino.
        </p>
      </div>
    </div>
  `;

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

grid.addEventListener("click", event => {
  const target = event.target instanceof Element ? event.target : null;
  const colorButton = target?.closest("button[data-product-color]");
  if (colorButton) {
    const card = colorButton.closest(".product-card");
    if (!card) return;
    card.querySelectorAll("button[data-product-color]").forEach(button => {
      const selected = button === colorButton;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    return;
  }

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
});

categoryFilters.addEventListener("click", event => {
  const button = event.target.closest("[data-category]");
  if (!button) return;

  selectedCategory = button.dataset.category;
  renderProducts();
});

searchInput.addEventListener("input", renderProducts);

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
