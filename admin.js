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

/*
  sessionStorage conserva la sesión durante la vida de la pestaña.
  Al cerrar la pestaña, el almacenamiento de esa sesión desaparece.
*/
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

  const metadata = user.user_metadata || {};

  const profileName =
    metadata.full_name ||
    metadata.name ||
    metadata.display_name ||
    [metadata.first_name, metadata.last_name]
      .filter(Boolean)
      .join(" ");

  const emailName = user.email
    ? user.email
        .split("@")[0]
        .replace(/[._+-]+/g, " ")
        .replace(/\d+/g, " ")
        .trim()
    : "";

  const displayName = String(profileName || emailName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(part =>
      part.charAt(0).toLocaleUpperCase("es") + part.slice(1)
    )
    .join(" ");

  const greeting = $("#admin-greeting");

  if (greeting) {
    greeting.textContent = displayName
      ? `¡Bienvenido de nuevo, ${displayName}! 👋`
      : "¡Bienvenido de nuevo! 👋";
  }

  setStatus(
    `Sesión iniciada como ${user.email || "administrador"}`
  );

  await loadProducts();
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

async function loadProducts() {
  if (!supabase || !currentUser) {
    return;
  }

  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    setStatus(
      `No se pudo cargar el inventario: ${error.message}`,
      "error"
    );

    return;
  }

  products = data || [];

  renderAdminList();

  $("#product-count").textContent =
    `${products.length} producto${products.length === 1 ? "" : "s"} en la base de datos`;
}

function renderAdminList() {
  const query = ($("#admin-search")?.value || "")
    .trim()
    .toLocaleLowerCase("es");

  const matches = products.filter(product =>
    [
      product.name,
      product.brand,
      product.model,
      product.category
    ]
      .join(" ")
      .toLocaleLowerCase("es")
      .includes(query)
  );

  $("#admin-product-list").innerHTML = matches.map(product => {
    const image = getImages(product)[0];

    const thumb = image
      ? `<img class="admin-product-thumb"
              src="${escapeHtml(image)}"
              alt=""
              loading="lazy">`
      : `<div class="admin-product-thumb"
              style="display:grid;place-items:center;color:#9aa6b9">▧</div>`;

    const state = product.is_published
      ? '<span class="status-pill published">Publicado</span>'
      : '<span class="status-pill">Borrador</span>';

    const variants = normalizeVariants(product.variants);

    const variantCount = variants.length;

    const variantLabel = variantCount
      ? ` · ${variantCount} variante${variantCount === 1 ? "" : "s"}`
      : "";

    const price = minimumPrice(variants, "price_usd")
      ?? product.price_usd;

    const formattedPrice =
      price === null || price === undefined || price === ""
        ? "Consultar"
        : `US$${Number(price).toLocaleString("en-US", {
            maximumFractionDigits: 2
          })}`;

    return `
      <article class="admin-product-row">
        ${thumb}

        <div>
          <p class="admin-product-name">
            ${escapeHtml(product.name)}
          </p>

          <div class="admin-product-meta">
            ${escapeHtml(product.category || "Sin categoría")}
            · ${escapeHtml(formattedPrice)}
            ${variantLabel}
            · ${state}
          </div>

          <div class="admin-product-buttons">
            <button
              class="admin-mini-button"
              type="button"
              data-edit="${escapeHtml(product.id)}"
            >Editar</button>

            <button
              class="admin-mini-button"
              type="button"
              data-toggle="${escapeHtml(product.id)}"
            >${product.is_published ? "Despublicar" : "Publicar"}</button>
          </div>
        </div>
      </article>
    `;
  }).join("") ||
    '<p class="form-status">No hay productos que coincidan con la búsqueda.</p>';
}

$("#admin-search")?.addEventListener("input", renderAdminList);

$("#admin-product-list")?.addEventListener("click", async event => {
  const edit = event.target.closest("[data-edit]");
  const toggle = event.target.closest("[data-toggle]");

  if (edit) {
    const product = products.find(
      item => String(item.id) === edit.dataset.edit
    );

    if (product) {
      fillEditor(product);
    }
  }

  if (!toggle) {
    return;
  }

  const product = products.find(
    item => String(item.id) === toggle.dataset.toggle
  );

  if (!product || !currentUser) {
    return;
  }

  try {
    const { error } = await supabase
      .from("products")
      .update({
        is_published: !product.is_published,
        updated_at: new Date().toISOString(),
        updated_by: currentUser.id
      })
      .eq("id", product.id);

    if (error) {
      throw error;
    }

    setStatus(
      product.is_published
        ? "Producto despublicado."
        : "Producto publicado.",
      "success"
    );

    await loadProducts();
  } catch (error) {
    setStatus(
      `No se pudo cambiar la publicación: ${error.message}`,
      "error"
    );
  }
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
  $("#product-active").checked = false;
  $("#product-featured").checked = false;

  $("#product-financing").value =
    "Financiamiento mediante crédito o tarjeta. Consultá requisitos y condiciones de aprobación.";

  $("#existing-image-urls").value = "";
  $("#product-images").value = "";

  renderVariantRows([]);

  $("#form-title").textContent = "Agregar producto";
  $("#save-product-button").textContent = "Guardar producto";

  message("#product-form-status", "");
}

function fillEditor(product) {
  $("#product-id").value = product.id || "";
  $("#catalog-key").value = product.catalog_key || "";

  $("#product-name").value = product.name || "";
  $("#product-brand").value = product.brand || "";
  $("#product-model").value = product.model || "";

  $("#product-category").value = product.category || "Otros";

  $("#product-availability").value =
    normalizeProductAvailability(product.availability);

  $("#product-price-usd").value = product.price_usd ?? "";
  $("#product-price-nio").value = product.price_nio ?? "";
  $("#product-warranty").value = product.warranty_months ?? "";

  $("#product-description").value = product.description || "";

  $("#product-specs").value =
    specsText(product.specifications);

  $("#product-financing").value =
    product.financing_note ||
    "Financiamiento mediante crédito o tarjeta. Consultá requisitos y condiciones de aprobación.";

  $("#product-shipping").value =
    product.shipping_note || "";

  $("#existing-image-urls").value =
    getImages(product).join("\n");

  $("#product-images").value = "";

  renderVariantRows(legacyVariants(product));

  $("#product-featured").checked = Boolean(product.featured);
  $("#product-active").checked = Boolean(product.is_published);

  $("#form-title").textContent = "Editar producto";
  $("#save-product-button").textContent = "Guardar cambios";

  message(
    "#product-form-status",
    `Editando: ${product.name}`
  );

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

$("#new-product-button")?.addEventListener("click", clearEditor);
$("#cancel-edit-button")?.addEventListener("click", clearEditor);

/* =========================================================
   ALMACENAMIENTO DE IMÁGENES
   ========================================================= */

async function uploadImage(productId, file, subfolder = "") {
  if (!file) {
    return "";
  }

  if (!file.type.startsWith("image/")) {
    throw new Error(
      `El archivo ${file.name} no parece una imagen.`
    );
  }

  if (file.size > 8 * 1024 * 1024) {
    throw new Error(
      `${file.name} supera el límite recomendado de 8 MB.`
    );
  }

  const safeName = slugify(
    file.name.replace(/\.[^.]+$/, "")
  );

  const ext = (file.name.split(".").pop() || "jpg")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "") || "jpg";

  const path =
    `${productId}/${subfolder ? `${subfolder}/` : ""}${crypto.randomUUID()}-${safeName}.${ext}`;

  const bucket = CONFIG.storageBucket || "product-images";

  const { error } = await supabase
    .storage
    .from(bucket)
    .upload(path, file, {
      contentType: file.type,
      upsert: false
    });

  if (error) {
    throw new Error(
      `No se pudo subir ${file.name}: ${error.message}`
    );
  }

  const { data } = supabase
    .storage
    .from(bucket)
    .getPublicUrl(path);

  return data.publicUrl;
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

async function collectVariants(productId, existingVariants = []) {
  const rows = Array.from(
    $("#product-variants-list")
      ?.querySelectorAll("[data-variant-row]") || []
  );

  const drafts = rows.map((row, index) => {
    const storage = row
      .querySelector("[data-variant-storage]")
      .value.trim();

    const ram = row
      .querySelector("[data-variant-ram]")
      .value.trim();

    const color = row
      .querySelector("[data-variant-color]")
      .value.trim();

    const colorHex = validHex(
      row.querySelector("[data-variant-hex]").value
    );

    const priceUSD = toOptionalNumber(
      row.querySelector("[data-variant-price-usd]").value,
      `Precio en dólares de la variante ${index + 1}`
    );

    const priceNIO = toOptionalNumber(
      row.querySelector("[data-variant-price-nio]").value,
      `Precio en córdobas de la variante ${index + 1}`
    );

    const availability =
      normalizeVariantAvailability(
        row.querySelector("[data-variant-availability]").value
      );

    const imageUrl = row
      .querySelector("[data-variant-image-url]")
      .value.trim();

    const file =
      row.querySelector("[data-variant-image]").files?.[0] || null;

    if (!color) {
      throw new Error(
        `Completá el nombre del color en la variante ${index + 1}.`
      );
    }

    return {
      storage,
      ram,
      color,
      color_hex: colorHex,
      price_usd: priceUSD,
      price_nio: priceNIO,
      availability,
      image_url: imageUrl,
      file,
      row
    };
  });

  /*
    Evita repetir una misma combinación de capacidad + RAM + color.
    El mismo color puede aparecer con capacidades distintas.
  */
  const seen = new Set();

  for (const variant of drafts) {
    const key = [
      variant.storage.toLocaleLowerCase("es"),
      variant.ram.toLocaleLowerCase("es"),
      variant.color.toLocaleLowerCase("es")
    ].join("|");

    if (seen.has(key)) {
      throw new Error(
        `La combinación ${[
          variant.storage,
          variant.ram,
          variant.color
        ].filter(Boolean).join(" · ")} está repetida.`
      );
    }

    seen.add(key);
  }

  /*
    Reutiliza fotografías ya guardadas para el mismo color.
  */
  const imageByColor = new Map();

  normalizeVariants(existingVariants).forEach(variant => {
    const key = variant.color.toLocaleLowerCase("es");

    if (key && variant.image_url && !imageByColor.has(key)) {
      imageByColor.set(key, variant.image_url);
    }
  });

  for (const variant of drafts) {
    const key = variant.color.toLocaleLowerCase("es");

    const statusNode =
      variant.row.querySelector("[data-variant-status]");

    if (variant.file) {
      if (statusNode) {
        statusNode.textContent =
          `Subiendo foto de ${variant.color}…`;
      }

      variant.image_url = await uploadImage(
        productId,
        variant.file,
        "variants"
      );

      imageByColor.set(key, variant.image_url);
    } else if (variant.image_url) {
      imageByColor.set(key, variant.image_url);
    } else if (imageByColor.has(key)) {
      variant.image_url = imageByColor.get(key);
    }
  }

  /*
    Segunda pasada para reutilizar también imágenes subidas durante
    esta misma operación.
  */
  for (const variant of drafts) {
    const key = variant.color.toLocaleLowerCase("es");

    if (!variant.image_url && imageByColor.has(key)) {
      variant.image_url = imageByColor.get(key);
    }
  }

  return drafts.map(({ file, row, ...variant }) => variant);
}

function deriveColorsFromVariants(variants, fallbackColors = []) {
  if (!variants.length) {
    return normalizeColors(fallbackColors);
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
        image_url: variant.image_url || "",
        color_hex: validHex(variant.color_hex)
      });
    } else {
      if (variant.availability === "available") {
        previous.type = "available";
      }

      if (!previous.image_url && variant.image_url) {
        previous.image_url = variant.image_url;
      }
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
    message(
      "#product-form-status",
      "Tu sesión administrativa no está activa. Volvé a iniciar sesión.",
      "error"
    );

    return;
  }

  const button = $("#save-product-button");
  const wasEditing = Boolean($("#product-id").value);

  button.disabled = true;
  button.textContent = "Guardando…";

  try {
    const name = $("#product-name").value.trim();

    if (!name) {
      throw new Error("Escribí el nombre del producto.");
    }

    const id =
      $("#product-id").value || crypto.randomUUID();

    const existingProduct = products.find(
      product => String(product.id) === String(id)
    );

    const catalogKey = $("#catalog-key").value.trim() ||
      `${slugify(name)}-${id.slice(0, 8)}`;

    const variants = await collectVariants(
      id,
      existingProduct?.variants || []
    );

    const enteredUrls = $("#existing-image-urls").value
      .split(/\r?\n/)
      .map(value => value.trim())
      .filter(Boolean);

    const newImages = Array.from(
      $("#product-images").files || []
    );

    const uploadedMainImages = await uploadMainImages(
      id,
      newImages
    );

    const colors = deriveColorsFromVariants(
      variants,
      existingProduct?.colors || []
    );

    const baseUSD = toOptionalNumber(
      $("#product-price-usd").value,
      "Precio base en dólares"
    );

    const baseNIO = toOptionalNumber(
      $("#product-price-nio").value,
      "Precio base en córdobas"
    );

    const warranty = toOptionalNumber(
      $("#product-warranty").value,
      "Garantía"
    );

    const priceUSD = variants.length
      ? minimumPrice(variants, "price_usd") ?? baseUSD
      : baseUSD;

    const priceNIO = variants.length
      ? minimumPrice(variants, "price_nio") ?? baseNIO
      : baseNIO;

    const allImages = [
      ...new Set([
        ...enteredUrls,
        ...uploadedMainImages
      ])
    ];

    const now = new Date().toISOString();

    const payload = {
      catalog_key: catalogKey,

      sort_order: wasEditing
        ? Number(existingProduct?.sort_order ?? products.length)
        : products.length,

      name,

      brand: $("#product-brand").value.trim() || null,
      model: $("#product-model").value.trim() || null,
      category: $("#product-category").value,

      availability: normalizeProductAvailability(
        $("#product-availability").value
      ),

      price_usd: priceUSD,
      price_nio: priceNIO,
      warranty_months: warranty,

      description:
        $("#product-description").value.trim() || null,

      specifications: parseSpecs(
        $("#product-specs").value
      ),

      images: allImages,
      image_url: allImages[0] || null,

      colors,
      variants,

      financing_note:
        $("#product-financing").value.trim() ||
        "Financiamiento mediante crédito o tarjeta. Consultá requisitos y condiciones de aprobación.",

      shipping_note:
        $("#product-shipping").value.trim() || null,

      featured: $("#product-featured").checked,
      is_published: $("#product-active").checked,

      updated_at: now,
      updated_by: currentUser.id
    };

    let result;

    if (wasEditing) {
      result = await supabase
        .from("products")
        .update(payload)
        .eq("id", id);
    } else {
      result = await supabase
        .from("products")
        .insert({
          ...payload,
          id,
          created_at: now
        });
    }

    if (result.error) {
      throw result.error;
    }

    message(
      "#product-form-status",
      "Producto guardado correctamente.",
      "success"
    );

    setStatus(`Guardado: ${name}`, "success");

    clearEditor();

    await loadProducts();
  } catch (error) {
    message(
      "#product-form-status",
      error.message ||
        "Ocurrió un error al guardar el producto.",
      "error"
    );
  } finally {
    button.disabled = false;

    button.textContent = $("#product-id").value
      ? "Guardar cambios"
      : "Guardar producto";
  }
});

/* =========================================================
   IMPORTAR JSON
   ========================================================= */

$("#import-json-file")?.addEventListener("change", async event => {
  const file = event.target.files?.[0];

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
