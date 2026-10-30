import assert from "node:assert/strict";
import test from "node:test";
import { onRequest } from "../functions/api/share.js";

const PRODUCT_ID = "a39e3b42-2c68-4e60-a0c3-23fd2b0c3dbf";
const ORIGINAL_FETCH = globalThis.fetch;
const makeRequest = (path, method = "GET") => new Request("https://jb-collections.pages.dev" + path, { method });
test.afterEach(() => { globalThis.fetch = ORIGINAL_FETCH; });

test("rejects unsupported methods and invalid IDs", async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error("unexpected fetch"); };
  const methodResponse = await onRequest({ request: makeRequest("/api/share?id=" + PRODUCT_ID, "POST"), env: {} });
  assert.equal(methodResponse.status, 405);
  assert.equal(methodResponse.headers.get("allow"), "GET, HEAD");
  const idResponse = await onRequest({ request: makeRequest("/api/share?catalog=technology&id=%3Cscript%3E"), env: {} });
  assert.equal(idResponse.status, 400);
  assert.equal(called, false);
});

test("renders technology metadata and preserves the selected variant", async () => {
  const product = {
    id: PRODUCT_ID, name: "Phone X", model: "X Pro", brand: "JB Test",
    catalog_type: "technology", is_published: true, description: "A reliable device",
    price_usd: 299, price_nio: 10900,
    variants: [{ storage: "256 GB", ram: "8 GB", color: "Azul", price_usd: 319, price_nio: 11600, images: ["https://images.example/phone-blue.jpg"] }],
    colors: [{ name: "Azul", images: ["https://images.example/phone-blue.jpg"] }]
  };
  globalThis.fetch = async input => {
    const url = new URL(input);
    assert.equal(url.pathname, "/rest/v1/products");
    assert.equal(url.searchParams.get("id"), "eq." + PRODUCT_ID);
    return Response.json([product]);
  };
  const response = await onRequest({
    request: makeRequest("/api/share?catalog=technology&id=" + PRODUCT_ID + "&storage=256%20GB&ram=8%20GB&color=Azul"),
    env: { SUPABASE_URL: "https://db.example", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" }
  });
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/i);
  assert.match(html, /og:title" content="JB Test · X Pro · Phone X"/);
  assert.match(html, /og:image" content="https:\/\/images\.example\/phone-blue\.jpg"/);
  assert.match(html, /https:\/\/jb-collections\.pages\.dev\/tecnologia\/\?producto=/);
  assert.match(html, /storage=256\+GB/);
  assert.match(html, /ram=8\+GB/);
  assert.match(html, /color=Azul/);
});

test("returns 404 for a missing or unpublished product", async () => {
  globalThis.fetch = async () => Response.json([]);
  const response = await onRequest({ request: makeRequest("/api/share?catalog=perfumery&id=" + PRODUCT_ID), env: {} });
  assert.equal(response.status, 404);
  assert.match(await response.text(), /Published product not found/);
});

test("renders perfume metadata using perfume_details", async () => {
  const product = {
    id: PRODUCT_ID, name: "Amber Bloom", brand: "JB Parfums",
    catalog_type: "perfumery", is_published: true,
    price_usd: 75, image_url: "https://images.example/amber-bloom.jpg"
  };
  globalThis.fetch = async input => {
    const url = new URL(input);
    if (url.pathname.endsWith("/products")) return Response.json([product]);
    if (url.pathname.endsWith("/perfume_details")) {
      return Response.json([{ family: "nicho", concentration: "Eau de Parfum", volume_ml: 100 }]);
    }
    throw new Error("Unexpected Supabase table");
  };
  const response = await onRequest({ request: makeRequest("/api/share?catalog=perfumery&id=" + PRODUCT_ID), env: {} });
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /JB Parfums · Amber Bloom/);
  assert.match(html, /Familia: nicho/);
  assert.match(html, /Eau de Parfum/);
  assert.match(html, /100 ml/);
  assert.match(html, /https:\/\/jb-collections\.pages\.dev\/perfumeria\/\?fragancia=/);
});

test("deduplicates perfume brand prefixes and formats family labels for social previews", async () => {
  const product = {
    id: PRODUCT_ID, name: "Afnan · 9 Am Dive Unisex", brand: "Afnan",
    catalog_type: "perfumery", is_published: true,
    price_usd: 62, price_nio: 2294,
    image_url: "https://images.example/9am-dive.jpg"
  };
  globalThis.fetch = async input => {
    const url = new URL(input);
    if (url.pathname.endsWith("/products")) return Response.json([product]);
    if (url.pathname.endsWith("/perfume_details")) {
      return Response.json([{ family: "arabes", concentration: "EDP", volume_ml: 100 }]);
    }
    throw new Error("Unexpected Supabase table");
  };
  const response = await onRequest({ request: makeRequest("/api/share?catalog=perfumery&id=" + PRODUCT_ID), env: {} });
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.ok(html.includes("<title>Afnan · 9 Am Dive Unisex</title>"));
  assert.match(html, /og:title" content="Afnan · 9 Am Dive Unisex"/);
  assert.doesNotMatch(html, /Afnan · Afnan · 9 Am Dive/);
  assert.match(html, /Familia: Árabe/);
  assert.doesNotMatch(html, /Familia: arabes/);
  assert.ok(html.includes("US$62"));
});

test("returns HEAD without a body", async () => {
  globalThis.fetch = async () => Response.json([{ id: PRODUCT_ID, name: "Phone X", catalog_type: "technology", is_published: true }]);
  const response = await onRequest({ request: makeRequest("/api/share?catalog=technology&id=" + PRODUCT_ID, "HEAD"), env: {} });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
});

test("does not expose Supabase error details", async () => {
  globalThis.fetch = async () => new Response("sensitive database detail", { status: 500 });
  const response = await onRequest({ request: makeRequest("/api/share?catalog=technology&id=" + PRODUCT_ID), env: {} });
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /sensitive database detail/i);
});
