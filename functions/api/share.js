const DEFAULT_SUPABASE_URL = "https://uwqnoadelnnplcvqqlyz.supabase.co";
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_ml5eoKXvotG4ZfoG6P19FA_57YQ8t2p";

function htmlEscape(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function cleanText(value, limit = 240) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, limit);
}
function parseArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}
function valuesFromImageField(value) {
  const urls = [];
  const visit = item => {
    if (typeof item === "string") {
      const candidate = item.trim();
      if (/^https?:\/\//i.test(candidate)) urls.push(candidate);
    } else if (Array.isArray(item)) {
      item.forEach(visit);
    } else if (item && typeof item === "object") {
      ["images", "gallery", "image_url", "imageUrl", "image", "url", "src"]
        .forEach(key => { if (Object.prototype.hasOwnProperty.call(item, key)) visit(item[key]); });
    }
  };
  visit(value);
  return [...new Set(urls)];
}
function normalizeValue(value) {
  return String(value == null ? "" : value).normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
}
function normalizeCatalogType(value) {
  const normalized = normalizeValue(value);
  return ["perfumery", "perfumeria", "perfume", "fragancia", "fragancias"].includes(normalized)
    ? "perfumery" : "technology";
}
function perfumeFamilyLabel(value) {
  const normalized = normalizeValue(value).replace(/[\s_-]+/g, " ");
  const labels = {
    arabe: "Árabe",
    arabes: "Árabe",
    "perfumeria arabe": "Árabe",
    nicho: "Nicho",
    "perfumeria de nicho": "Nicho",
    disenador: "Diseñador",
    disenadora: "Diseñador",
    "perfumeria de disenador": "Diseñador",
    designer: "Diseñador"
  };
  return labels[normalized] || cleanText(value, 60);
}
function money(value, currency) {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  const formatted = number.toLocaleString(currency === "USD" ? "en-US" : "es-NI", { maximumFractionDigits: 2 });
  return (currency === "USD" ? "US$" : "NIO ") + formatted;
}
async function getRows(supabaseUrl, publishableKey, table, filters) {
  const url = new URL(supabaseUrl + "/rest/v1/" + table);
  url.searchParams.set("select", "*");
  for (const [key, value] of Object.entries(filters)) url.searchParams.set(key, value);
  url.searchParams.set("limit", "1");
  const response = await fetch(url.href, {
    method: "GET",
    headers: { apikey: publishableKey, Authorization: "Bearer " + publishableKey, Accept: "application/json" }
  });
  if (!response.ok) {
    const error = new Error("Supabase public catalog query failed.");
    error.status = response.status;
    throw error;
  }
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}
function buildDestination(origin, catalog, productId, variant) {
  const target = new URL(catalog === "perfumery" ? "/perfumeria/" : "/tecnologia/", origin);
  target.searchParams.set(catalog === "perfumery" ? "fragancia" : "producto", productId);
  if (catalog === "technology") {
    if (variant.storage) target.searchParams.set("storage", variant.storage);
    if (variant.ram) target.searchParams.set("ram", variant.ram);
    if (variant.color) target.searchParams.set("color", variant.color);
  }
  return target.href;
}
function makeResponse(status, body, headers = {}, method = "GET") {
  return new Response(method === "HEAD" ? null : body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Cache-Control": "no-store",
      ...headers
    }
  });
}

export async function onRequest({ request, env = {} }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return makeResponse(405, "Method not allowed", { Allow: "GET, HEAD" }, request.method);
  }

  let requestUrl;
  try { requestUrl = new URL(request.url); }
  catch { return makeResponse(400, "Invalid share URL", {}, request.method); }

  const catalog = normalizeCatalogType(requestUrl.searchParams.get("catalog"));
  const productId = String(requestUrl.searchParams.get("id") || "").trim();
  if (!productId || productId.length > 128 || !/^[a-z0-9_-]+$/i.test(productId)) {
    return makeResponse(400, "Missing or invalid product ID", {}, request.method);
  }

  const supabaseUrl = String(env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, "");
  const publishableKey = String(env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY);

  try {
    const products = await getRows(supabaseUrl, publishableKey, "products", {
      id: "eq." + productId, is_published: "eq.true"
    });
    const product = products[0];
    if (!product || normalizeCatalogType(product.catalog_type) !== catalog) {
      return makeResponse(404, "Published product not found", {}, request.method);
    }

    let perfumeDetail = {};
    if (catalog === "perfumery") {
      try {
        const details = await getRows(supabaseUrl, publishableKey, "perfume_details", { product_id: "eq." + productId });
        perfumeDetail = details[0] || {};
      } catch { perfumeDetail = {}; }
    }

    const variant = {
      storage: cleanText(requestUrl.searchParams.get("storage"), 80),
      ram: cleanText(requestUrl.searchParams.get("ram"), 80),
      color: cleanText(requestUrl.searchParams.get("color"), 100)
    };
    const variants = parseArray(product.variants);
    const hasVariant = Boolean(variant.storage || variant.ram || variant.color);
    const selectedVariant = catalog === "technology" && hasVariant
      ? variants.find(item =>
          (!variant.storage || normalizeValue(item.storage || item.capacity) === normalizeValue(variant.storage)) &&
          (!variant.ram || normalizeValue(item.ram) === normalizeValue(variant.ram)) &&
          (!variant.color || normalizeValue(item.color || item.name) === normalizeValue(variant.color))
        ) || null
      : null;
    const colors = parseArray(product.colors);
    const selectedColor = variant.color
      ? colors.find(item => normalizeValue(item.name || item.color) === normalizeValue(variant.color))
      : null;
    const variantImages = selectedVariant
      ? valuesFromImageField([selectedVariant.images, selectedVariant.image_url, selectedVariant.imageUrl, selectedVariant.image])
      : [];
    const colorImages = selectedColor
      ? valuesFromImageField([selectedColor.images, selectedColor.image_url, selectedColor.imageUrl, selectedColor.image, selectedColor.gallery])
      : [];
    const productImages = valuesFromImageField([product.images, product.gallery, product.image_url, product.image]);
    const origin = requestUrl.origin;
    const logo = catalog === "perfumery"
      ? new URL("/jb-parfums-logo.svg", origin).href
      : new URL("/jb-tech-horizontal.svg", origin).href;
    const image = [...variantImages, ...colorImages, ...productImages].find(value => /^https?:\/\//i.test(value)) || logo;

    const productName = cleanText(product.name || "Producto", 140);
    const brand = cleanText(product.brand || "", 80);
    const family = perfumeFamilyLabel(perfumeDetail.family || "");
    const concentration = cleanText(perfumeDetail.concentration || "", 40);
    const volume = perfumeDetail.volume_ml ? cleanText(perfumeDetail.volume_ml, 20) + " ml" : "";
    const variantLabel = [variant.storage, variant.ram, variant.color].filter(Boolean).join(" · ");
    const normalizedProductName = normalizeValue(productName);
    const normalizedBrand = normalizeValue(brand);
    const brandAlreadyInName = Boolean(normalizedBrand && (
      normalizedProductName === normalizedBrand ||
      normalizedProductName.startsWith(normalizedBrand + " · ") ||
      normalizedProductName.startsWith(normalizedBrand + " ")
    ));
    const model = cleanText(product.model || "", 80);
    const normalizedModel = normalizeValue(model);
    const modelAlreadyInName = Boolean(normalizedModel && normalizedProductName.includes(normalizedModel));
    const title = catalog === "perfumery"
      ? [brandAlreadyInName ? "" : brand, productName].filter(Boolean).join(" · ")
      : [brandAlreadyInName ? "" : brand, modelAlreadyInName ? "" : model, productName].filter(Boolean).join(" · ");

    const descriptionParts = [];
    if (catalog === "perfumery") {
      if (family) descriptionParts.push("Familia: " + family);
      if (concentration) descriptionParts.push(concentration);
      if (volume) descriptionParts.push(volume);
    } else if (variantLabel) {
      descriptionParts.push("Variante: " + variantLabel);
    }
    const priceUsd = selectedVariant && selectedVariant.price_usd !== undefined && selectedVariant.price_usd !== null
      ? selectedVariant.price_usd : product.price_usd;
    const priceNio = selectedVariant && selectedVariant.price_nio !== undefined && selectedVariant.price_nio !== null
      ? selectedVariant.price_nio : product.price_nio;
    if (money(priceUsd, "USD")) descriptionParts.push("Precio: " + money(priceUsd, "USD"));
    if (money(priceNio, "NIO")) descriptionParts.push(money(priceNio, "NIO"));
    if (product.description) descriptionParts.push(cleanText(product.description, 150));
    const description = cleanText(descriptionParts.join(" · ") || "Consultá disponibilidad y detalles en JB Collections.", 260);
    const destination = buildDestination(origin, catalog, productId, variant);
    const imageAlt = catalog === "perfumery"
      ? "Fotografía de " + productName + (brand ? " de " + brand : "")
      : "Fotografía de " + productName + (variant.color ? " en color " + variant.color : "");

    const html = "<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\">" +
      "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
      "<title>" + htmlEscape(title) + "</title>" +
      "<meta name=\"description\" content=\"" + htmlEscape(description) + "\">" +
      "<meta property=\"og:type\" content=\"product\">" +
      "<meta property=\"og:site_name\" content=\"JB Collections\">" +
      "<meta property=\"og:title\" content=\"" + htmlEscape(title) + "\">" +
      "<meta property=\"og:description\" content=\"" + htmlEscape(description) + "\">" +
      "<meta property=\"og:url\" content=\"" + htmlEscape(requestUrl.href) + "\">" +
      "<meta property=\"og:image\" content=\"" + htmlEscape(image) + "\">" +
      "<meta property=\"og:image:alt\" content=\"" + htmlEscape(imageAlt) + "\">" +
      "<meta name=\"twitter:card\" content=\"summary_large_image\">" +
      "<meta name=\"twitter:title\" content=\"" + htmlEscape(title) + "\">" +
      "<meta name=\"twitter:description\" content=\"" + htmlEscape(description) + "\">" +
      "<meta name=\"twitter:image\" content=\"" + htmlEscape(image) + "\">" +
      "<link rel=\"canonical\" href=\"" + htmlEscape(destination) + "\">" +
      "<style>body{margin:0;padding:24px;font:16px system-ui,sans-serif;color:#24324d;background:#f5f7fb}main{max-width:560px;margin:10vh auto;text-align:center}img{display:block;max-width:180px;max-height:220px;object-fit:contain;margin:0 auto 20px}a{display:inline-block;margin-top:12px;padding:12px 18px;border-radius:8px;background:#283f8e;color:#fff;text-decoration:none}</style>" +
      "</head><body><main><img src=\"" + htmlEscape(image) + "\" alt=\"" + htmlEscape(imageAlt) + "\"><h1>" + htmlEscape(title) + "</h1><p>" + htmlEscape(description) + "</p><a href=\"" + htmlEscape(destination) + "\">Abrir producto</a></main>" +
      "<script>window.setTimeout(function(){window.location.replace(" + JSON.stringify(destination) + ");},180);</script>" +
      "</body></html>";

    return makeResponse(200, request.method === "HEAD" ? null : html, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=900",
      "Vary": "Host"
    }, request.method);
  } catch (error) {
    console.error("Share preview generation failed:", error && error.message ? error.message : "unknown error");
    const status = error && (error.status === 401 || error.status === 403) ? 503 : 502;
    return makeResponse(status, "The product preview is temporarily unavailable.", {}, request.method);
  }
}
