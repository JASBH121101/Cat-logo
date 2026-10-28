(() => {
  "use strict";
  const config = window.CATALOG_CONFIG || {};
  const baseUrl = String(config.publicCatalogUrl || "https://jb-collections.pages.dev").replace(/\/+$/, "");
  const endpoint = baseUrl + "/api/private-chat";
  const sessionKey = "jb-private-chat-session-v1";
  const conversationKey = "jb-private-chat-conversation-v1";
  const noticeVersion = "jb-private-chat-2026-10-28-v1";
  const query = new URLSearchParams(window.location.search);
  const $ = (selector) => document.querySelector(selector);
  const statusNode = $("#chat-status");
  const consentScreen = $("#chat-consent-screen");
  const declinedScreen = $("#chat-declined-screen");
  const conversationScreen = $("#chat-conversation-screen");
  const messagesNode = $("#chat-messages");
  const input = $("#chat-message-input");
  const sendButton = $("#chat-send-button");
  const acceptButton = $("#chat-accept-button");
  const declineButton = $("#chat-decline-button");
  let sessionToken = "";
  let conversationId = "";
  let conversation = null;
  let messages = [];
  let polling = false;
  let countdownHandle = null;
  let countdownTarget = "";
  let lastRenderedMessageIds = new Set();
  let inFlight = false;

  function showStatus(message, error = false) {
    statusNode.hidden = !message;
    statusNode.textContent = message || "";
    statusNode.classList.toggle("is-error", Boolean(error));
  }
  function topicLabel(topic) {
    return ({ product: "Consulta de producto", financing: "Financiamiento", credit_card: "Tarjeta de crédito", other: "Otra consulta" })[topic] || "Consulta general";
  }
  function contextFromUrl() {
    const catalog = ["technology", "perfumery", "collections"].includes(query.get("catalog_type")) ? query.get("catalog_type") : "collections";
    const name = String(query.get("product_name") || "").trim().slice(0, 160) || "Consulta general";
    const productUrl = String(query.get("product_url") || "https://jb-collections.pages.dev/").slice(0, 500);
    const productId = String(query.get("product_id") || "");
    const topic = ["product", "financing", "credit_card", "other"].includes(query.get("payment_topic")) ? query.get("payment_topic") : "product";
    return { catalog_type: catalog, product_id: productId, product_name: name, product_url: productUrl, payment_topic: topic };
  }
  function cleanPersonalData(text) {
    const patterns = [
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
      /(?<!\d)(?:\+?505[\s().-]?)?(?:\d[\s().-]?){8}(?!\d)/,
      /\b(?:c[eé]dula(?:\s+de\s+identidad)?|n[uú]mero de identidad|pasaporte)\b\s*(?:(?:es|n[uú]mero|no\.?|#)\s*)?(?::|=)?\s*[A-Z]?\d[\d -]{5,}\b/i,
      /\b(?:tarjeta de cr[eé]dito|n[uú]mero de tarjeta|datos de tarjeta)\b.{0,20}(?:\d[ -]?){12,19}/i,
      /\b(?:cuenta bancaria|n[uú]mero de cuenta|cuenta)\b.{0,20}(?:\d[ -]?){7,20}/i,
      /\b(?:cvv|c[oó]digo de seguridad)\b\s*(?::|=)?\s*\d{3,4}\b/i,
      /\bcontrase[nñ]a\b\s*(?::|=)\s*\S{4,}/i,
      /\b(?:mi direcci[oó]n|mi domicilio|ubicaci[oó]n exacta|vivo en|mi casa queda)\b\s*(?:es|:)?\s*[^,.!?]{4,}/i
    ];
    return patterns.some(pattern => pattern.test(String(text || "")));
  }
  async function api(action, payload = {}, useAdminAuth = false) {
    const body = { action, ...payload };
    if (sessionToken && !Object.prototype.hasOwnProperty.call(payload, "session_token")) body.session_token = sessionToken;
    const headers = { "Content-Type": "application/json" };
    if (useAdminAuth && payload.access_token) headers.Authorization = "Bearer " + payload.access_token;
    const response = await fetch(endpoint, { method: "POST", headers, cache: "no-store", body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "No se pudo completar la solicitud.");
    return data;
  }
  function storeSession(token, id) {
    sessionToken = String(token || "");
    conversationId = String(id || "");
    try {
      sessionStorage.setItem(sessionKey, sessionToken);
      sessionStorage.setItem(conversationKey, conversationId);
    } catch {}
  }
  function clearSession() {
    sessionToken = "";
    conversationId = "";
    try {
      sessionStorage.removeItem(sessionKey);
      sessionStorage.removeItem(conversationKey);
    } catch {}
  }
  function loadSession() {
    try {
      sessionToken = sessionStorage.getItem(sessionKey) || "";
      conversationId = sessionStorage.getItem(conversationKey) || "";
    } catch {}
  }
  function showContext(data) {
    const context = $("#chat-product-context");
    const isProduct = data && data.product_name && data.product_name !== "Consulta general";
    context.hidden = !isProduct;
    $("#chat-product-name").textContent = isProduct ? data.product_name : "Consulta general";
    $("#chat-payment-topic").textContent = topicLabel(data?.payment_topic);
    const catalog = data?.catalog_type === "perfumery" ? "JB Parfums" : data?.catalog_type === "technology" ? "JB TECH" : "JB Collections";
    $("#chat-title").textContent = isProduct ? "Consultá por " + data.product_name : "Hablemos con JB Collections";
    $("#chat-subtitle").textContent = catalog + " · Mensajería privada";
  }
  function setScreen(screen) {
    consentScreen.hidden = screen !== "consent";
    declinedScreen.hidden = screen !== "declined";
    conversationScreen.hidden = screen !== "conversation";
  }
  function formatTime(value) {
    try { return new Date(value).toLocaleTimeString("es-NI", { hour: "2-digit", minute: "2-digit" }); }
    catch { return ""; }
  }
  function renderMessages(rows) {
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      if (lastRenderedMessageIds.has(row.id)) continue;
      lastRenderedMessageIds.add(row.id);
      const bubble = document.createElement("div");
      bubble.className = "chat-message " + (row.sender_type === "customer" ? "is-customer" : row.sender_type === "advisor" ? "is-advisor" : "is-assistant");
      const content = document.createElement("span");
      content.textContent = row.content || "";
      bubble.appendChild(content);
      const time = document.createElement("time");
      time.dateTime = row.created_at || "";
      time.textContent = formatTime(row.created_at);
      bubble.appendChild(time);
      messagesNode.appendChild(bubble);
    }
    if (rows.length) messagesNode.scrollTop = messagesNode.scrollHeight;
  }
  function setConversationState(data) {
    conversation = data;
    const status = data.status;
    const stateNode = $("#chat-conversation-state");
    const banner = $("#chat-conversation-banner");
    if (status === "advisor_active") {
      stateNode.textContent = "Un asesor tomó tu conversación. Podés escribirle por aquí.";
      banner.classList.add("is-active");
    } else {
      stateNode.textContent = "Tu consulta quedó en la fila de atención. Un asesor responderá aquí cuando la tome.";
      banner.classList.remove("is-active");
    }
  }
  function startCountdown(deleteAfter) {
    if (!deleteAfter) return;
    if (countdownTarget === deleteAfter && countdownHandle) return;
    if (countdownHandle) clearInterval(countdownHandle);
    countdownTarget = deleteAfter;
    const tick = () => {
      const remaining = Math.max(0, new Date(deleteAfter).getTime() - Date.now());
      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      $("#chat-countdown").textContent = String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
      if (!remaining) {
        clearInterval(countdownHandle);
        clearSession();
        $("#chat-change-mind-button").disabled = true;
        showStatus("El periodo para cambiar de opinión terminó. El chat se eliminará automáticamente.", false);
      }
    };
    tick();
    countdownHandle = setInterval(tick, 1000);
  }
  function renderState(data, rows) {
    setConversationState(data);
    if (data.status === "pending_consent") {
      setScreen("consent");
    } else if (data.status === "declined_pending_delete") {
      setScreen("declined");
      startCountdown(data.delete_after);
    } else if (data.status === "closed") {
      setScreen("declined");
      $("#chat-declined-screen h2").textContent = "Esta conversación está cerrada";
      $("#chat-declined-screen p").textContent = "Esta conversación ya no recibe mensajes. Volvé al catálogo para iniciar una consulta nueva.";
      $("#chat-countdown").hidden = true;
      $("#chat-change-mind-button").hidden = true;
      clearSession();
    } else {
      setScreen("conversation");
      if (!polling) {
        polling = true;
        pollMessages();
      }
      renderMessages(rows);
    }
  }
  async function refresh() {
    if (!sessionToken || inFlight) return;
    inFlight = true;
    try {
      const result = await api("read");
      setConversationState(result.conversation);
      if (result.conversation.status === "declined_pending_delete") {
        setScreen("declined");
        startCountdown(result.conversation.delete_after);
      } else if (result.conversation.status === "pending_consent") {
        setScreen("consent");
      } else if (result.conversation.status === "closed") {
        renderState(result.conversation, []);
      } else {
        setScreen("conversation");
        if (!polling) polling = true;
        renderMessages(result.messages);
      }
    } catch (error) {
      if (/venci[oó]|ya no está disponible|sesión/i.test(error.message || "")) {
        clearSession();
        showStatus("Tu enlace temporal ya no está activo. Volvé al catálogo para iniciar una nueva conversación.", true);
        setScreen("consent");
      } else showStatus(error.message || "No se pudo actualizar el chat.", true);
    } finally {
      inFlight = false;
    }
  }
  async function pollMessages() {
    if (!sessionToken) { polling = false; return; }
    await refresh();
    if (sessionToken) window.setTimeout(pollMessages, 3500);
    else polling = false;
  }
  async function acceptConsent() {
    acceptButton.disabled = true;
    declineButton.disabled = true;
    showStatus("");
    try {
      if (sessionToken) {
        const result = await api("consent", { consent_notice_version: noticeVersion });
        conversation = result.conversation;
        lastRenderedMessageIds.clear();
        messagesNode.replaceChildren();
        renderState(result.conversation, result.messages);
      } else {
        const result = await api("start", contextFromUrl());
        storeSession(result.session_token, result.conversation.id);
        showContext(result.conversation);
        lastRenderedMessageIds.clear();
        messagesNode.replaceChildren();
        renderState(result.conversation, result.messages || []);
        history.replaceState({}, "", window.location.pathname);
      }
    } catch (error) {
      showStatus(error.message || "No se pudo abrir el chat. Probá nuevamente o elegí WhatsApp.", true);
    } finally {
      acceptButton.disabled = false;
      declineButton.disabled = false;
    }
  }
  async function declineConsent() {
    acceptButton.disabled = true;
    declineButton.disabled = true;
    showStatus("");
    try {
      let result;
      if (sessionToken) result = await api("decline");
      else result = await api("decline_start", contextFromUrl());
      if (result.session_token) storeSession(result.session_token, result.conversation.id);
      else if (result.conversation) conversationId = result.conversation.id;
      if (result.conversation) {
        conversation = result.conversation;
        setScreen("declined");
        startCountdown(result.delete_after || result.conversation.delete_after);
        history.replaceState({}, "", window.location.pathname);
      }
    } catch (error) {
      showStatus(error.message || "No se pudo registrar tu elección. Cerrá esta pestaña para salir.", true);
    } finally {
      acceptButton.disabled = false;
      declineButton.disabled = false;
    }
  }
  async function changeMind() {
    const button = $("#chat-change-mind-button");
    button.disabled = true;
    try {
      const result = await api("change_mind");
      if (countdownHandle) clearInterval(countdownHandle);
      lastRenderedMessageIds.clear();
      messagesNode.replaceChildren();
      renderState(result.conversation, result.messages);
      showStatus("");
    } catch (error) {
      showStatus(error.message || "Ya no se puede reactivar esta conversación.", true);
      button.disabled = false;
    }
  }
  async function sendMessage(event) {
    event.preventDefault();
    const content = String(input.value || "").trim();
    if (!content) return;
    if (cleanPersonalData(content)) {
      showStatus("No enviés teléfono, correo, dirección, cédula ni datos de pago por este chat. Para comprar, te explicaremos aparte el registro oficial del proveedor.", true);
      return;
    }
    sendButton.disabled = true;
    input.disabled = true;
    showStatus("");
    try {
      await api("send", { content });
      input.value = "";
      await refresh();
    } catch (error) {
      showStatus(error.message || "No se pudo enviar el mensaje.", true);
    } finally {
      sendButton.disabled = false;
      input.disabled = false;
      input.focus();
    }
  }
  async function init() {
    const paramsContext = contextFromUrl();
    showContext(paramsContext);
    $("#chat-back-link").href = paramsContext.catalog_type === "perfumery" ? "../perfumeria/" : paramsContext.catalog_type === "technology" ? "../tecnologia/" : "../";
    loadSession();

    const invite = query.get("invite");
    if (invite) {
      showStatus("Validando tu enlace temporal…");
      try {
        const result = await api("redeem", { invite_token: invite });
        storeSession(result.session_token, result.conversation.id);
        conversation = result.conversation;
        showContext(result.conversation);
        history.replaceState({}, "", window.location.pathname);
        showStatus("");
        renderState(result.conversation, result.messages || []);
      } catch (error) {
        showStatus(error.message || "Este enlace ya venció o fue utilizado. Solicitá uno nuevo.", true);
      }
      return;
    }
    const hasNewProductContext = query.has("catalog_type") || query.has("product_name") || query.has("payment_topic");
    if (hasNewProductContext) clearSession();
    if (sessionToken && conversationId) {
      const result = await api("read").catch(() => null);
      if (result?.conversation) {
        showContext(result.conversation);
        renderState(result.conversation, result.messages || []);
      } else {
        clearSession();
        setScreen("consent");
      }
      return;
    }
    setScreen("consent");
  }

  acceptButton.addEventListener("click", acceptConsent);
  declineButton.addEventListener("click", declineConsent);
  $("#chat-change-mind-button").addEventListener("click", changeMind);
  $("#chat-message-form").addEventListener("submit", sendMessage);

  init();
})();
