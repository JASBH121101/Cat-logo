(() => {
  "use strict";
  if (window.__jbAiSalesAdvisorLoaded) return;
  window.__jbAiSalesAdvisorLoaded = true;

  const config = window.CATALOG_CONFIG || {};
  const catalogType = document.body.classList.contains("perfume-page")
    ? "perfumery"
    : document.body.classList.contains("technology-catalog")
      ? "technology"
      : "collections";
  const catalogName = catalogType === "perfumery" ? "JB Parfums" : catalogType === "technology" ? "JB TECH" : "JB Collections";
  const baseUrl = String(config.publicCatalogUrl || "https://jb-collections.pages.dev").replace(/\/+$/, "");
  const endpoint = baseUrl + "/api/assistant";
  const whatsappNumber = String(config.whatsappNumber || "").replace(/\D/g, "");
  const maxHistory = 8;
  const sessionStorageKey = "jb-ai-conversation-v2";
  const history = restoreSessionHistory();

  function containsPersonalInformation(value) {
    const text = String(value == null ? "" : value);
    const patterns = [
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
      /(?:\+?505[\s().-]?)?(?:\d[\s().-]?){8,}/,
      /\b(?:c[eé]dula|n[uú]mero de identidad|pasaporte|cuenta bancaria)\b(?:\s+(?:n[uú]mero|no\.?|es))?\s*(?:[:=#]\s*)?(?=[A-Z0-9-]{6,}\b)(?=[A-Z0-9-]*\d)[A-Z0-9-]{6,}\b/i,
      /contrase[nñ]a\s*(?:es|:|=)\s*\S{6,}/i,
      /\b(?:mi tarjeta(?: bancaria)?|n[uú]mero de tarjeta|tarjeta (?:bancaria|de crédito|de débito))\b\s*(?:(?:es|n[uú]mero|no\.?|#)\s*)?[:=]?\s*(?:[0-9][ -]?){12,19}/i,
      /\b(?:mi direcci[oó]n|mi domicilio|ubicaci[oó]n exacta|vivo en|mi casa queda)\b\s*(?:es|:)?\s*[^,.!?]{4,}/i
    ];
    return patterns.some(pattern => pattern.test(text));
  }

  function restoreSessionHistory() {
    try {
      const stored = JSON.parse(window.sessionStorage.getItem(sessionStorageKey) || "[]");
      if (!Array.isArray(stored)) return [];
      return stored.filter(item =>
        item && (item.role === "user" || item.role === "assistant")
        && typeof item.content === "string" && item.content.trim()
        && !containsPersonalInformation(item.content)
      ).map(item => ({
        role: item.role,
        content: item.content.trim().slice(0, 1500)
      })).slice(-maxHistory * 2);
    } catch { return []; }
  }

  function persistSessionHistory() {
    try {
      window.sessionStorage.setItem(sessionStorageKey, JSON.stringify(history.slice(-maxHistory * 2)));
    } catch {}
  }

  function trimSessionHistory() {
    if (history.length > maxHistory * 2) history.splice(0, history.length - maxHistory * 2);
  }

  // Rewrite any old session cache after removing messages that look like personal data.
  persistSessionHistory();

  const root = document.createElement("div");
  root.className = "jb-ai-advisor";
  root.innerHTML =
    '<button type="button" class="jb-ai-launcher" aria-controls="jb-ai-panel" aria-expanded="false" aria-label="Abrir asesor IA de JB Collections">' +
      '<span class="jb-ai-launcher-spark" aria-hidden="true">✦</span>' +
      '<span class="jb-ai-launcher-label">Asesor IA</span>' +
    '</button>' +
    '<section id="jb-ai-panel" class="jb-ai-panel" aria-label="Asesor virtual de JB Collections" hidden>' +
      '<header class="jb-ai-header">' +
        '<span class="jb-ai-avatar" aria-hidden="true">✦</span>' +
        '<span class="jb-ai-title-wrap"><strong>Asesor IA · ' + catalogName + '</strong><small>Te ayuda a elegir, sin compromiso</small></span>' +
        '<button type="button" class="jb-ai-reset" aria-label="Nueva conversación" title="Nueva conversación">↻</button>' +
      '<button type="button" class="jb-ai-close" aria-label="Cerrar asesor IA">×</button>' +
      '</header>' +
      '<div class="jb-ai-trust">Recomendaciones basadas en productos publicados. No compartás datos personales; la memoria dura solo en esta sesión. Confirmá disponibilidad con la tienda.</div>' +
      '<div class="jb-ai-messages" role="log" aria-live="polite" aria-relevant="additions text"></div>' +
      '<div class="jb-ai-quick-prompts">' +
        (catalogType === "perfumery"
          ? '<button type="button" data-prompt="Recomendame un perfume para uso diario.">Para diario</button><button type="button" data-prompt="Busco un perfume para regalar.">Para regalar</button><button type="button" data-prompt="Compará opciones según mis preferencias.">Comparar opciones</button><button type="button" data-prompt="Ayudame a elegir según mi presupuesto.">Según presupuesto</button>'
          : catalogType === "technology"
            ? '<button type="button" data-prompt="Busco un celular para juegos.">Para juegos</button><button type="button" data-prompt="Quiero una buena cámara y batería.">Cámara y batería</button><button type="button" data-prompt="Compará los equipos que mejor encajen con mi presupuesto y uso; explicame las diferencias de precio, RAM, almacenamiento, batería y rendimiento.">Comparar equipos</button><button type="button" data-prompt="Ayudame a elegir según mi presupuesto.">Según presupuesto</button>'
            : '<button type="button" data-prompt="Quiero un celular para juegos.">Tecnología</button><button type="button" data-prompt="Busco un perfume para regalar.">Perfumería</button><button type="button" data-prompt="Quiero comparar equipos de tecnología según mi presupuesto y uso. Explicame sus diferencias y cuál conviene más.">Comparar equipos</button><button type="button" data-prompt="Ayudame a elegir según mi presupuesto.">Según presupuesto</button>') +
      '</div>' +
      '<form class="jb-ai-form">' +
        '<label class="jb-ai-sr-only" for="jb-ai-input">Tu consulta</label>' +
        '<textarea id="jb-ai-input" rows="1" maxlength="600" placeholder="¿Qué estás buscando?" required></textarea>' +
        '<button type="submit" class="jb-ai-send" aria-label="Enviar consulta"><span aria-hidden="true">↑</span></button>' +
      '</form>' +
      '<div class="jb-ai-footer"><span>IA · JB Collections</span><a class="jb-ai-whatsapp" target="_blank" rel="noopener">Hablar por WhatsApp</a></div>' +
    '</section>';
  document.body.appendChild(root);

  const launcher = root.querySelector(".jb-ai-launcher");
  const panel = root.querySelector(".jb-ai-panel");
  const closeButton = root.querySelector(".jb-ai-close");
  const resetButton = root.querySelector(".jb-ai-reset");
  const messagesNode = root.querySelector(".jb-ai-messages");
  const form = root.querySelector(".jb-ai-form");
  const input = root.querySelector("#jb-ai-input");
  const sendButton = root.querySelector(".jb-ai-send");
  const quickPrompts = root.querySelector(".jb-ai-quick-prompts");
  const whatsappLink = root.querySelector(".jb-ai-whatsapp");
  let pending = false;
  let welcomeShown = false;

  whatsappLink.href = whatsappNumber
    ? "https://wa.me/" + whatsappNumber + "?text=" + encodeURIComponent("Hola, vengo del asesor IA de " + catalogName + " y necesito ayuda para elegir un producto.")
    : baseUrl;

  function openPanel() {
    panel.hidden = false;
    launcher.setAttribute("aria-expanded", "true");
    launcher.classList.add("is-open");
    if (!welcomeShown) {
      addMessage("assistant", catalogType === "perfumery"
        ? "¡Hola! Soy el asesor virtual de JB Parfums. Contame qué tipo de fragancia te gusta, para qué ocasión o cuál es tu presupuesto."
        : catalogType === "technology"
          ? "¡Hola! Soy el asesor virtual de JB TECH. Contame para qué usarías el equipo y tu presupuesto; te ayudo a comparar las opciones publicadas."
          : "¡Hola! Soy el asesor virtual de JB Collections. Te puedo orientar entre tecnología y perfumería. Contame qué buscás, para quién es y cuánto querés invertir.");
      welcomeShown = true;
    }
    scrollMessages();
  }
  function closePanel() {
    panel.hidden = true;
    launcher.setAttribute("aria-expanded", "false");
    launcher.classList.remove("is-open");
  }
  function scrollMessages() {
    messagesNode.scrollTop = messagesNode.scrollHeight;
  }
  function addMessage(role, text) {
    const bubble = document.createElement("div");
    bubble.className = "jb-ai-message " + (role === "user" ? "is-user" : "is-assistant");
    bubble.textContent = String(text || "");
    messagesNode.appendChild(bubble);
    scrollMessages();
    return bubble;
  }
  function availabilityPresentation(value) {
    const normalized = String(value || "").trim().toLocaleLowerCase("es");
    if (["on_order", "order", "por pedido"].includes(normalized)) {
      return { label: "Por pedido", state: "order" };
    }
    if (["out_of_stock", "unavailable", "agotado", "no disponible", "agotado temporalmente"].includes(normalized)) {
      return { label: "Agotado", state: "unavailable" };
    }
    return { label: "Disponible", state: "available" };
  }

  function addRecommendations(items) {
    if (!Array.isArray(items) || !items.length) return;
    const group = document.createElement("div");
    group.className = "jb-ai-recommendations";
    const heading = document.createElement("div");
    heading.className = "jb-ai-recommendations-heading";
    heading.textContent = items.length === 1 ? "La opción que mejor encaja" : "Opciones para comparar";
    group.appendChild(heading);

    const comparisonSelection = [];
    const comparisonStatus = document.createElement("p");
    comparisonStatus.className = "jb-ai-compare-status";
    comparisonStatus.setAttribute("aria-live", "polite");
    comparisonStatus.hidden = true;
    const comparisonPanel = document.createElement("div");
    comparisonPanel.className = "jb-ai-compare-panel";
    const comparisonButtons = [];
    let hasTechnologyOptions = false;

    items.slice(0, 3).forEach((product, index) => {
      const card = document.createElement("article");
      card.className = "jb-ai-product";
      card.dataset.productId = String(product.id || "");

      const top = document.createElement("div");
      top.className = "jb-ai-product-top";
      if (product.image_url) {
        try {
          const imageUrl = new URL(product.image_url);
          if (imageUrl.protocol === "https:") {
            const media = document.createElement("div");
            media.className = "jb-ai-product-media";
            const image = document.createElement("img");
            image.src = imageUrl.href;
            image.alt = "";
            image.loading = "lazy";
            image.decoding = "async";
            image.referrerPolicy = "no-referrer";
            image.addEventListener("error", () => media.remove(), { once: true });
            media.appendChild(image);
            top.appendChild(media);
          }
        } catch {}
      }

      const main = document.createElement("div");
      main.className = "jb-ai-product-main";
      const eyebrow = document.createElement("span");
      eyebrow.className = "jb-ai-product-eyebrow";
      eyebrow.textContent = "OPCIÓN " + String(index + 1).padStart(2, "0");
      main.appendChild(eyebrow);

      const title = document.createElement("strong");
      title.className = "jb-ai-product-name";
      title.textContent = product.name || "Producto del catálogo";
      main.appendChild(title);

      if (product.brand) {
        const brand = document.createElement("span");
        brand.className = "jb-ai-product-brand";
        brand.textContent = product.brand;
        main.appendChild(brand);
      }
      top.appendChild(main);
      card.appendChild(top);

      const prices = [];
      const priceUsd = product.price_usd === null || product.price_usd === undefined || product.price_usd === "" ? NaN : Number(product.price_usd);
      const priceNio = product.price_nio === null || product.price_nio === undefined || product.price_nio === "" ? NaN : Number(product.price_nio);
      if (Number.isFinite(priceUsd)) prices.push("US$" + priceUsd.toFixed(2));
      if (Number.isFinite(priceNio)) prices.push("C$" + priceNio.toLocaleString("es-NI", { maximumFractionDigits: 2 }));
      if (prices.length) {
        const price = document.createElement("span");
        price.className = "jb-ai-product-price";
        price.textContent = prices.join(" · ");
        card.appendChild(price);
      }

      const availability = availabilityPresentation(product.availability);
      const availabilityBadge = document.createElement("span");
      availabilityBadge.className = "jb-ai-product-availability jb-ai-product-availability--" + availability.state;
      availabilityBadge.textContent = availability.label;
      availabilityBadge.setAttribute("aria-label", "Disponibilidad: " + availability.label);
      card.appendChild(availabilityBadge);

      if (product.summary) {
        const summary = document.createElement("p");
        summary.className = "jb-ai-product-summary";
        summary.textContent = product.summary;
        card.appendChild(summary);
      }
      if (product.reason) {
        const reason = document.createElement("p");
        reason.className = "jb-ai-product-reason";
        reason.textContent = product.reason;
        card.appendChild(reason);
      }

      const actions = document.createElement("div");
      actions.className = "jb-ai-product-actions";
      const productCatalog = product.catalog_type || catalogType;
      const productIsPerfume = productCatalog === "perfumery";
      const detailsUrl = new URL(productIsPerfume ? "/perfumeria/" : "/tecnologia/", baseUrl);
      detailsUrl.searchParams.set(productIsPerfume ? "fragancia" : "producto", String(product.id));
      const details = document.createElement("a");
      details.href = detailsUrl.href;
      details.textContent = "Ver producto";
      details.className = "jb-ai-product-link";
      actions.appendChild(details);

      if (whatsappNumber) {
        const whats = document.createElement("a");
        const summary = product.name + (prices.length ? " (" + prices.join(" / ") + ")" : "");
        const inquiry = "Hola, vengo del asesor IA de " + (productIsPerfume ? "JB Parfums" : "JB TECH")
          + ". Me interesa " + summary + ". ¿Me confirmás disponibilidad y detalles?";
        whats.href = "https://wa.me/" + whatsappNumber + "?text=" + encodeURIComponent(inquiry);
        whats.target = "_blank";
        whats.rel = "noopener";
        whats.textContent = "Consultar";
        whats.className = "jb-ai-product-whatsapp";
        actions.appendChild(whats);
      }
      if (productCatalog === "technology") {
        hasTechnologyOptions = true;
        const compare = document.createElement("button");
        compare.type = "button";
        compare.className = "jb-ai-compare-toggle";
        compare.textContent = "＋ Comparar";
        compare.setAttribute("aria-pressed", "false");
        compare.setAttribute("aria-label", "Agregar " + (product.name || "equipo") + " a la comparación");
        compare.addEventListener("click", () => {
          const currentIndex = comparisonSelection.findIndex(item => String(item.id) === String(product.id));
          if (currentIndex >= 0) {
            comparisonSelection.splice(currentIndex, 1);
          } else if (comparisonSelection.length >= 2) {
            comparisonStatus.hidden = false;
            comparisonStatus.textContent = "Compará dos equipos a la vez. Quitá uno para elegir otro modelo.";
            return;
          } else {
            comparisonSelection.push(product);
          }
          comparisonButtons.forEach(entry => {
            const selected = comparisonSelection.some(item => String(item.id) === entry.id);
            entry.button.textContent = selected ? "✓ Seleccionado" : "＋ Comparar";
            entry.button.setAttribute("aria-pressed", String(selected));
          });
          comparisonStatus.hidden = false;
          comparisonStatus.textContent = comparisonSelection.length === 0
            ? "Selección limpia. Elegí dos equipos para compararlos."
            : comparisonSelection.length === 1
              ? "Elegiste 1 equipo. Seleccioná otro para ver las diferencias."
              : "Ya elegiste dos equipos. Revisá la comparación o pedile una evaluación a la IA.";
          renderEquipmentComparison(comparisonPanel, comparisonSelection);
        });
        comparisonButtons.push({id:String(product.id),button:compare});
        actions.appendChild(compare);
      }
      card.appendChild(actions);
      group.appendChild(card);
    });
    if (hasTechnologyOptions) {
      group.appendChild(comparisonStatus);
      group.appendChild(comparisonPanel);
    }
    messagesNode.appendChild(group);
    scrollMessages();
  }
  function comparisonDisplayValue(value) {
    if (value == null || value === "") return "No informado";
    if (Array.isArray(value)) return value.map(comparisonDisplayValue).join(" · ").slice(0, 220);
    if (typeof value === "object") {
      return Object.entries(value).map(([key, item]) => key + ": " + comparisonDisplayValue(item)).join(" · ").slice(0, 220);
    }
    return String(value).trim().slice(0, 220) || "No informado";
  }

  function specificationEntries(product) {
    const raw = product && product.specifications;
    if (!raw) return [];
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed)) return parsed.map((item, index) => [String(index + 1), item]);
      if (parsed && typeof parsed === "object") return Object.entries(parsed);
    } catch {}
    return [["Características", raw]];
  }

  function matchingSpecification(product, pattern) {
    const match = specificationEntries(product).find(([key]) => pattern.test(String(key)));
    return match ? comparisonDisplayValue(match[1]) : "No informado";
  }

  function comparisonPrice(product, field, prefix) {
    const value = Number(product && product[field]);
    return Number.isFinite(value) && value > 0
      ? prefix + value.toLocaleString("es-NI", {minimumFractionDigits: 2, maximumFractionDigits: 2})
      : "No informado";
  }

  function renderEquipmentComparison(panelNode, products) {
    panelNode.replaceChildren();
    if (!Array.isArray(products) || products.length !== 2) return;

    const title = document.createElement("h4");
    title.className = "jb-ai-compare-title";
    title.textContent = "Comparación de equipos";
    panelNode.appendChild(title);

    const scroller = document.createElement("div");
    scroller.className = "jb-ai-compare-scroll";
    const table = document.createElement("table");
    table.className = "jb-ai-compare-table";
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["Característica", products[0].name || "Equipo 1", products[1].name || "Equipo 2"].forEach(label => {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = label;
      headRow.appendChild(cell);
    });
    head.appendChild(headRow);
    table.appendChild(head);

    const rows = [
      ["Marca", product => product.brand],
      ["Precio (USD)", product => comparisonPrice(product, "price_usd", "US$ ")],
      ["Precio (NIO)", product => comparisonPrice(product, "price_nio", "C$ ")],
      ["RAM", product => matchingSpecification(product, /\b(ram|memoria ram)\b/i)],
      ["Almacenamiento", product => matchingSpecification(product, /(almacenamiento|storage|memoria interna|rom)/i)],
      ["Procesador", product => matchingSpecification(product, /(procesador|processor|cpu|chipset)/i)],
      ["Batería", product => matchingSpecification(product, /(bater[ií]a|battery|mah)/i)],
      ["Pantalla", product => matchingSpecification(product, /(pantalla|display|screen|pulgadas|inches)/i)],
      ["Cámaras", product => matchingSpecification(product, /(c[aá]mara|camera|megap[ií]xeles)/i)],
      ["Conectividad", product => matchingSpecification(product, /(conectividad|network|5g|4g|wifi)/i)],
      ["Garantía", product => product.warranty_months ? String(product.warranty_months) + " meses" : "No informada"],
      ["Disponibilidad", product => product.availability],
      ["Otras especificaciones", product => comparisonDisplayValue(product.specifications)],
      ["Variantes", product => comparisonDisplayValue(product.variants)],
      ["Colores", product => comparisonDisplayValue(product.colors)]
    ];
    const bodyNode = document.createElement("tbody");
    rows.forEach(([label, valueFor]) => {
      const row = document.createElement("tr");
      const labelCell = document.createElement("th");
      labelCell.scope = "row";
      labelCell.textContent = label;
      row.appendChild(labelCell);
      products.forEach(product => {
        const cell = document.createElement("td");
        cell.textContent = comparisonDisplayValue(valueFor(product));
        row.appendChild(cell);
      });
      bodyNode.appendChild(row);
    });
    table.appendChild(bodyNode);
    scroller.appendChild(table);
    panelNode.appendChild(scroller);

    const actions = document.createElement("div");
    actions.className = "jb-ai-compare-actions";
    const aiButton = document.createElement("button");
    aiButton.type = "button";
    aiButton.className = "jb-ai-compare-ai";
    aiButton.textContent = "Comparar con IA";
    aiButton.addEventListener("click", () => {
      const names = products.map(product => product.name || "equipo").join(" y ");
      void sendMessage("Compará estos dos equipos: " + names + ". Explicame las diferencias importantes, qué datos destacan y cuál conviene según mi presupuesto y uso. Usá solo datos publicados.", {
        comparisonIds: products.map(product => String(product.id))
      });
    });
    actions.appendChild(aiButton);

    if (whatsappNumber) {
      const whats = document.createElement("a");
      const lines = products.map(product => {
        const price = comparisonPrice(product, "price_usd", "US$ ");
        return (product.name || "Equipo") + " (" + price + ")";
      });
      whats.href = "https://wa.me/" + whatsappNumber + "?text=" + encodeURIComponent(
        "Hola, vengo del asesor IA de JB TECH. Quiero comparar estos equipos: " + lines.join(" y ") + ". ¿Me ayudan a elegir y me confirman disponibilidad y especificaciones?"
      );
      whats.target = "_blank";
      whats.rel = "noopener";
      whats.className = "jb-ai-compare-whatsapp";
      whats.textContent = "Consultar ambos por WhatsApp";
      actions.appendChild(whats);
    }
    panelNode.appendChild(actions);
  }

  function setPending(value) {
    pending = value;
    sendButton.disabled = value;
    input.disabled = value;
    sendButton.classList.toggle("is-loading", value);
    sendButton.setAttribute("aria-busy", String(value));
    if (value) sendButton.innerHTML = '<span aria-hidden="true">…</span>';
    else sendButton.innerHTML = '<span aria-hidden="true">↑</span>';
  }

  async function sendMessage(text, options = {}) {
    const cleanMessage = String(text || "").trim();
    if (!cleanMessage || pending) return;
    if (containsPersonalInformation(cleanMessage)) {
      input.value = "";
      input.style.height = "auto";
      addMessage("assistant", "Por privacidad, no necesito tu teléfono, correo, dirección, número de identidad ni datos de pago. No enviaré este mensaje; escribí de nuevo tu consulta sin esos datos.");
      return;
    }
    const previousHistory = history.slice(-maxHistory).filter(item => !containsPersonalInformation(item.content)).map(item => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content: String(item.content || "").slice(0, 450)
    }));

    addMessage("user", cleanMessage);
    history.push({ role: "user", content: cleanMessage });
    trimSessionHistory();
    persistSessionHistory();
    input.value = "";
    input.style.height = "auto";
    setPending(true);
    const loading = addMessage("assistant", "Estoy revisando el catálogo y tus preferencias…");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          catalogType: options.comparisonIds ? "technology" : catalogType,
          message: cleanMessage,
          history: previousHistory,
          comparisonIds: Array.isArray(options.comparisonIds) ? options.comparisonIds.slice(0, 2) : undefined
        })
      });
      let data;
      try { data = await response.json(); } catch { data = null; }
      if (!response.ok) throw new Error(data && data.message ? data.message : "No se pudo completar la consulta.");
      loading.textContent = data.reply || "No encontré una respuesta. Probá con otros detalles.";
      history.push({ role: "assistant", content: loading.textContent });
      trimSessionHistory();
      persistSessionHistory();
      addRecommendations(data.recommendations);
    } catch (error) {
      const errorMessage = String(error && error.message || "");
      const isNetworkFailure = /failed to fetch|networkerror|network request failed|load failed/i.test(errorMessage);
      if (isNetworkFailure) {
        console.error("[JB Collections] No se pudo conectar con el asesor IA.", {
          endpoint,
          pageOrigin: window.location.origin,
          error
        });
        loading.textContent = "No pude conectar con el asesor IA en este momento. Probá de nuevo o continuá por WhatsApp.";
      } else {
        loading.textContent = errorMessage || "El asesor no está disponible ahora. Probá de nuevo o consultá por WhatsApp.";
      }
      history.push({ role: "assistant", content: loading.textContent });
      trimSessionHistory();
      persistSessionHistory();
      if (whatsappNumber) {
        const help = document.createElement("a");
        help.className = "jb-ai-fallback-link";
        help.href = whatsappLink.href;
        help.target = "_blank";
        help.rel = "noopener";
        help.textContent = "Continuar por WhatsApp";
        messagesNode.appendChild(help);
      }
    } finally {
      setPending(false);
      scrollMessages();
    }
  }

  function resetConversation() {
    history.length = 0;
    persistSessionHistory();
    messagesNode.replaceChildren();
    welcomeShown = false;
    addMessage("assistant", catalogType === "perfumery"
      ? "¡Hola! Soy el asesor virtual de JB Parfums. Contame qué tipo de fragancia te gusta, para qué ocasión o cuál es tu presupuesto."
      : catalogType === "technology"
        ? "¡Hola! Soy el asesor virtual de JB TECH. Contame para qué usarías el equipo y tu presupuesto; te ayudo a comparar las opciones publicadas."
        : "¡Hola! Soy el asesor virtual de JB Collections. Te puedo orientar entre tecnología y perfumería. Contame qué buscás, para quién es y cuánto querés invertir.");
    welcomeShown = true;
    input.focus();
  }

  window.openJBAiAdvisor = message => {
    openPanel();
    const cleanMessage = String(message || "").trim().slice(0, 590);
    if (cleanMessage) void sendMessage(cleanMessage);
    else input.focus();
  };
  window.addEventListener("jb-ai-open", event => {
    window.openJBAiAdvisor(event.detail && event.detail.message);
  });

  launcher.addEventListener("click", () => panel.hidden ? openPanel() : closePanel());
  closeButton.addEventListener("click", closePanel);
  resetButton.addEventListener("click", resetConversation);
  form.addEventListener("submit", event => {
    event.preventDefault();
    void sendMessage(input.value);
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 96) + "px";
  });
  quickPrompts.addEventListener("click", event => {
    const button = event.target.closest("[data-prompt]");
    if (button) void sendMessage(button.getAttribute("data-prompt"));
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !panel.hidden) closePanel();
  });

  if (history.length) {
    history.forEach(item => addMessage(item.role, item.content));
    welcomeShown = true;
  }
})();
