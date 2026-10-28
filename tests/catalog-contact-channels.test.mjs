import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const perfume = readFileSync(new URL("../perfumeria.js", import.meta.url), "utf8");
const assistant = readFileSync(new URL("../ai-assistant.js", import.meta.url), "utf8");
const channelCss = readFileSync(new URL("../contact-channels.css", import.meta.url), "utf8");
const technologyHtml = readFileSync(new URL("../tecnologia/index.html", import.meta.url), "utf8");
const perfumeryHtml = readFileSync(new URL("../perfumeria/index.html", import.meta.url), "utf8");

test("technology product dialog offers WhatsApp and JB Collections as separate contact channels", () => {
  assert.ok(app.includes('id="dialog-buy-link"'));
  assert.ok(app.includes('id="dialog-jb-contact"'));
  assert.ok(app.includes("function startPrivateChatFromTechnology"));
  assert.ok(app.includes('action: "start"'));
  assert.ok(app.includes('window.location.assign(data.inviteUrl)'));
  assert.ok(app.includes("function buildAIProductPrompt"));
});

test("technology payment selector asks for the topic before revealing both channels", () => {
  assert.ok(app.includes('id="dialog-payment-type"'));
  assert.ok(app.includes('<option value="financing">Financiamiento</option>'));
  assert.ok(app.includes('<option value="credit_card">Compra con tarjeta de crédito</option>'));
  assert.ok(app.includes('id="dialog-payment-channel-panel" class="payment-channel-panel" hidden'));
  assert.ok(app.includes('id="dialog-payment-whatsapp"'));
  assert.ok(app.includes('id="dialog-payment-jb"'));
  assert.ok(app.includes("function refreshPaymentChannelChoices"));
  assert.ok(app.includes("buildPaymentWhatsAppMessage(product, variant, paymentType)"));
});

test("perfumery product dialog provides the same two channels and payment-topic flow", () => {
  assert.ok(perfume.includes('id="perfume-buy-link"'));
  assert.ok(perfume.includes('id="perfume-jb-contact"'));
  assert.ok(perfume.includes('id="perfume-payment-type"'));
  assert.ok(perfume.includes('id="perfume-payment-whatsapp"'));
  assert.ok(perfume.includes('id="perfume-payment-jb"'));
  assert.ok(perfume.includes("function refreshPerfumePaymentChoices"));
  assert.ok(perfume.includes("const whatsappIconMarkup ="));
  assert.ok(perfume.includes("const chatIconMarkup ="));
});

test("JB Collections channel opens a real temporary chat and keeps AI context concise", () => {
  assert.ok(app.includes("window.location.assign(data.inviteUrl)"));
  assert.ok(app.includes("function buildAIProductPrompt"));
  const promptStart = app.indexOf("function buildAIProductPrompt");
  const promptEnd = app.indexOf("\n}", promptStart) + 2;
  const prompt = app.slice(promptStart, promptEnd);
  assert.doesNotMatch(prompt, /productShareLink|Enlace del producto|Usá solo información publicada|No inventes tasas/);
  assert.ok(perfume.includes('action: "start"'));
  assert.ok(perfume.includes('catalogType: "perfumery"'));
  assert.ok(!perfume.includes("buildPerfumeAIPrompt"));
  assert.ok(assistant.includes("window.openJBAiAdvisor = message =>"));
  assert.ok(assistant.includes("window.openJBAiAdvisor(event.detail && event.detail.message)"));
});

test("AI advisor can hand a customer off to the secure private inbox with a concise context label", () => {
  assert.match(assistant, /jb-ai-private-chat/);
  assert.match(assistant, /openPrivateChatFromAdvisor/);
  assert.match(assistant, /action: "start"/);
  assert.match(assistant, /window\.location\.assign\(data\.inviteUrl\)/);
  assert.match(assistant, /Consulta IA · /);
  assert.doesNotMatch(assistant, /productUrl: window\.location\.href/);
  const assistantCss = readFileSync(new URL("../ai-assistant.css", import.meta.url), "utf8");
  assert.match(assistantCss, /jb-ai-footer-actions/);
});

test("contact channel controls are responsive, keyboard-focusable and styled consistently across catalogs", () => {
  assert.ok(channelCss.includes(".product-contact-channel-actions"));
  assert.ok(channelCss.includes(".payment-channel-actions"));
  assert.ok(channelCss.includes(":focus-visible"));
  assert.ok(channelCss.includes("@media (max-width: 560px)"));
  assert.ok(technologyHtml.includes("contact-channels.css?v=20261028-dual-contact1"));
  assert.ok(perfumeryHtml.includes("contact-channels.css?v=20261028-dual-contact1"));
  assert.ok(technologyHtml.includes("app.js?v=20261028-ai-chat-escalation2"));
  assert.ok(perfumeryHtml.includes("perfumeria.js?v=20261028-private-chat1"));
});
