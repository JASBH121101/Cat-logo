import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const CONFIG = window.CATALOG_CONFIG || {};
const whatsappNumber = String(CONFIG.whatsappNumber || "50557683840").replace(/\D/g, "");

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

const hasSupabaseConfig = Boolean(
  CONFIG.supabaseUrl &&
  CONFIG.supabaseAnonKey &&
  !String(CONFIG.supabaseUrl).includes("PON_AQUI") &&
  !String(CONFIG.supabaseAnonKey).includes("PON_AQUI")
);

if (hasSupabaseConfig) {
  supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
}

document.querySelector("#brand-name").textContent =
  CONFIG.storeName || "Catálogo de Tecnología";

document.querySelectorAll(".footer-brand span:last-child").forEach(element => {
  element.textContent = CONFIG.storeName || "Catálogo de Tecnología";
});

document.querySelector(".site-footer p").textContent =
  "Precios sujetos a confirmación. Financiamiento sujeto a requisitos y condiciones de aprobación.";

document.querySelector("#year").textContent = new Date().getFullYear();

const generalMessage =
  "Hola, quisiera consultar por los productos del catálogo, disponibilidad, precio y opciones de pago.";

const genericWhatsapp =
  `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(generalMessage)}`;

["header-whatsapp", "finance-whatsapp", "footer-whatsapp"].forEach(id => {
  const element = document.getElementById(id);

  if (element) {
    element.href = genericWhatsapp;
    element.target = "_blank";
    element.rel = "noopener";
  }
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

function formatUSD(value) {
  if (value === null || value === undefined || value === "") {
    return "Consultar";
  }

  return "US$" + new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2
  }).format(Number(value));
}

function formatNIO(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  return new Intl.NumberFormat("es-NI", {
    style: "currency",
    currency: "NIO",
    maximumFractionDigits: 2
  }).format(Number(value));
}

function specsArray(specs) {
  if (!specs) {
    return [];
  }

  if (Array.isArray(specs)) {
    return specs
      .map(item => typeof item === "string"
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
  let images = product.images;

  if (typeof images === "string") {
    try {
      images = JSON.parse(images);
    } catch {
      images = [images];
    }
  }

  if (!Array.isArray(images)) {
    images = [];
  }

  return [...images, product.image_url]
    .filter(value => typeof value === "string" && value.trim());
}

/* Lee los colores guardados en la columna JSONB products.colors. */
function getProductColors(product) {
  let colors = product?.colors;

  if (typeof colors === "string") {
    try {
      colors = JSON.parse(colors);
    } catch {
      colors = [];
    }
  }

  if (!Array.isArray(colors)) return [];

  return colors.map(color => {
    if (typeof color === "string") {
      return {
        name: color.trim(),
        type: "available",
        image_url: ""
      };
    }

    if (!color || typeof color !== "object") return null;

    return {
      name: String(color.name || "").trim(),
      type: color.type === "order" ? "order" : "available",
      image_url: String(color.image_url || color.imageUrl || "").trim()
    };
  }).filter(color => color && color.name);
}

function colorStatusLabel(color) {
  return color.type === "order" ? "Por pedido" : "Disponible";
}

/* Resumen compacto de los colores en la tarjeta del catálogo. */
function renderColorSummary(product) {
  const colors = getProductColors(product);
  if (!colors.length) return "";

  const visible = colors.slice(0, 4).map(color => `
    <span class="product-color-chip">
      ${
        color.image_url
          ? `<img src="${escapeHtml(color.image_url)}" alt="" loading="lazy" onerror="this.style.display='none'">`
          : '<span class="product-color-dot" aria-hidden="true"></span>'
      }
      ${escapeHtml(color.name)}
      ${color.type === "order" ? "<small>Pedido</small>" : ""}
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

/* Cada color tiene su propio enlace para consultar por WhatsApp. */
function renderColorOptions(product) {
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
                  ? `<img
                       src="${escapeHtml(color.image_url)}"
                       alt="${escapeHtml(`${product.name} color ${color.name}`)}"
                       loading="lazy"
                     >`
                  : '<span class="product-color-dot" aria-hidden="true"></span>'
              }
            </div>

            <div class="dialog-color-info">
              <strong>${escapeHtml(color.name)}</strong>

              <span class="color-availability ${color.type === "order" ? "order" : "available"}">
                ${escapeHtml(colorStatusLabel(color))}
              </span>

              <a
                href="${escapeHtml(whatsAppProductLink(product, color))}"
                target="_blank"
                rel="noopener"
              >Consultar este color ↗</a>
            </div>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function imageMarkup(product, className = "") {
  const url = getProductImages(product)[0] || "";

  if (url) {
    return `
      <img
        class="${className}"
        src="${escapeHtml(url)}"
        alt="${escapeHtml(product.name)}"
        loading="lazy"
        onerror="this.remove()"
      >
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

function whatsAppProductLink(product, color = null) {
  const price = formatUSD(product.price_usd);

  const selectedColor = color
    ? `Color de interés: ${color.name} (${colorStatusLabel(color)}). `
    : "";

  const message =
    `Hola, me interesa este producto: ${product.name}. ` +
    `Precio de referencia: ${price}. ` +
    selectedColor +
    `Enlace del artículo: ${productLink(product)}. ` +
    "Quisiera confirmar disponibilidad, opciones de financiamiento y costo de entrega.";

  return `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;
}

function renderCard(product) {
  const specs = specsArray(product.specifications).slice(0, 3);
  const image = imageMarkup(product);

  const badge = product.featured
    ? '<span class="product-badge featured-badge">DESTACADO</span>'
    : "";

  const availability = product.availability === "Agotado temporalmente"
    ? '<span class="product-badge">CONSULTAR</span>'
    : "";

  const nio = formatNIO(product.price_nio);

  return `
    <article class="product-card">
      <div class="product-image">
        ${badge}
        ${availability}
        ${image}
      </div>

      <div class="product-card-content">
        <div class="product-category">
          ${escapeHtml(product.category || "Tecnología")}
        </div>

        <h3>${escapeHtml(product.name)}</h3>

        <p class="product-description">
          ${escapeHtml(
            product.description ||
            "Consultá características, disponibilidad y precio final."
          )}
        </p>

        ${
          specs.length
            ? `<div class="product-specs">
                ${specs.map(spec =>
                  `<span class="spec-pill">${escapeHtml(spec)}</span>`
                ).join("")}
              </div>`
            : ""
        }

        ${renderColorSummary(product)}

        <div class="product-price-label">Precio de referencia</div>

        <div class="product-price">
          ${escapeHtml(formatUSD(product.price_usd))}
        </div>

        ${
          nio
            ? `<div class="product-price-secondary">${escapeHtml(nio)}</div>`
            : ""
        }

        <div class="product-financing">
          Financiamiento por crédito o tarjeta · Consultá condiciones
        </div>

        <div class="product-actions">
          <a
            class="buy-button"
            href="${escapeHtml(whatsAppProductLink(product))}"
            target="_blank"
            rel="noopener"
          >
            Consultar / comprar <span aria-hidden="true">↗</span>
          </a>

          <button
            class="detail-button"
            type="button"
            data-details="${escapeHtml(product.id)}"
            aria-label="Ver detalles de ${escapeHtml(product.name)}"
          >＋</button>
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
      product.category === selectedCategory;

    const searchableFields = [
      product.name,
      product.brand,
      product.model,
      product.category,
      product.description,
      ...getProductColors(product).map(color => color.name),
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
    ? `${products.length} producto${products.length === 1 ? "" : "s"} publicado${products.length === 1 ? "" : "s"}`
    : "Todavía no hay productos publicados.";

  categoryFilters.querySelectorAll("[data-category]").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.category === selectedCategory
    );
  });
}

function openProduct(product) {
  const image = getProductImages(product)[0] || "";
  const specs = specsArray(product.specifications);

  const warranty =
    product.warranty_months !== null &&
    product.warranty_months !== undefined &&
    product.warranty_months !== ""
      ? `<p><b>Garantía:</b> ${escapeHtml(product.warranty_months)} meses, según catálogo.</p>`
      : "";

  const nio = formatNIO(product.price_nio);

  dialogContent.innerHTML = `
    <div class="dialog-layout">
      <div class="dialog-image">
        ${
          image
            ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}">`
            : `<div class="photo-placeholder">
                 <span class="placeholder-icon">▧</span>
                 <span>Foto por agregar</span>
               </div>`
        }
      </div>

      <div class="dialog-detail">
        <div class="product-category">
          ${escapeHtml(product.category || "Tecnología")}
        </div>

        <h2>${escapeHtml(product.name)}</h2>

        <p>
          ${escapeHtml(
            product.description ||
            "Consultá disponibilidad y características."
          )}
        </p>

        <div class="product-price-label">Precio de referencia</div>

        <div class="product-price">
          ${escapeHtml(formatUSD(product.price_usd))}
        </div>

        ${nio ? `<p>${escapeHtml(nio)}</p>` : ""}
        ${warranty}
        ${renderColorOptions(product)}

        <h3>Especificaciones</h3>

        ${
          specs.length
            ? `<ul class="dialog-specs">
                ${specs.map(spec => `<li>${escapeHtml(spec)}</li>`).join("")}
              </ul>`
            : "<p>Consultá las especificaciones confirmadas de este modelo.</p>"
        }

        <p>
          <b>Financiamiento:</b>
          ${escapeHtml(
            product.financing_note ||
            "Mediante crédito o tarjeta; consultar requisitos y condiciones."
          )}
        </p>

        <p>
          <b>Entrega:</b>
          Centro de Managua gratis. Fuera del centro, costo según kilometraje.
          Departamentos por CargoTrans, con costo según destino.
        </p>

        <a
          class="button button-primary"
          href="${escapeHtml(whatsAppProductLink(product))}"
          target="_blank"
          rel="noopener"
        >
          Consultar por WhatsApp ↗
        </a>
      </div>
    </div>
  `;

  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "open");
  }
}

grid.addEventListener("click", event => {
  const button = event.target.closest("[data-details]");

  if (!button) {
    return;
  }

  const product = products.find(
    item => String(item.id) === button.dataset.details
  );

  if (product) {
    openProduct(product);
  }
});

categoryFilters.addEventListener("click", event => {
  const button = event.target.closest("[data-category]");

  if (!button) {
    return;
  }

  selectedCategory = button.dataset.category;
  renderProducts();
});

searchInput.addEventListener("input", renderProducts);

document.querySelector("#dialog-close").addEventListener("click", () => {
  dialog.close();
});

dialog.addEventListener("click", event => {
  if (event.target === dialog) {
    dialog.close();
  }
});

async function initializeCatalog() {
  if (!supabase) {
    statusNode.textContent =
      "Catálogo en preparación: falta conectar el proyecto de Supabase en config.js.";
    grid.innerHTML = "";
    return;
  }

  try {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("is_published", true)
      .order("featured", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    products = data || [];
    renderProducts();

    const match = window.location.hash.match(/^#producto=(.+)$/);

    if (match) {
      const id = decodeURIComponent(match[1]);
      const product = products.find(item => String(item.id) === id);

      if (product) {
        openProduct(product);
      }
    }
  } catch (error) {
    statusNode.textContent =
      "No pudimos cargar el catálogo. Revisá la conexión de Supabase y las políticas de acceso.";

    console.error("Error al cargar productos", error);
  }
}

initializeCatalog();