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
  assert.match(app, /id="dialog-buy-link"[^>]*contact-channel-button--whatsapp/);
  assert.match(app, /id="dialog-jb-contact"[^>]*contact-channel-button--jb/);
  assert.match(app, /window.openJBAiAdvisor(message)/);
  assert.match(app, /function buildAIProductPrompt/);
});

test("technology payment selector asks for the topic before revealing both channels", () => {
  assert.match(app, /id="dialog-payment-type"/);
  assert.match(app, /option value="financing">Financiamiento/);
  assert.match(app, /option value="credit_card">Compra con tarjeta de crédito/);
  assert.match(app, /id="dialog-payment-channel-panel"[^>]*hidden/);
  assert.match(app, /id="dialog-payment-whatsapp"/);
  assert.match(app, /id="dialog-payment-jb"/);
  assert.match(app, /function refreshPaymentChannelChoices/);
  assert.match(app, /buildPaymentWhatsAppMessage(product, variant, paymentType)/);
});

test("perfumery product dialog provides the same two channels and payment-topic flow", () => {
  assert.match(perfume, /id="perfume-buy-link"[^>]*contact-channel-button--whatsapp/);
  assert.match(perfume, /id="perfume-jb-contact"[^>]*contact-channel-button--jb/);
  assert.match(perfume, /id="perfume-payment-type"/);
  assert.match(perfume, /id="perfume-payment-whatsapp"/);
  assert.match(perfume, /id="perfume-payment-jb"/);
  assert.match(perfume, /function refreshPerfumePaymentChoices/);
  assert.match(perfume, /const whatsappIconMarkup =/);
  assert.match(perfume, /const chatIconMarkup =/);
});

test("JB Collections channel opens the existing AI advisor and supplies contextual product queries", () => {
  assert.match(assistant, /window.openJBAiAdvisor = message =>/);
  assert.match(assistant, /window.openJBAiAdvisor(event.detail && event.detail.message)/);
  assert.match(app, /Usá solo información publicada y confirmada/);
  assert.match(perfume, /Usá solo información publicada y confirmada/);
});

test("contact channel controls are responsive, keyboard-focusable and styled consistently across catalogs", () => {
  assert.match(channelCss, /.product-contact-channel-actions/);
  assert.match(channelCss, /.payment-channel-actions/);
  assert.match(channelCss, /:focus-visible/);
  assert.match(channelCss, /@media (max-width: 560px)/);
  assert.match(technologyHtml, /contact-channels.css?v=20261028-dual-contact1/);
  assert.match(perfumeryHtml, /contact-channels.css?v=20261028-dual-contact1/);
  assert.match(technologyHtml, /app.js?v=20261028-dual-contact1/);
  assert.match(perfumeryHtml, /perfumeria.js?v=20261028-dual-contact1/);
});
