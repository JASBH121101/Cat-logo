const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://uwqnoadelnnplcvqqlyz.supabase.co").replace(/\/+$/, "");
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_ml5eoKXvotG4ZfoG6P19FA_57YQ8t2p";
const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";

function htmlEscape(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cleanText(value, limit = 240) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, limit);
}

function parseArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function valuesFromImageField(value) {
  const urls = [];
  const visit = item => {
    if (typeof item === "string") {
      const value = item.trim();
      if (/^https?:\/\//i.test(value)) urls.push(value);
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (item && typeof item === "object") {
      ["images", "gallery", "image_url", "imageUrl", "image", "url", "src"].forEach(key => {
        if (Object.prototype.hasOwnProperty.call(item, key)) visit(item[key]);
      });
    }
  };
  visit(value);
  return [...new Set(urls)];
}

function normalizeValue(value) {
  return String(value == null ? "" : value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("es");
}

function normalizeCatalogType(value) {
  const valueText = normalizeValue(value);
  return ["perfumery", "perfumeria", "perfume", "fragancia", "fragancias"].includes(valueText)
    ? "perfumery"
    : "technology";
}

function money(value, currency) {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  const formatted = number.toLocaleString(currency === "USD" ? "en-US" : "es-NI", { maximumFractionDigits: 2 });
  return (currency === "USD" ? "US$" : "NIO ") + formatted;
}

async function getRows(table, filters) {
  const url = new URL(SUPABASE_URL + "/rest/v1/" + table);
  url.searchParams.set("select", "*");
  for (const [key, value] of Object.entries(filters)) url.searchParams.set(key, value);
  url.searchParams.set("limit", "1");
  const response = await fetch(url.href, {
    method: "GET",
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: "Bearer " + SUPABASE_PUBLISHABLE_KEY,
      Accept: "application/json"
    }
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

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    res.statusCode = 405;
    return res.end("Method not allowed");
  }

  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim().toLowerCase();
  if (!host || !/^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host) || !["https", "http"].includes(proto)) {
    res.statusCode = 400;
    return res.end("Invalid request host");
  }

  const origin = proto + "://" + host;
  let requestUrl;
  try {
    requestUrl = new URL(req.url || "/api/share", origin);
  } catch {
    res.statusCode = 400;
    return res.end("Invalid share URL");
  }

  const requestedCatalog = normalizeCatalogType(requestUrl.searchParams.get("catalog"));
  const productId = String(requestUrl.searchParams.get("id") || "").trim();
  if (!productId || productId.length > 128 || !/^[a-z0-9_-]+$/i.test(productId)) {
    res.statusCode = 400;
    return res.end("Missing or invalid product ID");
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=900");
  res.setHeader("Vary", "Host");

  try {
    const products = await getRows("products", {
      id: "eq." + productId,
      is_published: "eq.true"
    });
    const product = products[0];
    if (!product || normalizeCatalogType(product.catalog_type) !== requestedCatalog) {
      res.statusCode = 404;
      return res.end("Published product not found");
    }

    let perfumeDetail = {};
    if (requestedCatalog === "perfumery") {
      try {
        const details = await getRows("perfume_details", { product_id: "eq." + productId });
        perfumeDetail = details[0] || {};
      } catch {
        perfumeDetail = {};
      }
    }

    const requestedVariant = {
      storage: cleanText(requestUrl.searchParams.get("storage"), 80),
      ram: cleanText(requestUrl.searchParams.get("ram"), 80),
      color: cleanText(requestUrl.searchParams.get("color"), 100)
    };

    const variants = parseArray(product.variants);
    const hasVariantChoice = Boolean(requestedVariant.storage || requestedVariant.ram || requestedVariant.color);
    const selectedVariant = requestedCatalog === "technology" && hasVariantChoice
      ? variants.find(item =>
          (!requestedVariant.storage || normalizeValue(item.storage || item.capacity) === normalizeValue(requestedVariant.storage)) &&
          (!requestedVariant.ram || normalizeValue(item.ram) === normalizeValue(requestedVariant.ram)) &&
          (!requestedVariant.color || normalizeValue(item.color || item.name) === normalizeValue(requestedVariant.color))
        ) || null
      : null;

    const colorOptions = parseArray(product.colors);
    const selectedColor = requestedVariant.color
      ? colorOptions.find(item => normalizeValue(item.name || item.color) === normalizeValue(requestedVariant.color))
      : null;

    const variantImageCandidates = selectedVariant
      ? valuesFromImageField([selectedVariant.images, selectedVariant.image_url, selectedVariant.imageUrl, selectedVariant.image])
      : [];
    const colorImageCandidates = selectedColor
      ? valuesFromImageField([selectedColor.images, selectedColor.image_url, selectedColor.imageUrl, selectedColor.image, selectedColor.gallery])
      : [];
    const mainImageCandidates = valuesFromImageField([product.images, product.gallery, product.image_url, product.image]);
    const catalogLogo = requestedCatalog === "perfumery"
      ? new URL("/jb-parfums-logo.svg", origin).href
      : new URL("/jb-tech-horizontal.svg", origin).href;
    const image = [...variantImageCandidates, ...colorImageCandidates, ...mainImageCandidates].find(value => /^https?:\/\//i.test(value)) || catalogLogo;

    const productName = cleanText(product.name || "Producto", 140);
    const brand = cleanText(product.brand || "", 80);
    const family = cleanText(perfumeDetail.family || "", 60);
    const concentration = cleanText(perfumeDetail.concentration || "", 40);
    const volume = perfumeDetail.volume_ml ? cleanText(perfumeDetail.volume_ml, 20) + " ml" : "";
    const variantLabel = [requestedVariant.storage, requestedVariant.ram, requestedVariant.color].filter(Boolean).join(" · ");
    const title = requestedCatalog === "perfumery"
      ? [brand, productName].filter(Boolean).join(" · ")
      : [brand, product.model, productName].filter((value, index, all) => value && all.indexOf(value) === index).join(" · ");
    const descriptionParts = [];
    if (requestedCatalog === "perfumery") {
      if (family) descriptionParts.push("Familia: " + family);
      if (concentration) descriptionParts.push(concentration);
      if (volume) descriptionParts.push(volume);
    } else if (variantLabel) {
      descriptionParts.push("Variante: " + variantLabel);
    }
    const priceUsd = selectedVariant && selectedVariant.price_usd !== undefined && selectedVariant.price_usd !== null
      ? selectedVariant.price_usd
      : product.price_usd;
    const priceNio = selectedVariant && selectedVariant.price_nio !== undefined && selectedVariant.price_nio !== null
      ? selectedVariant.price_nio
      : product.price_nio;
    if (money(priceUsd, "USD")) descriptionParts.push("Precio: " + money(priceUsd, "USD"));
    if (money(priceNio, "NIO")) descriptionParts.push(money(priceNio, "NIO"));
    if (product.description) descriptionParts.push(cleanText(product.description, 150));
    const description = cleanText(descriptionParts.join(" · ") || "Consultá disponibilidad y detalles en JB Collections.", 260);
    const shareUrl = requestUrl.href;
    const destination = buildDestination(origin, requestedCatalog, productId, requestedVariant);
    const imageAlt = requestedCatalog === "perfumery"
      ? "Fotografía de " + productName + (brand ? " de " + brand : "")
      : "Fotografía de " + productName + (requestedVariant.color ? " en color " + requestedVariant.color : "");
    const html = "<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\">" +
      "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
      "<title>" + htmlEscape(title) + "</title>" +
      "<meta name=\"description\" content=\"" + htmlEscape(description) + "\">" +
      "<meta property=\"og:type\" content=\"product\">" +
      "<meta property=\"og:site_name\" content=\"JB Collections\">" +
      "<meta property=\"og:title\" content=\"" + htmlEscape(title) + "\">" +
      "<meta property=\"og:description\" content=\"" + htmlEscape(description) + "\">" +
      "<meta property=\"og:url\" content=\"" + htmlEscape(shareUrl) + "\">" +
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
    res.statusCode = 200;
    if (req.method === "HEAD") return res.end();
    return res.end(html);
  } catch (error) {
    console.error("Share preview generation failed:", error && error.message ? error.message : "unknown error");
    res.statusCode = error && error.status === 401 ? 503 : 502;
    return res.end("The product preview is temporarily unavailable.");
  }
};
