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

  function restoreSessionHistory() {
    try {
      const stored = JSON.parse(window.sessionStorage.getItem(sessionStorageKey) || "[]");
      if (!Array.isArray(stored)) return [];
      return stored.filter(item =>
        item && (item.role === "user" || item.role === "assistant")
        && typeof item.content === "string" && item.content.trim()
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
      '<div class="jb-ai-trust">Recomendaciones basadas en productos publicados. Confirmá disponibilidad con la tienda.</div>' +
      '<div class="jb-ai-messages" role="log" aria-live="polite" aria-relevant="additions text"></div>' +
      '<div class="jb-ai-quick-prompts">' +
        (catalogType === "perfumery"
          ? '<button type="button" data-prompt="Recomendame un perfume para uso diario.">Para diario</button><button type="button" data-prompt="Busco un perfume para regalar.">Para regalar</button><button type="button" data-prompt="Compará opciones según mis preferencias.">Comparar opciones</button><button type="button" data-prompt="Ayudame a elegir según mi presupuesto.">Según presupuesto</button>'
          : catalogType === "technology"
            ? '<button type="button" data-prompt="Busco un celular para juegos.">Para juegos</button><button type="button" data-prompt="Quiero una buena cámara y batería.">Cámara y batería</button><button type="button" data-prompt="Compará opciones según mi uso y presupuesto.">Comparar opciones</button><button type="button" data-prompt="Ayudame a elegir según mi presupuesto.">Según presupuesto</button>'
            : '<button type="button" data-prompt="Quiero un celular para juegos.">Tecnología</button><button type="button" data-prompt="Busco un perfume para regalar.">Perfumería</button><button type="button" data-prompt="Compará opciones de los dos catálogos según mis preferencias.">Comparar opciones</button><button type="button" data-prompt="Ayudame a elegir según mi presupuesto.">Según presupuesto</button>') +
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
  function addRecommendations(items) {
    if (!Array.isArray(items) || !items.length) return;
    const group = document.createElement("div");
    group.className = "jb-ai-recommendations";
    const heading = document.createElement("div");
    heading.className = "jb-ai-recommendations-heading";
    heading.textContent = items.length === 1 ? "La opción que mejor encaja" : "Opciones para comparar";
    group.appendChild(heading);

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
      if (Number.isFinite(product.price_usd)) prices.push("US$" + product.price_usd.toFixed(2));
      if (Number.isFinite(product.price_nio)) prices.push("C$" + product.price_nio.toLocaleString("es-NI", { maximumFractionDigits: 2 }));
      if (prices.length) {
        const price = document.createElement("span");
        price.className = "jb-ai-product-price";
        price.textContent = prices.join(" · ");
        card.appendChild(price);
      }

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
      card.appendChild(actions);
      group.appendChild(card);
    });
    messagesNode.appendChild(group);
    scrollMessages();
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

  async function sendMessage(text) {
    const cleanMessage = String(text || "").trim();
    if (!cleanMessage || pending) return;
    const previousHistory = history.slice(-maxHistory);

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
          catalogType: catalogType,
          message: cleanMessage,
          history: previousHistory
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
      loading.textContent = error && error.message
        ? error.message
        : "El asesor no está disponible en este momento.";
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
