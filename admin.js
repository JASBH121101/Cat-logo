import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const CONFIG = window.CATALOG_CONFIG || {};

const configured = Boolean(
  CONFIG.supabaseUrl &&
  CONFIG.supabaseAnonKey &&
  !String(CONFIG.supabaseUrl).includes("PON_AQUI") &&
  !String(CONFIG.supabaseAnonKey).includes("PON_AQUI")
);

const supabase = configured
  ? createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey)
  : null;

const $ = selector => document.querySelector(selector);

const loginPanel = $("#login-panel");
const dashboard = $("#dashboard");
const form = $("#product-form");

let currentUser = null;
let products = [];

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
  const node = typeof selector === "string" ? $(selector) : selector;
  if (!node) return;

  node.textContent = text;
  node.className = `form-status${type ? ` ${type}` : ""}`;
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

function parseSpecs(text) {
  const obj = {};

  String(text || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .forEach(line => {
      const colon = line.indexOf(":");

      if (colon > 0) {
        obj[line.slice(0, colon).trim()] =
          line.slice(colon + 1).trim();
      } else {
        obj[`Dato ${Object.keys(obj).length + 1}`] = line;
      }
    });

  return obj;
}

function specsText(specs) {
  if (Array.isArray(specs)) {
    return specs.map(item => {
      if (typeof item === "string") return item;

      if (item && typeof item === "object") {
        return `${item.label || item.name || "Dato"}: ${item.value || ""}`;
      }

      return String(item ?? "");
    }).join("\n");
  }

  return specs && typeof specs === "object"
    ? Object.entries(specs)
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n")
    : "";
}

function setStatus(text, type = "") {
  const node = $("#admin-status");
  if (!node) return;

  node.textContent = text;
  node.style.color =
    type === "error" ? "#b42318"
    : type === "success" ? "#087f5b"
    : "";
}

function getImages(product) {
  let images = product?.images;

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

  return [...images, product?.image_url]
    .filter(value => typeof value === "string" && value.trim());
}

/* Normaliza los colores recibidos desde Supabase o JSON. */
function normalizeColors(value) {
  let colors = value;

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

function colorRowMarkup(color = {}) {
  const normalized = {
    name: String(color.name || "").trim(),
    type: color.type === "order" ? "order" : "available",
    image_url: String(color.image_url || color.imageUrl || "").trim()
  };

  return `
    <div class="color-admin-row" data-color-row>
      <label>
        Nombre del color *
        <input
          data-color-name
          maxlength="60"
          required
          value="${escapeHtml(normalized.name)}"
          placeholder="Ej. Verde"
        >
      </label>

      <label>
        Disponibilidad
        <select data-color-type>
          <option
            value="available"
            ${normalized.type === "available" ? "selected" : ""}
          >Disponible</option>
          <option
            value="order"
            ${normalized.type === "order" ? "selected" : ""}
          >Por pedido</option>
        </select>
      </label>

      <label class="color-image-field">
        Foto del color (opcional)
        <input
          data-color-image
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
        >
      </label>

      <label class="color-url-field">
        URL de foto existente (opcional)
        <input
          data-color-image-url
          type="url"
          value="${escapeHtml(normalized.image_url)}"
          placeholder="https://..."
        >
      </label>

      <button
        class="admin-mini-button danger color-remove-button"
        type="button"
        data-remove-color
      >Quitar</button>

      <p class="color-row-status" data-color-status role="status"></p>
    </div>
  `;
}

function renderColorRows(colors = []) {
  const container = $("#product-colors-list");
  if (!container) return;

  const normalized = normalizeColors(colors);

  if (!normalized.length) {
    container.innerHTML =
      '<p class="colors-empty-hint">Todavía no agregaste colores a este producto.</p>';
    return;
  }

  container.innerHTML = normalized.map(colorRowMarkup).join("");
}

function addColorRow(color = {
  name: "",
  type: "available",
  image_url: ""
}) {
  const container = $("#product-colors-list");
  if (!container) return;

  container.querySelector(".colors-empty-hint")?.remove();
  container.insertAdjacentHTML("beforeend", colorRowMarkup(color));

  const rows = container.querySelectorAll("[data-color-row]");
  rows.item(rows.length - 1)
    ?.querySelector("[data-color-name]")
    ?.focus();
}

/* Sube la fotografía de un color al bucket configurado de Supabase Storage. */
async function uploadColorImage(productId, colorName, file) {
  if (!file) return "";

  if (!file.type.startsWith("image/")) {
    throw new Error(`La foto de ${colorName} no parece ser una imagen.`);
  }

  if (file.size > 8 * 1024 * 1024) {
    throw new Error(`La foto del color ${colorName} supera el límite de 8 MB.`);
  }

  const safeName = slugify(file.name.replace(/\.[^.]+$/, ""));
  const ext = (file.name.split(".").pop() || "jpg")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "") || "jpg";

  const path =
    `${productId}/colors/${crypto.randomUUID()}-${slugify(colorName)}-${safeName}.${ext}`;

  const { error } = await supabase
    .storage
    .from(CONFIG.storageBucket || "product-images")
    .upload(path, file, {
      contentType: file.type,
      upsert: false
    });

  if (error) {
    throw new Error(
      `No se pudo subir la foto del color ${colorName}: ${error.message}`
    );
  }

  const { data } = supabase
    .storage
    .from(CONFIG.storageBucket || "product-images")
    .getPublicUrl(path);

  return data.publicUrl;
}

async function collectColors(productId) {
  const rows = Array.from(
    $("#product-colors-list")?.querySelectorAll("[data-color-row]") || []
  );

  const colors = [];
  const usedNames = new Set();

  for (const row of rows) {
    const name = row.querySelector("[data-color-name]").value.trim();
    const type = row.querySelector("[data-color-type]").value === "order"
      ? "order"
      : "available";

    const file = row.querySelector("[data-color-image]").files?.[0] || null;
    let imageUrl = row.querySelector("[data-color-image-url]").value.trim();

    if (!name) {
      throw new Error(
        "Completá el nombre de cada color o quitá la fila vacía."
      );
    }

    const normalizedName = name.toLocaleLowerCase("es");

    if (usedNames.has(normalizedName)) {
      throw new Error(
        `El color «${name}» está repetido. Usá nombres diferentes.`
      );
    }

    usedNames.add(normalizedName);

    const statusNode = row.querySelector("[data-color-status]");

    if (file) {
      if (statusNode) {
        statusNode.textContent = `Subiendo foto de ${name}…`;
      }

      imageUrl = await uploadColorImage(productId, name, file);
    }

    colors.push({
      name,
      type,
      image_url: imageUrl
    });
  }

  return colors;
}

$("#add-color-button")?.addEventListener("click", () => addColorRow());

$("#product-colors-list")?.addEventListener("click", event => {
  const removeButton = event.target.closest("[data-remove-color]");
  if (!removeButton) return;

  removeButton.closest("[data-color-row]")?.remove();

  if (!$("#product-colors-list").querySelector("[data-color-row]")) {
    renderColorRows([]);
  }
});

async function confirmAdmin(user) {
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
      "Tu usuario puede iniciar sesión, pero todavía no está autorizado como administrador. Debés agregar su UUID a public.admin_users desde Supabase."
    );
  }

  return true;
}

async function showDashboard(user) {
  await confirmAdmin(user);

  currentUser = user;
  loginPanel.classList.add("hidden");
  dashboard.classList.remove("hidden");

  setStatus(`Sesión iniciada como ${user.email || "administrador"}`);

  await loadProducts();
}

async function handleSession() {
  if (!configured) {
    message(
      "#login-status",
      "Falta configurar la URL y la publishable/anon key de Supabase en config.js.",
      "error"
    );
    return;
  }

  const {
    data: { session },
    error
  } = await supabase.auth.getSession();

  if (error) throw error;
  if (!session) return;

  try {
    await showDashboard(session.user);
  } catch (error) {
    message(
      "#login-status",
      error.message || "La sesión no está autorizada para administrar este catálogo.",
      "error"
    );

    await supabase.auth.signOut();
  }
}

$("#login-form").addEventListener("submit", async event => {
  event.preventDefault();

  if (!supabase) {
    message(
      "#login-status",
      "Configurá primero Supabase en config.js.",
      "error"
    );
    return;
  }

  const button = event.currentTarget.querySelector('button[type="submit"]');

  button.disabled = true;
  button.textContent = "Verificando…";

  message("#login-status", "Comprobando acceso…");

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: $("#login-email").value.trim(),
      password: $("#login-password").value
    });

    if (error) throw error;

    await showDashboard(data.user);

    message("#login-status", "Acceso autorizado.", "success");
  } catch (error) {
    await supabase.auth.signOut();

    message(
      "#login-status",
      error.message || "No se pudo iniciar sesión.",
      "error"
    );
  } finally {
    button.disabled = false;
    button.textContent = "Iniciar sesión";
  }
});

$("#logout-button").addEventListener("click", async () => {
  if (supabase) {
    await supabase.auth.signOut();
  }

  currentUser = null;
  dashboard.classList.add("hidden");
  loginPanel.classList.remove("hidden");
  form.reset();
  clearEditor();
});

async function loadProducts() {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    setStatus(`No se pudo cargar el inventario: ${error.message}`, "error");
    return;
  }

  products = data || [];

  renderAdminList();

  $("#product-count").textContent =
    `${products.length} productos en la base de datos`;
}

function renderAdminList() {
  const query = $("#admin-search").value
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
      ? `<img class="admin-product-thumb" src="${escapeHtml(image)}" alt="" loading="lazy">`
      : `<div class="admin-product-thumb" style="display:grid;place-items:center;color:#9aa6b9">▧</div>`;

    const state = product.is_published
      ? '<span class="status-pill published">Publicado</span>'
      : '<span class="status-pill">Borrador</span>';

    const price = product.price_usd === null ||
      product.price_usd === undefined ||
      product.price_usd === ""
      ? "Consultar"
      : `US$${Number(product.price_usd).toLocaleString("en-US", {
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
            · ${escapeHtml(price)}
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

$("#admin-search").addEventListener("input", renderAdminList);

$("#admin-product-list").addEventListener("click", async event => {
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

  if (toggle) {
    const product = products.find(
      item => String(item.id) === toggle.dataset.toggle
    );

    if (!product) return;

    try {
      const { error } = await supabase
        .from("products")
        .update({
          is_published: !product.is_published,
          updated_at: new Date().toISOString()
        })
        .eq("id", product.id);

      if (error) throw error;

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
  }
});

function clearEditor() {
  form.reset();

  $("#product-id").value = "";
  $("#catalog-key").value = "";
  $("#product-active").checked = false;
  $("#product-featured").checked = false;

  $("#product-financing").value =
    "Financiamiento mediante crédito o tarjeta. Consultá requisitos y condiciones de aprobación.";

  $("#existing-image-urls").value = "";
  renderColorRows([]);
  $("#product-images").value = "";
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
    product.availability || "Consultar disponibilidad";

  $("#product-price-usd").value = product.price_usd ?? "";
  $("#product-price-nio").value = product.price_nio ?? "";
  $("#product-warranty").value = product.warranty_months ?? "";
  $("#product-description").value = product.description || "";
  $("#product-specs").value = specsText(product.specifications);

  $("#product-financing").value =
    product.financing_note ||
    "Financiamiento mediante crédito o tarjeta. Consultá requisitos y condiciones de aprobación.";

  $("#product-shipping").value = product.shipping_note || "";
  $("#existing-image-urls").value = getImages(product).join("\n");
  renderColorRows(product.colors);
  $("#product-images").value = "";
  $("#product-featured").checked = Boolean(product.featured);
  $("#product-active").checked = Boolean(product.is_published);

  $("#form-title").textContent = "Editar producto";
  $("#save-product-button").textContent = "Guardar cambios";

  message("#product-form-status", "Editando: " + product.name);

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

$("#new-product-button").addEventListener("click", clearEditor);
$("#cancel-edit-button").addEventListener("click", clearEditor);

async function uploadImages(productId, files) {
  const urls = [];

  for (const file of files) {
    if (!file.type.startsWith("image/")) {
      throw new Error(`El archivo ${file.name} no parece una imagen.`);
    }

    if (file.size > 8 * 1024 * 1024) {
      throw new Error(`${file.name} supera el límite recomendado de 8 MB.`);
    }

    const safeName = slugify(file.name.replace(/\.[^.]+$/, ""));

    const ext = (file.name.split(".").pop() || "jpg")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "") || "jpg";

    const path = `${productId}/${crypto.randomUUID()}-${safeName}.${ext}`;

    const { error } = await supabase
      .storage
      .from(CONFIG.storageBucket || "product-images")
      .upload(path, file, {
        contentType: file.type,
        upsert: false
      });

    if (error) {
      throw new Error(`No se pudo subir ${file.name}: ${error.message}`);
    }

    const { data } = supabase
      .storage
      .from(CONFIG.storageBucket || "product-images")
      .getPublicUrl(path);

    urls.push(data.publicUrl);
  }

  return urls;
}

form.addEventListener("submit", async event => {
  event.preventDefault();

  if (!currentUser || !supabase) return;

  const button = $("#save-product-button");
  const wasEditing = Boolean($("#product-id").value);

  button.disabled = true;
  button.textContent = "Guardando…";

  try {
    const name = $("#product-name").value.trim();

    if (!name) {
      throw new Error("Escribí el nombre del producto.");
    }

    const id = $("#product-id").value || crypto.randomUUID();

    const catalogKey = $("#catalog-key").value.trim() ||
      `${slugify(name)}-${id.slice(0, 8)}`;

    const enteredUrls = $("#existing-image-urls").value
      .split(/\r?\n/)
      .map(value => value.trim())
      .filter(Boolean);

    const newImages = Array.from($("#product-images").files || []);
    const uploadedUrls = await uploadImages(id, newImages);
    const colors = await collectColors(id);

    const priceUSDInput = $("#product-price-usd").value;
    const priceNIOInput = $("#product-price-nio").value;
    const warrantyInput = $("#product-warranty").value;

    const payload = {
      catalog_key: catalogKey,
      name,
      brand: $("#product-brand").value.trim() || null,
      model: $("#product-model").value.trim() || null,
      category: $("#product-category").value,
      availability: $("#product-availability").value,
      price_usd: priceUSDInput === "" ? null : Number(priceUSDInput),
      price_nio: priceNIOInput === "" ? null : Number(priceNIOInput),
      warranty_months: warrantyInput === "" ? null : Number(warrantyInput),
      description: $("#product-description").value.trim() || null,
      specifications: parseSpecs($("#product-specs").value),
      images: [...new Set([...enteredUrls, ...uploadedUrls])],
      colors,
      financing_note: $("#product-financing").value.trim() ||
        "Financiamiento mediante crédito o tarjeta. Consultá requisitos y condiciones de aprobación.",
      shipping_note: $("#product-shipping").value.trim() || null,
      featured: $("#product-featured").checked,
      is_published: $("#product-active").checked,
      updated_at: new Date().toISOString(),
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
          id
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
      error.message || "Ocurrió un error al guardar el producto.",
      "error"
    );
  } finally {
    button.disabled = false;
    button.textContent = $("#product-id").value
      ? "Guardar cambios"
      : "Guardar producto";
  }
});

$("#import-json-file").addEventListener("change", async event => {
  const file = event.target.files?.[0];

  if (!file || !supabase || !currentUser) return;

  const node = $("#import-status");
  message(node, "Leyendo el archivo…");

  try {
    const raw = JSON.parse(await file.text());
    const rows = Array.isArray(raw) ? raw : raw.products;

    if (!Array.isArray(rows) || !rows.length) {
      throw new Error("El JSON debe contener una lista de productos.");
    }

    const payload = rows.map((product, index) => {
      if (!product.name || !product.category) {
        throw new Error(
          `El producto ${index + 1} necesita nombre y categoría.`
        );
      }

      const priceUSD =
        product.price_usd === undefined ||
        product.price_usd === null ||
        product.price_usd === ""
          ? null
          : Number(product.price_usd);

      const priceNIO =
        product.price_nio === undefined ||
        product.price_nio === null ||
        product.price_nio === ""
          ? null
          : Number(product.price_nio);

      const warranty =
        product.warranty_months === undefined ||
        product.warranty_months === null ||
        product.warranty_months === ""
          ? null
          : Number(product.warranty_months);

      return {
        catalog_key: product.catalog_key ||
          `${slugify(product.name)}-${crypto.randomUUID().slice(0, 8)}`,
        name: String(product.name),
        brand: product.brand || null,
        model: product.model || null,
        category: product.category,
        price_usd: priceUSD,
        price_nio: priceNIO,
        description: product.description || null,

        specifications:
          product.specifications && typeof product.specifications === "object"
            ? product.specifications
            : product.specs && typeof product.specs === "object"
              ? product.specs
              : {},

        warranty_months: warranty,
        availability: product.availability || "Consultar disponibilidad",
        financing_note: product.financing_note ||
          "Financiamiento mediante crédito o tarjeta. Consultá requisitos y condiciones de aprobación.",
        shipping_note: product.shipping_note || null,
        images: Array.isArray(product.images) ? product.images : [],
        colors: Array.isArray(product.colors)
          ? normalizeColors(product.colors)
          : [],
        featured: false,
        is_published: false,
        updated_at: new Date().toISOString(),
        updated_by: currentUser.id
      };
    });

    const { error } = await supabase
      .from("products")
      .insert(payload);

    if (error) throw error;

    message(
      node,
      `${payload.length} productos importados como borradores. Revisá modelos, precios y fotos antes de publicar.`,
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

handleSession().catch(error => {
  message(
    "#login-status",
    error.message || "No se pudo comprobar la sesión.",
    "error"
  );
});