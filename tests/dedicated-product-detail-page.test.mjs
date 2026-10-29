import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { chromium } from "playwright";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const techHtml = read("tecnologia/index.html");
const perfumeHtml = read("perfumeria/index.html");
const techJs = read("app.js");
const perfumeJs = read("perfumeria.js");
const baseCss = read("styles.css");
const themeCss = read("theme-ui.css");
const brandCss = read("brand-refresh.css");
const darkCss = read("dark-theme-redesign.css");
const performanceCss = read("catalog-performance.css");
const techCss = read("technology-visual-refresh.css");
const perfumeCss = read("perfumeria.css");

test("technology and perfumery detail URLs behave as same-tab page routes and preserve catalog state", () => {
  assert.match(techHtml, /technology-visual-refresh\.css\?v=20261029-dedicated-product-page1/);
  assert.match(perfumeHtml, /perfumeria\.css\?v=20261029-dedicated-product-page1/);
  assert.match(techJs, /searchParams\.set\("producto", String\(product\.id\)\)/);
  assert.match(perfumeJs, /searchParams\.set\("fragancia", String\(product\.id\)\)/);
  assert.match(techJs, /productDetailRoute: true, catalogScrollY: scrollY, productId: String\(product\.id\)/);
  assert.match(perfumeJs, /productDetailRoute: true, catalogScrollY: scrollY, productId: String\(product\.id\)/);
  assert.match(techJs, /window\.scrollTo\(\{ top: 0, behavior: "instant" \}\)/);
  assert.match(perfumeJs, /window\.scrollTo\(\{ top: 0, behavior: "instant" \}\)/);
  assert.match(techJs, /window\.history\.back\(\)/);
  assert.match(perfumeJs, /window\.history\.back\(\)/);
  assert.match(techJs, /window\.scrollTo\(\{ top: scrollY, behavior: "instant" \}\)/);
  assert.match(perfumeJs, /window\.scrollTo\(\{ top: scrollY, behavior: "instant" \}\)/);
  assert.doesNotMatch(techJs, /lockCatalogScrollPosition|restoreCatalogScrollPosition|setCatalogDetailOverlayOffset/);
  assert.doesNotMatch(perfumeJs, /lockCatalogScrollPosition|restoreCatalogScrollPosition|setCatalogDetailOverlayOffset/);
  assert.match(brandCss, /main\.is-product-detail-view > :not\(#product-detail-page\)[\s\S]*?main\.is-perfume-detail-view > :not\(#perfume-detail-page\)/);
});

test("both dedicated product pages use natural document scrolling on desktop and mobile", { timeout: 60000 }, async () => {
  const commonCss = [baseCss, themeCss, brandCss, darkCss, performanceCss];
  const techMarkup = '<header class="site-header">' +
      '<button id="product-detail-header-back" class="product-detail-header-back" type="button">←</button>' +
      '<a class="brand tech-header-brand" href="./"><span class="tech-header-name">JB TECH</span></a>' +
      '<button data-theme-toggle class="theme-toggle" type="button">Oscuro</button></header>' +
    '<main class="is-product-detail-view"><section id="product-detail-page" class="product-detail-page">' +
      '<div id="dialog-content"><div class="dialog-layout">' +
        '<div class="dialog-image" id="dialog-image"><div class="dialog-gallery-main"><img class="dialog-main-image" alt="Dispositivo" src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'600\' height=\'900\'%3E%3Crect width=\'600\' height=\'900\' fill=\'%23849ac7\'/%3E%3C/svg%3E"></div><div class="dialog-gallery-thumbs"><button class="dialog-gallery-thumb">1</button><button class="dialog-gallery-thumb">2</button></div></div>' +
        '<div class="dialog-detail"><div class="product-category">Tablets</div><h2>Samsung Galaxy Tab S12 Ultra</h2><div class="variant-option-group"><h3>Configuración</h3><button class="variant-choice">256 GB / 12 GB</button></div><div class="product-price">$1,426</div><div class="dialog-product-description">' +
          Array.from({length:9},(_,i)=>'<p>Descripción técnica '+(i+1)+': pantalla de alta resolución, procesador, almacenamiento, conectividad, batería, cámaras y características del producto para trabajar y entretenerse.</p>').join("") +
        '</div><section class="payment-choice-panel"><label>¿Qué querés consultar?</label><select><option>Seleccioná una opción</option></select></section><ul class="dialog-specs">' +
          Array.from({length:12},(_,i)=>'<li>Especificación de producto '+(i+1)+'</li>').join("") +
        '</ul><div class="product-contact-actions"><button class="contact-channel-button">WhatsApp</button><button class="payment-channel-button">Contactar</button></div></div>' +
      '</div></div></section><section class="hero" id="mock-catalog"><h1>Catálogo que debe ocultarse</h1></section></main><footer class="site-footer">Pie del catálogo</footer>';

  const perfumeMarkup = '<header class="site-header perfume-header">' +
      '<button id="perfume-detail-header-back" class="product-detail-header-back" type="button">←</button>' +
      '<a class="brand perfume-brand" href="./"><img class="perfume-brand-logo" alt="JB Parfums" src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'250\' height=\'70\'%3E%3Crect width=\'250\' height=\'70\' fill=\'%23c8a96a\'/%3E%3C/svg%3E"></a>' +
      '<nav class="perfume-header-nav"><a href="#coleccion">Colección</a></nav><button data-theme-toggle class="theme-toggle" type="button">Oscuro</button></header>' +
    '<main class="is-perfume-detail-view"><section id="perfume-detail-page" class="perfume-detail-page">' +
      '<div id="perfume-dialog-content"><div class="perfume-dialog-layout">' +
        '<section class="perfume-dialog-gallery"><div class="perfume-dialog-main-image" data-inline-gallery><img id="perfume-dialog-main-image" alt="Perfume" src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'600\' height=\'900\'%3E%3Crect width=\'600\' height=\'900\' fill=\'%23171410\'/%3E%3C/svg%3E"></div><div class="perfume-dialog-thumbnails"><button class="perfume-dialog-thumb">1</button></div></section>' +
        '<section class="perfume-dialog-detail"><p class="perfume-kicker">PERFUMERÍA ÁRABE</p><h2>Fragancia de prueba</h2><p class="perfume-dialog-brand">Casa de fragancias</p><div class="perfume-dialog-description">' +
          Array.from({length:9},(_,i)=>'<p>Descripción olfativa '+(i+1)+': un perfil aromático con matices frescos, florales, amaderados y cálidos para una experiencia memorable.</p>').join("") +
        '</div><dl class="perfume-dialog-facts"><div><dt>Concentración</dt><dd>EDP</dd></div><div><dt>Contenido</dt><dd>100 ml</dd></div><div><dt>Disponibilidad</dt><dd>Disponible</dd></div></dl><div class="perfume-dialog-price"><span>Precio</span><strong>US$89</strong></div><div class="perfume-dialog-actions"><button>WhatsApp</button><button>Contactar</button></div><section class="payment-choice-panel"><label>¿Qué querés consultar?</label><select><option>Seleccioná una opción</option></select></section></section>' +
      '</div><div class="perfume-dialog-notes">' +
        Array.from({length:3},(_,i)=>'<section class="perfume-note-group"><h3>Notas '+(i+1)+'</h3><ul><li>Bergamota</li><li>Vainilla</li><li>Madera</li></ul></section>').join("") +
      '</div></div></section><section class="perfume-hero" id="mock-catalog"><h1>Catálogo que debe ocultarse</h1></section></main><footer class="perfume-footer">Pie del catálogo</footer>';

  const cases = [
    {
      name:"JB TECH",
      bodyClass:"technology-catalog product-detail-active",
      css:[...commonCss,techCss].join("\n"),
      markup:techMarkup,
      detail:"#product-detail-page",
      content:"#dialog-content",
      layout:".dialog-layout",
      gallery:"#dialog-image",
      sibling:"#mock-catalog",
      header:".site-header",
      catalogState:"product-detail-active",
    },
    {
      name:"JB Parfums",
      bodyClass:"perfume-page perfume-detail-active",
      css:[...commonCss,perfumeCss].join("\n"),
      markup:perfumeMarkup,
      detail:"#perfume-detail-page",
      content:"#perfume-dialog-content",
      layout:".perfume-dialog-layout",
      gallery:".perfume-dialog-gallery",
      sibling:"#mock-catalog",
      header:".site-header.perfume-header",
      catalogState:"perfume-detail-active",
    },
  ];
  const browser = await chromium.launch({ headless: true });
  try {
    for (const item of cases) {
      for (const viewport of [
        {width:1440,height:900,mobile:false},
        {width:390,height:844,mobile:true},
      ]) {
        const page=await browser.newPage({
          viewport:{width:viewport.width,height:viewport.height},
          isMobile:viewport.mobile,
        });
        const markup='<!doctype html><html lang="es" data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*,*::before,*::after{box-sizing:border-box}body{margin:0}'+item.css+'</style></head><body class="'+item.bodyClass+'">'+item.markup+'</body></html>';
        await page.setContent(markup);
        for (const theme of ["light","dark"]) {
          await page.evaluate(value => { document.documentElement.dataset.theme=value; },theme);
          const before=await page.evaluate(({detail,content,layout,gallery,sibling,header})=>{
            const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return{top:r.top,left:r.left,right:r.right,width:r.width,height:r.height};};
            return {
              detailPosition:getComputedStyle(document.querySelector(detail)).position,
              detailDisplay:getComputedStyle(document.querySelector(detail)).display,
              bodyPosition:getComputedStyle(document.body).position,
              headerPosition:getComputedStyle(document.querySelector(header)).position,
              headerHeight:rect(header).height,
              detailRect:rect(detail),
              contentRect:rect(content),
              columns:getComputedStyle(document.querySelector(layout)).gridTemplateColumns,
              galleryPosition:getComputedStyle(document.querySelector(gallery)).position,
              galleryRect:rect(gallery),
              siblingDisplay:getComputedStyle(document.querySelector(sibling)).display,
              scrollHeight:document.documentElement.scrollHeight,
              clientWidth:document.documentElement.clientWidth,
              scrollWidth:document.documentElement.scrollWidth,
            };
          },item);
          assert.equal(before.detailDisplay,"block",item.name+" detail must render");
          assert.notEqual(before.detailPosition,"fixed",item.name+" detail must be part of normal document flow");
          assert.notEqual(before.bodyPosition,"fixed",item.name+" must not lock the document scroll");
          assert.equal(before.headerPosition,"sticky",item.name+" header remains sticky in page layout");
          assert.equal(before.siblingDisplay,"none",item.name+" catalog sections are hidden while the detail route is active");
          assert.ok(before.detailRect.top>=before.headerHeight-2,item.name+" detail begins beneath its in-flow header");
          assert.ok(before.scrollHeight>viewport.height,item.name+" detail should use document scrolling");
          assert.ok(before.scrollWidth-before.clientWidth<=2,item.name+" must not overflow horizontally");
          assert.equal(before.columns.trim().split(/\s+/).length,viewport.mobile?1:2,item.name+" uses the correct responsive column count");
          if(viewport.mobile){
            assert.notEqual(before.galleryPosition,"sticky",item.name+" mobile gallery stays in normal flow");
          }else{
            assert.equal(before.galleryPosition,"sticky",item.name+" desktop gallery remains visible when details scroll");
          }
          await page.evaluate(()=>window.scrollTo({top:360,behavior:"instant"}));
          const after=await page.evaluate(({gallery,header})=>{
            const image=document.querySelector(gallery).getBoundingClientRect();
            const head=document.querySelector(header).getBoundingClientRect();
            return {scrollY:window.scrollY,imageTop:image.top,headerBottom:head.bottom,position:getComputedStyle(document.querySelector(gallery)).position,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth};
          },item);
          assert.ok(after.scrollY>=200,item.name+" page scroll must move normally");
          assert.ok(after.overflow<=2,item.name+" stays within viewport after scrolling");
          if(!viewport.mobile){
            assert.ok(after.imageTop>=after.headerBottom-2,item.name+" sticky gallery must not slide under the header");
            assert.ok(after.imageTop<=after.headerBottom+34,item.name+" sticky gallery should stay near the page header");
          }
        }
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
});
