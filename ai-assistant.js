(() => {
  "use strict";
  if (window.__jbAiSalesAdvisorLoaded) return;
  window.__jbAiSalesAdvisorLoaded = true;

  const config = window.CATALOG_CONFIG || {};
  const catalogType = document.body.classList.contains("perfume-page") ? "perfumery" : "technology";
  const catalogName = catalogType === "perfumery" ? "JB Parfums" : "JB TECH";
  const baseUrl = String(config.publicCatalogUrl || "https://jb-collections.pages.dev").replace(/\/+$/, "");
  const endpoint = baseUrl + "/api/assistant";
  const whatsappNumber = String(config.whatsappNumber || "").replace(/\D/g, "");
  const history = [];
  const maxHistory = 6;

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
        '<button type="button" class="jb-ai-close" aria-label="Cerrar asesor IA">×</button>' +
      '</header>' +
      '<div class="jb-ai-trust">Recomendaciones basadas en productos publicados. Confirmá disponibilidad con la tienda.</div>' +
      '<div class="jb-ai-messages" role="log" aria-live="polite" aria-relevant="additions text"></div>' +
      '<div class="jb-ai-quick-prompts">' +
        (catalogType === "perfumery"
          ? '<button type="button" data-prompt="Recomendame un perfume para uso diario.">Para diario</button><button type="button" data-prompt="Busco un perfume para regalar.">Para regalar</button><button type="button" data-prompt="Ayudame a elegir según mi presupuesto.">Según presupuesto</button>'
          : '<button type="button" data-prompt="Busco un celular para juegos.">Para juegos</button><button type="button" data-prompt="Quiero una buena cámara y batería.">Cámara y batería</button><button type="button" data-prompt="Ayudame a elegir según mi presupuesto.">Según presupuesto</button>') +
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
        : "¡Hola! Soy el asesor virtual de JB TECH. Contame para qué usarías el equipo y tu presupuesto; te ayudo a comparar las opciones publicadas.");
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
    items.slice(0, 3).forEach(product => {
      const card = document.createElement("article");
      card.className = "jb-ai-product";
      const title = document.createElement("strong");
      title.className = "jb-ai-product-name";
      title.textContent = product.name || "Producto del catálogo";
      card.appendChild(title);
      if (product.brand) {
        const brand = document.createElement("span");
        brand.className = "jb-ai-product-brand";
        brand.textContent = product.brand;
        card.appendChild(brand);
      }
      const prices = [];
      if (Number.isFinite(product.price_usd)) prices.push("US$" + product.price_usd.toFixed(2));
      if (Number.isFinite(product.price_nio)) prices.push("C$" + product.price_nio.toLocaleString("es-NI", {maximumFractionDigits:2}));
      if (prices.length) {
        const price = document.createElement("span");
        price.className = "jb-ai-product-price";
        price.textContent = prices.join(" · ");
        card.appendChild(price);
      }
      const actions = document.createElement("div");
      actions.className = "jb-ai-product-actions";
      const detailsUrl = new URL(catalogType === "perfumery" ? "/perfumeria/" : "/tecnologia/", baseUrl);
      detailsUrl.searchParams.set(catalogType === "perfumery" ? "fragancia" : "producto", String(product.id));
      const details = document.createElement("a");
      details.href = detailsUrl.href;
      details.textContent = "Ver producto";
      details.className = "jb-ai-product-link";
      actions.appendChild(details);
      if (whatsappNumber) {
        const whats = document.createElement("a");
        const summary = product.name + (prices.length ? " (" + prices.join(" / ") + ")" : "");
        whats.href = "https://wa.me/" + whatsappNumber + "?text=" + encodeURIComponent("Hola, me interesa " + summary + ". ¿Me confirmás la disponibilidad?");
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
    addMessage("user", cleanMessage);
    const previousHistory = history.slice(-maxHistory);
    history.push({role:"user", content:cleanMessage});
    input.value = "";
    input.style.height = "auto";
    setPending(true);
    const loading = addMessage("assistant", "Estoy revisando el catálogo…");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {"Content-Type":"application/json"},
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
      history.push({role:"assistant", content:loading.textContent});
      if (history.length > 10) history.splice(0, history.length - 10);
      addRecommendations(data.recommendations);
    } catch (error) {
      loading.textContent = error && error.message
        ? error.message
        : "El asesor no está disponible en este momento.";
      if (!whatsappNumber) return;
      const help = document.createElement("a");
      help.className = "jb-ai-fallback-link";
      help.href = whatsappLink.href;
      help.target = "_blank";
      help.rel = "noopener";
      help.textContent = "Continuar por WhatsApp";
      messagesNode.appendChild(help);
    } finally {
      setPending(false);
      scrollMessages();
    }
  }

  launcher.addEventListener("click", () => panel.hidden ? openPanel() : closePanel());
  closeButton.addEventListener("click", closePanel);
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
})();
