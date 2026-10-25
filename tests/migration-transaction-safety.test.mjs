import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationDirectory = "supabase/migrations";
const newMigrationFloor = "20261025145923";
const migrations = readdirSync(migrationDirectory)
  .filter((name) => name.endsWith(".sql") && name.slice(0, 14) >= newMigrationFloor)
  .sort();

test("new migrations remain compatible with externally managed transactions", () => {
  assert.ok(migrations.length > 0, "Expected at least one migration at or after the safety-check floor.");

  for (const name of migrations) {
    const sql = readFileSync(`${migrationDirectory}/${name}`, "utf8");
    assert.doesNotMatch(sql, /^\s*(begin|commit|rollback)\s*;/gim, `${name} must not control its transaction boundary`);
    assert.doesNotMatch(sql, /create\s+(unique\s+)?index\s+concurrently/i, `${name} must not escape transactional index creation`);
    assert.doesNotMatch(sql, /^\s*(vacuum|alter\s+system|create\s+database|drop\s+database)\b/gim, `${name} contains a non-transactional database operation`);
  }
});
