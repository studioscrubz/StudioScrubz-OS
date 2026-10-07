import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20261007180000_master_admin_permanent_assessment_delete.sql", "utf8");
const archiveMigration = readFileSync("supabase/migrations/20260924162216_archive_sales_assessment.sql", "utf8");
const modal = readFileSync("components/walkthroughs/WalkthroughFormModal.tsx", "utf8");
const service = readFileSync("lib/services/walkthroughs.ts", "utf8");

test("only an authenticated canonical Master Admin can permanently delete an Assessment", () => {
  assert.match(migration, /\(select auth\.uid\(\)\) is null or not public\.is_master_admin\(\)/);
  assert.doesNotMatch(migration, /has_any_role/);
  for (const role of ["Administrator", "Manager", "Sales", "Crew Lead", "Scrub Technician", "Lead Representative"]) assert.doesNotMatch(migration, new RegExp(`'${role}'`));
  assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function[\s\S]*to authenticated/);
  assert.match(modal, /profile\?\.is_active === true && profile\.role === "Master Admin"/);
});

test("retained communications and authoritative downstream records survive with Assessment links detached", () => {
  assert.match(migration, /update public\.proposals set walkthrough_id = null/);
  assert.match(migration, /update public\.jobs set walkthrough_id = null/);
  for (const table of ["client_communications", "estimates", "proposals", "service_agreements", "jobs", "invoices", "payments"]) {
    assert.doesNotMatch(migration, new RegExp(`delete from public\\.${table}`));
  }
  assert.match(migration, /delete from public\.assessment_history/);
  assert.match(migration, /delete from public\.walkthroughs/);
});

test("normal Archive remains separately protected for existing authorized roles", () => {
  assert.match(archiveMigration, /has_any_role\(array\['Master Admin', 'Administrator', 'Manager'\]\)/);
  assert.match(archiveMigration, /linked to retained %s history/);
  assert.match(modal, /Archive Assessment/);
  assert.match(modal, /Delete Permanently/);
});

test("the operation is safe for nonexistent and repeated Assessment deletion", () => {
  assert.match(migration, /if not found then[\s\S]*'deleted', false/);
  assert.match(migration, /from public\.walkthroughs[\s\S]*for update/);
  assert.match(service, /if\(!result\?\.deleted\)return false/);
});

test("the destructive UI explains retention and irreversibility before invoking the RPC", () => {
  assert.match(modal, /Retained communication history and downstream business records will NOT be deleted/);
  assert.match(modal, /This action cannot be undone/);
  assert.match(modal, /window\.confirm/);
  assert.match(service, /master_admin_permanently_delete_assessment/);
});
