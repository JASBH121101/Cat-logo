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
    image_url: "https://images.example.test/jb-phone-one.webp",
    featured: false,
    sort_order: 10,
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

test("allows the GitHub Pages catalog to reach the Cloudflare AI endpoint", async () => {
  const origin = "https://jasbh121101.github.io";
  const response = await onRequest({
    request: makeRequest({}, {method:"OPTIONS", origin}),
    env:{}
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
  assert.equal(response.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
  assert.equal(response.headers.get("Access-Control-Allow-Headers"), "Content-Type");
});

test("rejects origins outside the configured catalog origins", async () => {
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
      assert.equal(model, "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
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



test("uses JSON-schema output and validates model reasons against published recommendations", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    const parsed = new URL(String(url));
    assert.equal(parsed.pathname, "/rest/v1/products");
    return new Response(JSON.stringify([productRow()]), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  let runOptions;
  try {
    const response = await onRequest({
      request: makeRequest({
        catalogType: "technology",
        message: "Necesito un celular para el día a día hasta US$250."
      }, { ip: "192.0.2.141" }),
      env: {
        AI: {
          run: async (model, options) => {
            runOptions = { model, options };
            return {
              response: {
                reply: "Esta opción puede encajar con tu presupuesto y uso diario.",
                recommendations: [
                  { id: "tech-1", reason: "El catálogo la describe como una opción para el día a día." },
                  { id: "not-in-catalog", reason: "No debería aparecer." }
                ]
              }
            };
          }
        }
      }
    });
    assert.equal(response.status, 200);
    assert.equal(runOptions.model, "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
    assert.equal(runOptions.options.response_format.type, "json_schema");
    assert.deepEqual(runOptions.options.response_format.json_schema.required, ["reply", "recommendations"]);
    const data = await response.json();
    assert.equal(data.recommendations.length, 1);
    assert.equal(data.recommendations[0].id, "tech-1");
    assert.equal(data.recommendations[0].reason, "El catálogo la describe como una opción para el día a día.");
    assert.equal(data.recommendations[0].image_url, "https://images.example.test/jb-phone-one.webp");
    assert.match(data.recommendations[0].summary, /Celulares/);
    assert.equal(data.memory, "session");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("ranks current catalog context by the customer's use case and latest stated budget", async () => {
  const previousFetch = globalThis.fetch;
  const products = [
    productRow({
      id: "gaming-expensive",
      name: "Gaming Ultra",
      brand: "Studio",
      description: "Celular orientado a juegos",
      specifications: { RAM: "16 GB", battery: "5000 mAh" },
      price_usd: 699,
      price_nio: 25513,
      featured: true
    }),
    productRow({
      id: "gaming-fit",
      name: "Gaming Lite",
      brand: "Studio",
      description: "Celular para juegos y uso diario",
      specifications: { RAM: "8 GB", storage: "256 GB" },
      price_usd: 230,
      price_nio: 8395,
      featured: false
    }),
    productRow({
      id: "basic-phone",
      name: "Basic Phone",
      brand: "Everyday",
      description: "Celular para llamadas y mensajes",
      price_usd: 120,
      price_nio: 4380,
      featured: true
    })
  ];
  let catalogContext;
  globalThis.fetch = async url => {
    const parsed = new URL(String(url));
    assert.equal(parsed.pathname, "/rest/v1/products");
    return new Response(JSON.stringify(products), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  try {
    const response = await onRequest({
      request: makeRequest({
        catalogType: "technology",
        message: "Busco un celular para juegos hasta US$250",
        history: [
          { role: "user", content: "Me gustan los videojuegos." },
          { role: "assistant", content: "¿Qué presupuesto manejás?" },
          { role: "user", content: "Hasta US$250." }
        ]
      }, { ip: "192.0.2.142" }),
      env: {
        AI: {
          run: async (_model, options) => {
            const userMessage = options.messages[options.messages.length - 1].content;
            const marker = "Consulta actual y catálogo publicado de solo lectura. Elegí solo IDs presentes en estos productos y no inventés datos.\n";
            catalogContext = JSON.parse(userMessage.slice(userMessage.indexOf(marker) + marker.length));
            return { response: JSON.stringify({ reply: "Te muestro una opción ajustada.", recommended_ids: ["gaming-fit"] }) };
          }
        }
      }
    });
    assert.equal(response.status, 200);
    const ranked = catalogContext.published_products_ranked_for_this_request.map(product => product.id);
    assert.equal(ranked[0], "gaming-fit");
    assert.ok(ranked.includes("gaming-expensive"));
    assert.equal((await response.json()).recommendations[0].id, "gaming-fit");
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


test("compares exactly the two selected published technology devices in the requested order", async () => {
  const previousFetch = globalThis.fetch;
  const products = [
    productRow({
      id:"tech-1",
      name:"Phone Atlas",
      specifications:{RAM:"8 GB",Storage:"256 GB",Battery:"5000 mAh"},
      price_usd:249
    }),
    productRow({
      id:"tech-2",
      name:"Phone Nova",
      specifications:{RAM:"12 GB",Storage:"512 GB",Battery:"4800 mAh"},
      price_usd:279
    }),
    productRow({
      id:"tech-3",
      name:"Phone Unselected",
      specifications:{RAM:"4 GB"},
      price_usd:99
    })
  ];
  globalThis.fetch = async url => {
    const parsed = new URL(String(url));
    assert.equal(parsed.pathname,"/rest/v1/products");
    assert.equal(parsed.searchParams.get("catalog_type"),"eq.technology");
    return new Response(JSON.stringify(products),{status:200,headers:{"Content-Type":"application/json"}});
  };
  let catalogContext;
  try {
    const response = await onRequest({
      request:makeRequest({
        catalogType:"technology",
        message:"Compará estos equipos por rendimiento y precio.",
        comparisonIds:["tech-2","tech-1"]
      },{ip:"192.0.2.171"}),
      env:{
        AI:{
          run:async (_model, options) => {
            const prompt = options.messages[options.messages.length - 1].content;
            catalogContext = JSON.parse(prompt.slice(prompt.indexOf("{")));
            return {response:{
              reply:"Phone Nova ofrece más RAM y almacenamiento; Phone Atlas cuesta menos.",
              recommendations:[{id:"tech-1",reason:"Opción de menor precio."}]
            }};
          }
        }
      }
    });
    assert.equal(response.status,200);
    assert.equal(catalogContext.request_mode,"comparison_of_exactly_two_selected_technology_products");
    assert.deepEqual(
      catalogContext.published_products_ranked_for_this_request.map(product => product.id),
      ["tech-2","tech-1"]
    );
    assert.equal(catalogContext.published_products_ranked_for_this_request.length,2);
    const data = await response.json();
    assert.deepEqual(data.recommendations.map(product => product.id),["tech-2","tech-1"]);
    assert.equal(data.recommendations.length,2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("rejects comparison requests unless exactly two distinct technology IDs are supplied", async () => {
  const response = await onRequest({
    request:makeRequest({
      catalogType:"technology",
      message:"Compará estos equipos",
      comparisonIds:["tech-1","tech-1"]
    },{ip:"192.0.2.172"}),
    env:{AI:{run:async()=>({response:"{}"})}}
  });
  assert.equal(response.status,400);
  assert.equal((await response.json()).error,"invalid_comparison");
});


test("blocks personal contact and identity data before invoking the model", async () => {
  const previousFetch = globalThis.fetch;
  let aiCalls = 0;
  globalThis.fetch = async () => new Response("[]",{status:200,headers:{"Content-Type":"application/json"}});
  try {
    const response = await onRequest({
      request:makeRequest({catalogType:"technology",message:"Recomendame un celular, mi correo es jared@example.com"}),
      env:{AI:{run:async()=>{aiCalls++;return {response:"{}"};}}}
    });
    assert.equal(response.status,400);
    assert.equal((await response.json()).error,"personal_data_not_needed");
    assert.equal(aiCalls,0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("allows a credit-card payment question when no actual card or identity data is present", async () => {
  const previousFetch = globalThis.fetch;
  let aiCalls = 0;
  globalThis.fetch = async url => {
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith("/products")) {
      return new Response(JSON.stringify([productRow()]), {status:200,headers:{"Content-Type":"application/json"}});
    }
    return new Response("[]", {status:200,headers:{"Content-Type":"application/json"}});
  };
  try {
    const response = await onRequest({
      request: makeRequest({
        catalogType:"technology",
        message:"Quiero consultar sobre pagar con tarjeta de crédito. Producto: JB Phone One. Precio publicado: US$220."
      }, {ip:"192.0.2.202"}),
      env:{AI:{run:async()=>{aiCalls++;return {response:JSON.stringify({reply:"Un asesor puede confirmar las tarjetas aceptadas y los recargos aplicables.",recommended_ids:["tech-1"]})};}}}
    });
    assert.equal(response.status,200);
    assert.equal((await response.json()).reply,"Un asesor puede confirmar las tarjetas aceptadas y los recargos aplicables.");
    assert.equal(aiCalls,1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("filters personal contact data from session history before forwarding context to AI", async () => {
  const previousFetch = globalThis.fetch;
  let receivedMessages = [];
  globalThis.fetch = async url => {
    const parsed = new URL(String(url));
    if (parsed.pathname === "/rest/v1/products") {
      return new Response(JSON.stringify([productRow()]),{status:200,headers:{"Content-Type":"application/json"}});
    }
    return new Response("[]",{status:200,headers:{"Content-Type":"application/json"}});
  };
  try {
    const response = await onRequest({
      request:makeRequest({
        catalogType:"technology",
        message:"Busco un celular para juegos",
        history:[
          {role:"user",content:"Mi correo es jared@example.com"},
          {role:"assistant",content:"Claro, te ayudo."},
          {role:"user",content:"Mi presupuesto es 250 dólares"}
        ]
      },{ip:"192.0.2.188"}),
      env:{AI:{run:async(_model,options)=>{receivedMessages=options.messages;return {response:{reply:"Te ayudo a elegir.",recommendations:[]}};}}}
    });
    assert.equal(response.status,200);
    const serialized = JSON.stringify(receivedMessages);
    assert.equal(serialized.includes("jared@example.com"),false);
    assert.equal(serialized.includes("250 dólares"),true);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
