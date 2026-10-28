import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const migrationsDir = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
const files = readdirSync(migrationsDir)
  .filter(name => name.endsWith(".sql"))
  .sort();

const knownAppliedDuplicate = [
  "20261024221403_product_types_and_unified_featured_exclusive.sql",
  "20261024221435_product_types_and_unified_featured_exclusive.sql"
].sort();

test("Supabase migration files have unique version identifiers", () => {
  const seen = new Map();
  for (const file of files) {
    const match = /^(\d{14})_/.exec(file);
    assert.ok(match, file + ": migration filename must start with a 14-digit version");
    const prior = seen.get(match[1]);
    assert.equal(prior, undefined, "duplicate migration version " + match[1] + ": " + prior + " and " + file);
    seen.set(match[1], file);
  }
});

test("no new migration files duplicate the exact SQL of another migration", () => {
  const byDigest = new Map();
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file));
    const digest = createHash("sha256").update(sql).digest("hex");
    const group = byDigest.get(digest) || [];
    group.push(file);
    byDigest.set(digest, group);
  }

  const duplicateGroups = [...byDigest.values()].filter(group => group.length > 1);
  assert.deepEqual(
    duplicateGroups.map(group => group.map(basename).sort()).sort((a, b) => a.join("|").localeCompare(b.join("|"))),
    [knownAppliedDuplicate],
    "duplicate SQL migrations found; do not delete or rewrite already-applied history. Reconcile the new duplicate before merging."
  );
});
