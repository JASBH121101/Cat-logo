import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, normalize, join } from "node:path";
import test from "node:test";

const pages = ["index.html", "tecnologia/index.html", "perfumeria/index.html", "admin.html", "perfumeria.html", "mensajes.html"];

function localAssets(htmlPath) {
  const html = readFileSync(htmlPath, "utf8");
  const refs = [...html.matchAll(/(?:href|src)=["']([^"']+\.(?:css|js)(?:\?[^"']*)?)["']/gi)];
  return refs.map(match => {
    const url = match[1];
    if (/^(?:[a-z]+:)?\/\//i.test(url) || /^[a-z]+:/i.test(url) || url.startsWith("/")) return null;
    const [pathname, query = ""] = url.split("?");
    const path = normalize(join(dirname(htmlPath), pathname));
    const version = /(?:^|&)v=([^&]+)/.exec(query)?.[1] || "";
    return { path, version, original: url };
  }).filter(Boolean);
}

test("all local CSS/JS references are versioned and shared assets use one cache key", () => {
  const versions = new Map();
  for (const page of pages) {
    const pageAssets = new Set();
    for (const asset of localAssets(page)) {
      assert.ok(existsSync(asset.path), page + " references missing asset " + asset.original);
      assert.ok(asset.version, page + " is missing a cache key for " + asset.original);
      assert.ok(!pageAssets.has(asset.path), page + " includes the same CSS/JS asset more than once: " + asset.path);
      pageAssets.add(asset.path);
      const prior = versions.get(asset.path);
      if (prior) {
        assert.equal(asset.version, prior.version,
          asset.path + " uses inconsistent cache keys in " + prior.page + " and " + page);
      } else {
        versions.set(asset.path, { version: asset.version, page });
      }
    }
  }
});

test("shared contact-channel styles load after catalog-specific styles", () => {
  const techHtml = readFileSync("tecnologia/index.html", "utf8");
  const perfumeHtml = readFileSync("perfumeria/index.html", "utf8");
  const styleLinks = html => [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+>/g)].map(match => match[0]);
  assert.match(styleLinks(techHtml).at(-1) || "", /contact-channels\.css\?v=20261029-theme-contrast1/);
  assert.match(styleLinks(perfumeHtml).at(-1) || "", /contact-channels\.css\?v=20261029-theme-contrast1/);
  assert.match(styleLinks(techHtml).at(-2) || "", /technology-visual-refresh\.css\?v=20261029-desktop-wide-audit3/);
  assert.match(styleLinks(perfumeHtml).at(-2) || "", /perfumeria\.css\?v=20261029-a11y-contrast3/);
});
