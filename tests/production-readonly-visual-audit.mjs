import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { analyzeImageOccupancy } from "./visual-image-quality-policy.mjs";

const BASE_URL = new URL(process.env.VISUAL_AUDIT_BASE_URL || "https://jb-collections.pages.dev");
const OUT_DIR = resolve("artifacts/production-visual-audit");
const VIEWPORTS = [
  { name: "mobile-390", width: 390, height: 844, mobile: true, auditDetails: true },
  { name: "desktop-1365", width: 1365, height: 900, mobile: false, auditDetails: true },
  { name: "desktop-1920", width: 1920, height: 1080, mobile: false, auditDetails: false },
  { name: "desktop-2560", width: 2560, height: 1440, mobile: false, auditDetails: true },
  { name: "ultrawide-3440", width: 3440, height: 1440, mobile: false, auditDetails: false },
];
const THEMES = ["light", "dark"];
const PAGES = [
  { name: "home", path: "/", products: null },
  { name: "technology", path: "/tecnologia/", products: ".product-view-button:visible", detail: "#product-detail-page:not(.hidden)", image: ".dialog-main-image", query: "producto" },
  { name: "perfumery", path: "/perfumeria/", products: ".perfume-view-button:visible", detail: "#perfume-detail-page:not(.hidden)", image: "#perfume-dialog-main-image", query: "fragancia" },
];
const results = [];
const blockedWrites = [];
const errors = [];
const browser = await chromium.launch({ headless: true });
await mkdir(OUT_DIR, { recursive: true });

function absolute(path) {
  return new URL(path, BASE_URL).href;
}

async function auditImage(page, selector) {
  return page.evaluate(async ({ selector }) => {
    const original = document.querySelector(selector);
    if (!original) return { status: "unavailable", reason: "image-element-not-found" };
    const source = original.currentSrc || original.src;
    const rect = original.getBoundingClientRect();
    const geometry = {
      elementWidth: Math.round(rect.width), elementHeight: Math.round(rect.height),
      naturalWidth: original.naturalWidth || 0, naturalHeight: original.naturalHeight || 0,
      source,
      objectFit: getComputedStyle(original).objectFit,
    };
    if (!source || !(original.naturalWidth > 0)) {
      return { status: "unavailable", reason: "original-image-not-loaded", geometry };
    }
    try {
      // A fresh anonymous-CORS image gives the browser an honest chance to allow canvas reads.
      const probe = new Image();
      probe.crossOrigin = "anonymous";
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("image-probe-timeout")), 5000);
        probe.onload = () => { clearTimeout(timeout); resolve(); };
        probe.onerror = () => { clearTimeout(timeout); reject(new Error("image-probe-load-failed")); };
        probe.src = source;
      });
      const scale = Math.min(1, 240 / Math.max(probe.naturalWidth, probe.naturalHeight));
      const width = Math.max(1, Math.round(probe.naturalWidth * scale));
      const height = Math.max(1, Math.round(probe.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("canvas-context-unavailable");
      context.drawImage(probe, 0, 0, width, height);
      const data = context.getImageData(0, 0, width, height).data;
      const corners = [[1,1],[width-2,1],[1,height-2],[width-2,height-2]].map(([x,y]) => {
        const i = (Math.max(0,y)*width+Math.max(0,x))*4;
        return [data[i],data[i+1],data[i+2]];
      });
      const background = [0,1,2].map(c => corners.reduce((sum,p)=>sum+p[c],0)/corners.length);
      const spread = Math.max(...corners.map(p => Math.sqrt(p.reduce((sum,v,c)=>sum+(v-background[c])**2,0))));
      let minX=width,minY=height,maxX=-1,maxY=-1,count=0;
      for(let y=0;y<height;y+=1) for(let x=0;x<width;x+=1) {
        const i=(y*width+x)*4, alpha=data[i+3]/255;
        const distance=Math.sqrt((data[i]-background[0])**2+(data[i+1]-background[1])**2+(data[i+2]-background[2])**2);
        if(alpha>0.12 && distance>=48) {
          count+=1; minX=Math.min(minX,x); minY=Math.min(minY,y);
          maxX=Math.max(maxX,x); maxY=Math.max(maxY,y);
        }
      }
      if(count<8 || maxX<minX || maxY<minY) {
        return {status:"inconclusive",reason:"no-distinct-subject-detected",confidence:0.2,cornerSpread:spread,geometry};
      }
      const boxWidth=maxX-minX+1, boxHeight=maxY-minY+1;
      return {
        status:"measured",
        confidence:spread<=42?0.9:spread<=100?0.58:0.35,
        imageWidth:probe.naturalWidth,imageHeight:probe.naturalHeight,
        foregroundWidthRatio:boxWidth/width,foregroundHeightRatio:boxHeight/height,
        foregroundAreaRatio:(boxWidth*boxHeight)/(width*height),
        foregroundPixelRatio:count/(width*height),
        cornerSpread:Math.round(spread),
        method:"corner-background color-distance bounding-box heuristic",
        geometry
      };
    } catch(error) {
      const reason = /taint|origin|cross-origin|security/i.test(error?.message||"")
        ? "canvas-cross-origin"
        : (error?.message || "image-analysis-failed");
      return {status:"unavailable",reason,geometry};
    }
  }, { selector });
}

async function loadLazyImages(page) {
  return page.evaluate(async () => {
    const images = Array.from(document.images);
    const lazyImages = images.filter(image => image.loading === "lazy");
    for (const image of lazyImages) image.loading = "eager";

    const documentHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    const step = Math.max(320, Math.round(innerHeight * 0.85));
    for (let y = 0; y < documentHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise(resolve => setTimeout(resolve, 35));
    }
    window.scrollTo(0, 0);

    const settle = Promise.allSettled(images.map(image => {
      if (image.complete) return image.decode?.().catch(() => undefined);
      return new Promise(resolve => {
        const finish = () => resolve();
        image.addEventListener("load", finish, { once: true });
        image.addEventListener("error", finish, { once: true });
      });
    }));
    await Promise.race([settle, new Promise(resolve => setTimeout(resolve, 3500))]);
    return {
      total: images.length,
      lazyPromoted: lazyImages.length,
      loaded: images.filter(image => image.complete && image.naturalWidth > 0).length,
      failed: images.filter(image => image.complete && image.naturalWidth === 0).length,
      pending: images.filter(image => !image.complete).length,
    };
  });
}

try {
  for (const site of PAGES) {
    for (const viewport of VIEWPORTS) {
      for (const theme of THEMES) {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          isMobile: viewport.mobile,
          deviceScaleFactor: 1,
        });
        await context.addInitScript(value => {
          try { localStorage.setItem("ct-catalog-theme", value); } catch {}
        }, theme);
        const page = await context.newPage();
        const scenarioErrors = [];
        page.on("pageerror", error => scenarioErrors.push({ type: "pageerror", message: error.message, stack: error.stack || "" }));
        page.on("requestfailed", request => {
          const failure = request.failure()?.errorText || "unknown";
          // A write aborted by the read-only guard is expected, not an application failure.
          if (/ERR_BLOCKED_BY_CLIENT/i.test(failure) && !["GET", "HEAD", "OPTIONS"].includes(request.method().toUpperCase())) return;
          if (!/ERR_ABORTED/i.test(failure)) scenarioErrors.push({ type: "requestfailed", url: request.url(), method: request.method(), message: failure });
        });
        await page.route("**/*", async route => {
          const request = route.request();
          if (!["GET", "HEAD", "OPTIONS"].includes(request.method().toUpperCase())) {
            const entry = { page: site.name, method: request.method(), url: request.url() };
            blockedWrites.push(entry);
            await route.abort("blockedbyclient");
            return;
          }
          await route.continue();
        });

        const url = absolute(site.path);
        const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(error => {
          errors.push({ severity: "critical", page: site.name, viewport: viewport.name, theme, type: "navigation", message: error.message, url });
          return null;
        });
        if (!response?.ok()) {
          errors.push({ severity: "critical", page: site.name, viewport: viewport.name, theme, type: "http", status: response?.status() ?? null, url });
          await page.close();
          await context.close();
          continue;
        }

        await page.waitForTimeout(1200);
        if (site.products) {
          await page.locator(site.products).first().waitFor({ state: "visible", timeout: 7000 }).catch(() => {});
        }
        const imageLoadStats = await loadLazyImages(page);
        const actualTheme = await page.locator("html").getAttribute("data-theme");
        if (site.products && actualTheme !== theme) errors.push({ severity: "high", page: site.name, viewport: viewport.name, theme, type: "theme-not-applied", message: "El tema solicitado no quedó aplicado al documento.", evidence: "esperado=" + theme + "; observado=" + String(actualTheme) });
        const snapshot = await page.evaluate(() => {
          const visible = el => {
            const style=getComputedStyle(el), rect=el.getBoundingClientRect();
            return style.display!=="none" && style.visibility!=="hidden" && rect.width>0 && rect.height>0;
          };
          const root=document.documentElement, body=document.body;
          const width=Math.max(root.scrollWidth,body.scrollWidth), viewportWidth=innerWidth;
          const cards=[...document.querySelectorAll(".product-card")].filter(visible);
          const imgs=cards.flatMap(card=>[...card.querySelectorAll("img")]).map(img => ({
            alt:img.alt||"",src:img.currentSrc||img.src,loaded:img.complete&&img.naturalWidth>0,
            naturalWidth:img.naturalWidth||0,naturalHeight:img.naturalHeight||0,
            renderedWidth:Math.round(img.getBoundingClientRect().width),renderedHeight:Math.round(img.getBoundingClientRect().height),
          }));
          const contentRoot = [...document.querySelectorAll(".catalog-section, .perfume-catalog-section, #catalog-section, .perfume-category-section")].find(visible)
            || document.querySelector("main") || body;
          const contentRect = contentRoot.getBoundingClientRect();
          const contentWidth = Math.round(contentRect.width);
          const grid = [...document.querySelectorAll("#product-grid, #featured-grid, .perfume-page .product-grid, .perfume-page .featured-grid")].find(visible);
          const gridRect = grid?.getBoundingClientRect();
          const gridStyle = grid ? getComputedStyle(grid) : null;
          const gridColumns = gridStyle ? gridStyle.gridTemplateColumns.split(/\\s+/).filter(Boolean).length : 0;
          const firstCard = grid?.querySelector(".product-card");
          const cardWidth = firstCard ? Math.round(firstCard.getBoundingClientRect().width) : null;
          const contentMetrics = {
            selector: contentRoot.id ? "#" + contentRoot.id : contentRoot.className || contentRoot.tagName.toLowerCase(),
            width: contentWidth,
            left: Math.round(contentRect.left),
            viewportUtilizationPct: viewportWidth > 0 ? Math.round(contentWidth / viewportWidth * 100) : null,
            gridWidth: gridRect ? Math.round(gridRect.width) : null,
            gridColumns,
            cardWidth,
          };
          const regions=[...document.querySelectorAll("main > section, main > div")].filter(visible).map(el=>{
            const r=el.getBoundingClientRect(), text=(el.innerText||"").replace(/\s+/g," ").trim();
            return {selector:el.id?"#"+el.id:el.tagName.toLowerCase()+"."+String(el.className||"").trim().split(/\s+/).slice(0,2).join("."),top:Math.round(r.top+scrollY),bottom:Math.round(r.bottom+scrollY),height:Math.round(r.height),textLength:text.length};
          }).sort((a,b)=>a.top-b.top);
          const gaps=[];
          for(let i=1;i<regions.length;i++){
            const gap=regions[i].top-regions[i-1].bottom;
            if(gap>=160 && regions[i].textLength>=24 && regions[i-1].textLength>=24) gaps.push({gap,from:regions[i-1].selector,to:regions[i].selector});
          }
          return {
            url:location.href,title:document.title,documentWidth:width,viewportWidth,
            horizontalOverflow:Math.max(0,width-viewportWidth),
            theme:root.getAttribute("data-theme"),heading:document.querySelector("h1")?.innerText?.trim()||null,
            visibleProductCards:cards.length,productImages:imgs,contentMetrics,
            brokenProductImages:imgs.filter(image=>!image.loaded).length,
            longBlankGaps:gaps,documentHeight:Math.max(root.scrollHeight,body.scrollHeight),
          };
        });

        if (snapshot.horizontalOverflow >= 24) {
          errors.push({ severity:"critical",page:site.name,viewport:viewport.name,theme,type:"horizontal-overflow",message:"La página excede el ancho del viewport.",evidence:snapshot.horizontalOverflow+" px" });
        } else if (snapshot.horizontalOverflow >= 8) {
          errors.push({ severity:"high",page:site.name,viewport:viewport.name,theme,type:"horizontal-overflow",message:"Desbordamiento horizontal moderado.",evidence:snapshot.horizontalOverflow+" px" });
        }
        for (const err of scenarioErrors) {
          errors.push({severity:err.type==="pageerror"?"critical":"medium",page:site.name,viewport:viewport.name,theme,...err});
        }
        if (site.products && snapshot.visibleProductCards===0) {
          errors.push({severity:"high",page:site.name,viewport:viewport.name,theme,type:"no-public-products",message:"No se detectaron tarjetas de producto visibles en el catálogo publicado."});
        }
        const shot = site.name+"--"+viewport.name+"--"+theme+".png";
        await page.screenshot({path:resolve(OUT_DIR,shot),fullPage:true,animations:"disabled"});
        const record = {page:site.name,viewport:viewport.name,theme,screenshot:shot,snapshot,imageLoadStats,scenarioErrors};
        results.push(record);

        // On actual published catalogs, open a real public product once per mobile/desktop theme.
        // All non-read HTTP requests remain intercepted, so view telemetry cannot write to the database.
        if (site.products && viewport.auditDetails) {
          const link = page.locator(site.products).first();
          let count = 0;
          try { await link.waitFor({state:"visible",timeout:4500}); count = await page.locator(site.products).count(); } catch {}
          if (count > 0) {
            await link.click({timeout:5000});
            let detailOpened = false;
            try {
              await page.locator(site.detail).waitFor({state:"visible",timeout:6000});
              detailOpened = true;
            } catch {}
            if (!detailOpened) {
              errors.push({severity:"critical",page:site.name,viewport:viewport.name,theme,type:"real-product-detail-failed",message:"Había productos públicos, pero el primer enlace Ver producto no abrió la ficha real."});
            } else {
              await page.waitForTimeout(500);
              const detailImageLoadStats = await loadLazyImages(page);
              const imageAudit = await auditImage(page,site.image);
              const detailSnapshot=await page.evaluate(()=>{
                const root=document.documentElement,body=document.body;
                const img=document.querySelector(".dialog-main-image, #perfume-dialog-main-image");
                const r=img?.getBoundingClientRect();
                return {
                  url:location.href,theme:root.getAttribute("data-theme"),
                  horizontalOverflow:Math.max(0,root.scrollWidth-body.clientWidth),
                  detailHeading:document.querySelector("#product-detail-page h1,#perfume-detail-page h1,#product-detail-page h2,#perfume-detail-page h2")?.innerText?.trim()||null,
                  imageElement:img?{source:img.currentSrc||img.src,loaded:img.complete&&img.naturalWidth>0,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,renderedWidth:Math.round(r.width),renderedHeight:Math.round(r.height),objectFit:getComputedStyle(img).objectFit}:null,
                  gallery:document.querySelector("#dialog-image,.perfume-dialog-gallery")?.getBoundingClientRect().toJSON()||null,
                };
              });
              const imageFindings=analyzeImageOccupancy([{visible:true,selector:site.image,productName:detailSnapshot.detailHeading,imageOccupancy:imageAudit}],{viewportWidth:viewport.width,mobile:viewport.mobile});
              const detailName=site.name+"-detail--"+viewport.name+"--"+theme+".png";
              const viewportDetailName=detailName.replace(".png","--viewport.png");
              await page.screenshot({path:resolve(OUT_DIR,detailName),fullPage:true,animations:"disabled"});
              await page.screenshot({path:resolve(OUT_DIR,viewportDetailName),fullPage:false,animations:"disabled"});
              results.push({page:site.name+"-detail",viewport:viewport.name,theme,screenshot:detailName,viewportScreenshot:viewportDetailName,snapshot:detailSnapshot,imageLoadStats:detailImageLoadStats,imageOccupancy:imageAudit,imageFindings});
              if (detailSnapshot.horizontalOverflow>=24) errors.push({severity:"critical",page:site.name+"-detail",viewport:viewport.name,theme,type:"detail-horizontal-overflow",message:"La ficha real excede el viewport.",evidence:detailSnapshot.horizontalOverflow+" px"});
              if (imageAudit.status==="unavailable"||imageAudit.status==="inconclusive") {
                errors.push({severity:"info",page:site.name+"-detail",viewport:viewport.name,theme,type:"image-analysis-inconclusive",message:"No fue posible medir la ocupación de píxeles de la fotografía real; no se contará como aprobado.",evidence:imageAudit.reason||"sin causa"});
              }
              for (const finding of imageFindings) errors.push({...finding,page:site.name+"-detail",viewport:viewport.name,theme});
            }
          }
        }
        await page.close();
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}

const blocking = errors.filter(item => item.severity==="critical");
const report = {
  generatedAt:new Date().toISOString(),
  mode:"production-read-only",
  baseUrl:BASE_URL.origin,
  summary:{
    scenarios:results.length,
    screenshots:results.length,
    blockingFindings:blocking.length,
    findings:errors.length,
    imageOccupancyMeasured:results.filter(item=>item.imageOccupancy?.status==="measured").length,
    imageOccupancyUnavailable:results.filter(item=>["unavailable","inconclusive"].includes(item.imageOccupancy?.status)).length,
    blockedWriteRequests:blockedWrites.length,
    note:"Public pages only. All non-GET/HEAD/OPTIONS HTTP requests are intercepted; no sign-in, order submission, messaging send, or database mutation is performed."
  },
  results,findings:errors,blockedWrites
};
await writeFile(resolve(OUT_DIR,"production-visual-audit-report.json"),JSON.stringify(report,null,2),"utf8");
const markdown=[
  "# JB Collections — production visual audit (read-only)","",
  "- URL: "+BASE_URL.origin,
  "- Generated: "+report.generatedAt,
  "- Scenario captures: "+results.length,
  "- Blocking findings: "+blocking.length,
  "- All findings (including warnings/inconclusive): "+errors.length,
  "- Real photos measured: "+report.summary.imageOccupancyMeasured,
  "- Real photos inconclusive/unavailable: "+report.summary.imageOccupancyUnavailable,
  "- Non-read HTTP requests blocked: "+blockedWrites.length,
  "",
  "## Findings","",
  ...(errors.length?errors.map((item,i)=>(i+1)+". **["+String(item.severity||"info").toUpperCase()+"] "+(item.page||"page")+" / "+(item.type||item.code||"finding")+"** — "+(item.message||item.evidence||"No description")+(item.evidence?"; evidence: "+item.evidence:"")):["No findings recorded."]),
  "",
  "## Scenarios","",
  ...results.map(item=>"- "+item.page+" / "+item.viewport+" / "+item.theme+" — screenshot: "+item.screenshot+(item.snapshot?.visibleProductCards!==undefined?"; product cards: "+item.snapshot.visibleProductCards:"")+(item.imageOccupancy?"; image occupancy: "+item.imageOccupancy.status+(item.imageOccupancy.reason?" ("+item.imageOccupancy.reason+")":""):"")),
  "",
  "## Interpretation",
  "- This audit sees the deployed site with public data; it is separate from deterministic local fixtures.",
  "- Pixel occupancy uses corner-color contrast, not semantic object recognition. Complex photos can be inconclusive and must not be reported as passed.",
  "- Non-GET/HEAD/OPTIONS requests are blocked to prevent analytics or controls from writing while the audit runs.",
].join("\n");
await writeFile(resolve(OUT_DIR,"production-visual-audit-report.md"),markdown,"utf8");
console.log(JSON.stringify(report.summary,null,2));
console.log("Report: artifacts/production-visual-audit/production-visual-audit-report.md");
if (blocking.length) process.exitCode=1;
