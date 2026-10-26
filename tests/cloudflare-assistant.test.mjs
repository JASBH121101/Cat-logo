import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/assistant.js";

const ORIGIN = "https://jb-collections.pages.dev";

function makeRequest(body, options = {}) {
  const headers = new Headers({
    "Content-Type": "application/json",
    "CF-Connecting-IP": options.ip || ("192.0.2." + String(Math.floor(Math.random() * 200) + 1))
  });
  const requestedOrigin = Object.prototype.hasOwnProperty.call(options, "origin") ? options.origin : ORIGIN;
  if (requestedOrigin) headers.set("Origin", requestedOrigin);
  return new Request(ORIGIN + "/api/assistant", {
    method: options.method || "POST",
    headers,
    body: options.method === "GET" || options.method === "OPTIONS" ? undefined : JSON.stringify(body || {})
  });
}

function productRow(overrides = {}) {
  return {
    id: "tech-1",
    catalog_type: "technology",
    name: "JB Phone One",
    brand: "JB",
    category: "Celulares",
    product_type: "phone",
    description: "Equipo para el día a día",
    price_usd: 220,
    price_nio: 8030,
    availability: "available",
    is_published: true,
    workflow_status: "published",
    deleted_at: null,
    ...overrides
  };
}

test("rejects non-POST methods", async () => {
  const response = await onRequest({request: makeRequest({}, {method:"GET"}), env:{}});
  assert.equal(response.status, 405);
  assert.equal((await response.json()).error, "method_not_allowed");
});

test("rejects origins outside the official site and native app", async () => {
  for (const origin of ["https://attacker.example", "https://feature-jb-ai-sales-assistant.jb-collections.pages.dev", null]) {
    const options = origin === null ? {origin:""} : {origin};
    const response = await onRequest({
      request: makeRequest({catalogType:"technology", message:"Busco un celular"}, options),
      env:{AI:{run:async()=>({response:"{}"})}}
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "origin_not_allowed");
  }
});

test("rejects unknown catalog types and empty messages", async () => {
  const ai = {run:async()=>({response:"{}"})};
  const invalidCatalog = await onRequest({
    request:makeRequest({catalogType:"all", message:"Hola"}),
    env:{AI:ai}
  });
  assert.equal(invalidCatalog.status, 400);
  assert.equal((await invalidCatalog.json()).error, "invalid_catalog");

  const empty = await onRequest({
    request:makeRequest({catalogType:"technology", message:"   "}),
    env:{AI:ai}
  });
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).error, "empty_message");
});

test("returns a clear response when the Workers AI binding is not configured", async () => {
  const response = await onRequest({
    request:makeRequest({catalogType:"technology", message:"Busco un celular"}),
    env:{}
  });
  assert.equal(response.status, 503);
  assert.match((await response.json()).message, /todavía no está conectado/i);
});

test("uses published technology products and discards recommendations not in the catalogue", async () => {
  const previousFetch = globalThis.fetch;
  const calls = [];
  let promptSent = "";
  globalThis.fetch = async url => {
    const parsed = new URL(String(url));
    calls.push(parsed);
    assert.equal(parsed.pathname, "/rest/v1/products");
    assert.equal(parsed.searchParams.get("catalog_type"), "eq.technology");
    assert.equal(parsed.searchParams.get("is_published"), "eq.true");
    assert.equal(parsed.searchParams.get("workflow_status"), "eq.published");
    assert.equal(parsed.searchParams.get("deleted_at"), "is.null");
    return new Response(JSON.stringify([productRow()]), {
      status:200,
      headers:{"Content-Type":"application/json"}
    });
  };
  const ai = {
    run:async (model, input) => {
      assert.equal(model, "@cf/meta/llama-3.1-8b-instruct-fp8");
      promptSent = input.messages.map(item=>item.content).join("\n");
      return {response:JSON.stringify({
        reply:"Para tu presupuesto, esta opción puede servirte.",
        recommended_ids:["tech-1","not-a-real-product"]
      })};
    }
  };
  try {
    const response = await onRequest({
      request:makeRequest({catalogType:"technology",message:"Quiero un celular para redes, hasta US$250."},{ip:"192.0.2.101"}),
      env:{AI:ai}
    });
    assert.equal(response.status,200);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"),ORIGIN);
    const data = await response.json();
    assert.equal(data.reply,"Para tu presupuesto, esta opción puede servirte.");
    assert.equal(data.recommendations.length,1);
    assert.equal(data.recommendations[0].id,"tech-1");
    assert.equal(data.recommendations[0].name,"JB Phone One");
    assert.equal(data.recommendations[0].price_usd,220);
    assert.match(promptSent,/JB Phone One/);
    assert.equal(calls.length,1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("adds published perfume details for perfumery and tags recommendations with their catalog", async () => {
  const previousFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async url => {
    const parsed = new URL(String(url));
    urls.push(parsed);
    if (parsed.pathname.endsWith("/products")) {
      assert.equal(parsed.searchParams.get("catalog_type"), "eq.perfumery");
      return new Response(JSON.stringify([productRow({
        id:"perfume-1",
        catalog_type:"perfumery",
        name:"Amber Night",
        category:"Perfumes",
        product_type:"perfume",
        price_usd:38,
        price_nio:1387,
        perfume_details:undefined
      })]), {status:200,headers:{"Content-Type":"application/json"}});
    }
    assert.equal(parsed.pathname,"/rest/v1/perfume_details");
    assert.equal(parsed.searchParams.get("product_id"),"in.(perfume-1)");
    return new Response(JSON.stringify([{
      product_id:"perfume-1",
      family:"Oriental",
      concentration:"Eau de Parfum",
      volume_ml:100,
      audience:"unisex",
      scent_family:"Amaderada",
      top_notes:["bergamota"],
      heart_notes:["ámbar"],
      base_notes:["vainilla"],
      is_original:true
    }]),{status:200,headers:{"Content-Type":"application/json"}});
  };
  try {
    const response = await onRequest({
      request:makeRequest({catalogType:"perfumery",message:"Quiero algo amaderado para regalar."},{ip:"192.0.2.102"}),
      env:{AI:{run:async()=>({response:JSON.stringify({reply:"Amber Night podría encajar con lo que describís.",recommended_ids:["perfume-1"]})})}}
    });
    assert.equal(response.status,200);
    const data = await response.json();
    assert.equal(data.recommendations.length,1);
    assert.equal(data.recommendations[0].catalog_type,"perfumery");
    assert.equal(urls.length,2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("the landing-page mode combines both catalogues and routes recommendations to the source catalogue", async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async url => {
    const parsed = new URL(String(url));
    requests.push(parsed);
    if (parsed.pathname.endsWith("/products")) {
      const catalog = parsed.searchParams.get("catalog_type");
      if (catalog === "eq.technology") {
        return new Response(JSON.stringify([productRow()]),{status:200,headers:{"Content-Type":"application/json"}});
      }
      assert.equal(catalog,"eq.perfumery");
      return new Response(JSON.stringify([productRow({
        id:"perfume-1",
        catalog_type:"perfumery",
        name:"Amber Night",
        category:"Perfumes",
        product_type:"perfume"
      })]),{status:200,headers:{"Content-Type":"application/json"}});
    }
    assert.equal(parsed.pathname,"/rest/v1/perfume_details");
    return new Response("[]",{status:200,headers:{"Content-Type":"application/json"}});
  };
  try {
    const response = await onRequest({
      request:makeRequest({catalogType:"collections",message:"Quiero comparar un teléfono y un perfume."},{ip:"192.0.2.103"}),
      env:{AI:{run:async()=>({response:JSON.stringify({reply:"Podemos revisar ambas categorías.",recommended_ids:["perfume-1","tech-1"]})})}}
    });
    assert.equal(response.status,200);
    const data = await response.json();
    assert.equal(data.recommendations.length,2);
    assert.deepEqual(data.recommendations.map(item=>item.catalog_type),["perfumery","technology"]);
    assert.equal(requests.length,3);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("rate-limits repeated requests from the same client address", async () => {
  const ip = "192.0.2.199";
  const env = {AI:{run:async()=>({response:"{}"})}};
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("[]",{status:200,headers:{"Content-Type":"application/json"}});
  try {
    let last;
    for (let index=0;index<9;index++) {
      last = await onRequest({
        request:makeRequest({catalogType:"technology",message:"Busco celular"},{ip}),
        env
      });
    }
    assert.equal(last.status,429);
    assert.equal((await last.json()).error,"rate_limited");
  } finally {
    globalThis.fetch = previousFetch;
  }
});
