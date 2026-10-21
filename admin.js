import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/* =========================================================
   CT ADMINISTRACIÓN
   Sesión temporal por pestaña + inventario + variantes
   ========================================================= */

const CONFIG = window.CATALOG_CONFIG || {};

const configured = Boolean(
  CONFIG.supabaseUrl &&
  CONFIG.supabaseAnonKey &&
  !String(CONFIG.supabaseUrl).includes("PON_AQUI") &&
  !String(CONFIG.supabaseAnonKey).includes("PON_AQUI")
);

/* =========================================================
   SESIÓN: CERRAR AL RECARGAR
   ========================================================= */

/*
  Esta marca permanece en sessionStorage durante la vida de
  la pestaña. Si admin.js vuelve a ejecutarse, eliminamos la
  sesión anterior antes de inicializar el cliente de Supabase.

  Esto permite que una recarga normal del panel solicite
  nuevamente las credenciales.
*/

const ADMIN_PAGE_MARKER = "ct-admin-page-has-loaded";

function getSupabaseStorageKey() {
  try {
    const projectRef = new URL(CONFIG.supabaseUrl)
      .hostname
      .split(".")[0];

    return `sb-${projectRef}-auth-token`;
  } catch {
    return null;
  }
}

function clearSessionBeforeReloadedPanel() {
  try {
    const pageWasAlreadyLoaded =
      window.sessionStorage.getItem(ADMIN_PAGE_MARKER) === "1";

    if (pageWasAlreadyLoaded) {
      const storageKey = getSupabaseStorageKey();

      if (storageKey) {
        window.sessionStorage.removeItem(storageKey);
        window.localStorage.removeItem(storageKey);
      }
    }

    window.sessionStorage.setItem(ADMIN_PAGE_MARKER, "1");
  } catch (error) {
    console.warn(
      "No se pudo comprobar el estado previo de la sesión.",
      error
    );
  }
}

/*
  IMPORTANTE:
  Debe ejecutarse antes de createClient(), para evitar que
  Supabase recupere la sesión anterior al recargar la página.
*/
clearSessionBeforeReloadedPanel();

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

const loginPanel = $("#login-panel");
const dashboard = $("#dashboard");
const form = $("#product-form");

let currentUser = null;
let products = [];

const COLOR_PALETTE = [
  { name: "Negro", hex: "#242424" },
  { name: "Blanco", hex: "#F4F4F4" },
  { name: "Plata", hex: "#C5C9D0" },
  { name: "Gris", hex: "#777E8B" },
  { name: "Grafito", hex: "#454952" },
  { name: "Azul", hex: "#315A91" },
  { name: "Azul claro", hex: "#78A9E8" },
  { name: "Verde", hex: "#39785A" },
  { name: "Verde menta", hex: "#8ECDB8" },
  { name: "Dorado", hex: "#C8A45D" },
  { name: "Champán", hex: "#D8C3A0" },
  { name: "Morado", hex: "#7952A8" },
  { name: "Rosa", hex: "#D986A7" },
  { name: "Rojo", hex: "#C13A4B" },
  { name: "Naranja", hex: "#DE783E" },
  { name: "Amarillo", hex: "#E8C94B" }
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
  const normalized = String(value || "")
    .trim()
    .toLocaleLowerCase("es");

  return ["order", "on_order", "por pedido"].includes(normalized)
    ? "order"
    : "available";
}

/* =========================================================
   ALMACENAMIENTO Y CIERRE DE SESIÓN
   ========================================================= */

function authStorageKey() {
  return getSupabaseStorageKey();
}

/*
  Elimina una posible sesión antigua almacenada en localStorage
  por una versión anterior del panel.
*/
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

      image_url: String(
        item.image_url || item.imageUrl || ""
      ).trim()
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
    image_url: color.image_url
  }));
}

function colorPaletteOptions(variant) {
  const match = COLOR_PALETTE.find(item =>
    item.name.toLocaleLowerCase("es") ===
      String(variant.color || "").toLocaleLowerCase("es") &&
    item.hex.toLowerCase() ===
      validHex(variant.color_hex).toLowerCase()
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
  const value = {
    storage: String(variant.storage || "").trim(),
    ram: String(variant.ram || "").trim(),
    color: String(variant.color || "").trim(),
    color_hex: validHex(variant.color_hex || variant.hex),
    price_usd: variant.price_usd ?? "",
    price_nio: variant.price_nio ?? "",
    availability: normalizeVariantAvailability(variant.availability),
    image_url: String(variant.image_url || "").trim()
  };

  return `
    <article class="variant-admin-row" data-variant-row>
      <div class="variant-row-title">
        <strong data-variant-row-heading>
          Configuración del producto
        </strong>

        <button
          class="admin-mini-button danger"
          type="button"
          data-remove-variant
        >Quitar variante</button>
      </div>

      <div class="variant-fields-grid">
        <label>
          Almacenamiento / capacidad
          <input
            data-variant-storage
            maxlength="40"
            value="${escapeHtml(value.storage)}"
            placeholder="Ej. 512 GB"
          >
        </label>

        <label>
          Memoria RAM
          <input
            data-variant-ram
            maxlength="40"
            value="${escapeHtml(value.ram)}"
            placeholder="Ej. 12 GB"
          >
        </label>

        <label>
          Paleta de colores
          <select data-variant-palette>
            ${colorPaletteOptions(value)}
          </select>
        </label>

        <label>
          Nombre del color *
          <input
            data-variant-color
            maxlength="60"
            required
            value="${escapeHtml(value.color)}"
            placeholder="Ej. Azul titanio"
          >
        </label>

        <label class="variant-hex-label">
          Tono del color
          <span class="variant-hex-control">
            <input
              data-variant-hex
              type="color"
              value="${value.color_hex}"
              aria-label="Elegir tono del color"
            >
            <small>Podés ajustar el tono visualmente.</small>
          </span>
        </label>

        <label>
          Precio en dólares (opcional)
          <input
            data-variant-price-usd
            type="number"
            min="0"
            step="0.01"
            value="${escapeHtml(value.price_usd)}"
            placeholder="Ej. 999"
          >
        </label>

        <label>
          Precio en córdobas (opcional)
          <input
            data-variant-price-nio
            type="number"
            min="0"
            step="0.01"
            value="${escapeHtml(value.price_nio)}"
            placeholder="Ej. 36600"
          >
        </label>

        <label>
          Estado de esta combinación
          <select data-variant-availability>
            <option
              value="available"
              ${value.availability === "available" ? "selected" : ""}
            >Disponible</option>

            <option
              value="order"
              ${value.availability === "order" ? "selected" : ""}
            >Por pedido</option>
          </select>
        </label>

        <label class="variant-image-label">
          Foto del color (opcional)
          <input
            data-variant-image
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
          >
          <small>
            Podés reutilizar la foto de ese color en otras capacidades.
          </small>
        </label>

        <label class="variant-image-url-label">
          URL de foto existente (opcional)
          <input
            data-variant-image-url
            type="url"
            value="${escapeHtml(value.image_url)}"
            placeholder="https://..."
          >
        </label>
      </div>

      <p class="color-row-status" data-variant-status role="status"></p>
    </article>
  `;
}

function renderVariantRows(variants = []) {
  const container = $("#product-variants-list");

  if (!container) {
    return;
  }

  const normalized = normalizeVariants(variants);

  if (!normalized.length) {
    container.innerHTML = `
      <p class="variants-empty-hint">
        Todavía no agregaste variantes. Podés guardar el producto
        sin variantes y agregarlas después.
      </p>
    `;

    return;
  }

  container.innerHTML = normalized
    .map(variantRowMarkup)
    .join("");

  updateVariantRowHeadings();
}

function addVariantRow(variant = {}) {
  const container = $("#product-variants-list");

  if (!container) {
    return;
  }

  container.querySelector(".variants-empty-hint")?.remove();

  container.insertAdjacentHTML(
    "beforeend",
    variantRowMarkup(variant)
  );

  updateVariantRowHeadings();

  const rows = container.querySelectorAll("[data-variant-row]");

  rows.item(rows.length - 1)
    ?.querySelector("[data-variant-storage]")
    ?.focus();
}

function updateVariantRowHeadings() {
  const rows = Array.from(
    document.querySelectorAll("[data-variant-row]")
  );

  rows.forEach((row, index) => {
    const storage = row
      .querySelector("[data-variant-storage]")
      ?.value.trim();

    const ram = row
      .querySelector("[data-variant-ram]")
      ?.value.trim();

    const color = row
      .querySelector("[data-variant-color]")
      ?.value.trim();

    const heading = row.querySelector("[data-variant-row-heading]");

    if (heading) {
      heading.textContent =
        [storage, ram, color].filter(Boolean).join(" · ") ||
        `Variante ${index + 1}`;
    }
  });
}

const variantsContainer = $("#product-variants-list");

$("#add-variant-button")?.addEventListener("click", () => {
  addVariantRow();
});

variantsContainer?.addEventListener("click", event => {
  const remove = event.target.closest("[data-remove-variant]");

  if (!remove) {
    return;
  }

  remove.closest("[data-variant-row]")?.remove();

  if (!variantsContainer.querySelector("[data-variant-row]")) {
    renderVariantRows([]);
  } else {
    updateVariantRowHeadings();
  }
});

variantsContainer?.addEventListener("change", event => {
  const select = event.target.closest("[data-variant-palette]");

  if (!select) {
    return;
  }

  const row = select.closest("[data-variant-row]");

  if (!row || !select.value || select.value === "custom") {
    return;
  }

  const color = COLOR_PALETTE.find(
    item => item.hex === select.value
  );

  if (!color) {
    return;
  }

  row.querySelector("[data-variant-color]").value = color.name;
  row.querySelector("[data-variant-hex]").value = color.hex;

  updateVariantRowHeadings();
});

variantsContainer?.addEventListener("input", event => {
  if (!event.target.matches(
    "[data-variant-color], [data-variant-storage], [data-variant-ram]"
  )) {
    return;
  }

  const row = event.target.closest("[data-variant-row]");

  if (!row) {
    return;
  }

  if (event.target.matches("[data-variant-color]")) {
    const colorName = event.target.value.trim();

    const matchingColor = COLOR_PALETTE.find(item =>
      item.name.toLocaleLowerCase("es") ===
      colorName.toLocaleLowerCase("es")
    );

    if (matchingColor) {
      row.querySelector("[data-variant-hex]").value =
        matchingColor.hex;

      row.querySelector("[data-variant-palette]").value =
        matchingColor.hex;
    } else {
      row.querySelector("[data-variant-palette]").value = "custom";
    }
  }

  updateVariantRowHeadings();
});

/* =========================================================
   AUTORIZACIÓN DE ADMINISTRADORES
   ========================================================= */

async function confirmAdmin(user) {
  if (!supabase || !user?.id) {
    throw new Error("No se pudo verificar la s
