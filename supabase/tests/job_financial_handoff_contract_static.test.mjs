import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  new URL("../migrations/20260919162436_restore_job_financial_handoff_contract.sql", import.meta.url),
  "utf8",
);
const invoices = fs.readFileSync(new URL("../../lib/services/invoices.ts", import.meta.url), "utf8");

test("financial handoff lookup matches the application RPC and verified live signature", () => {
  assert.match(invoices, /rpc\("get_financially_handed_off_job_ids"\)/);
  assert.match(
    migration,
    /create or replace function public\.get_financially_handed_off_job_ids\(\)\s+returns setof uuid/,
  );
  assert.match(migration, /where public\.is_job_financially_handed_off\(job\.id\)/);
});

test("financial handoff lookup is authenticated and management-only", () => {
  assert.match(migration, /if auth\.uid\(\) is null/);
  assert.match(
    migration,
    /public\.has_any_role\(array\[\s*'Master Admin',\s*'Administrator',\s*'Manager'\s*\]\)/,
  );
  assert.doesNotMatch(migration, /'Crew Lead'|'Scrub Technician'|'Sales'/);
});

test("financial handoff lookup has hardened definer configuration and narrow grants", () => {
  assert.match(migration, /stable\s+security definer\s+set search_path = ''/);
  assert.match(
    migration,
    /revoke all on function public\.get_financially_handed_off_job_ids\(\)\s+from public, anon, authenticated;/,
  );
  assert.match(
    migration,
    /grant execute on function public\.get_financially_handed_off_job_ids\(\)\s+to authenticated;/,
  );
  assert.doesNotMatch(migration, /grant execute[\s\S]*to (?:public|anon)/i);
});

test("migration does not overwrite already migration-backed cluster functions", () => {
  for (const name of [
    "is_job_financially_handed_off",
    "create_completed_job_invoice",
    "get_operational_job_ids",
    "get_operational_jobs",
  ]) {
    assert.doesNotMatch(migration, new RegExp(`create or replace function public\\.${name}\\b`));
  }
});
