import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const adminJs = readFileSync(new URL("../admin.js", import.meta.url), "utf8");

test("admin save and image-upload handlers use the declared preview guard", () => {
  assert.match(adminJs, /const IS_READ_ONLY_PREVIEW\s*=/);
  assert.doesNotMatch(
    adminJs,
    /\bIS_READ_ONLY_VERCEL_PREVIEW\b/,
    "A stale guard name must not throw a ReferenceError before the save handler reaches Supabase."
  );
  assert.match(adminJs, /form\?\.addEventListener\("submit", async event => \{\s*event\.preventDefault\(\);\s*if \(IS_READ_ONLY_PREVIEW\)/);
  assert.ok((adminJs.match(/IS_READ_ONLY_PREVIEW/g) || []).length >= 5);
});
