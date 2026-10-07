import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assessmentPhotoPaths, invokePermanentAssessmentDeleteRpc } from "../lib/services/assessmentPermanentDelete.ts";

const migration = readFileSync("supabase/migrations/20261007180000_master_admin_permanent_assessment_delete.sql", "utf8");
const archiveMigration = readFileSync("supabase/migrations/20260924162216_archive_sales_assessment.sql", "utf8");
const modal = readFileSync("components/walkthroughs/WalkthroughFormModal.tsx", "utf8");
const service = readFileSync("lib/services/walkthroughs.ts", "utf8");
const deleteHelper = readFileSync("lib/services/assessmentPermanentDelete.ts", "utf8");

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
  assert.match(deleteHelper, /master_admin_permanently_delete_assessment/);
});

test("RPC invocation preserves the Supabase client receiver and prevents the exact .rest crash", async () => {
  const client = {
    rest: { rpc: async (name, args) => ({ data: { deleted: true, name, args, photos: [] }, error: null }) },
    rpc(name, args) { return this.rest.rpc(name, args); },
  };
  const detached = client.rpc;
  assert.throws(() => detached("master_admin_permanently_delete_assessment", {}), /reading 'rest'/);
  const result = await invokePermanentAssessmentDeleteRpc(client, "assessment-a");
  assert.equal(result.error, null);
  assert.equal(result.data.deleted, true);
});

test("photo cleanup metadata supports current, empty, null, missing, and legacy shapes", () => {
  assert.deepEqual(assessmentPhotoPaths([{ storagePath: "walkthroughs/a/current.jpg" }], "a"), ["walkthroughs/a/current.jpg"]);
  assert.deepEqual(assessmentPhotoPaths([], "a"), []);
  assert.deepEqual(assessmentPhotoPaths(null, "a"), []);
  assert.deepEqual(assessmentPhotoPaths(undefined, "a"), []);
  assert.deepEqual(assessmentPhotoPaths([
    { storage_path: "walkthroughs/a/legacy-storage.jpg" },
    { path: "walkthroughs/a/legacy-path.jpg" },
    "walkthroughs/a/legacy-string.jpg",
    { unexpected: true },
    { storagePath: "walkthroughs/another/not-owned.jpg" },
  ], "a"), ["walkthroughs/a/legacy-storage.jpg", "walkthroughs/a/legacy-path.jpg", "walkthroughs/a/legacy-string.jpg"]);
});

test("successful database deletion remains successful when optional cleanup is malformed", () => {
  assert.doesNotThrow(() => assessmentPhotoPaths({ malformed: true }, "a"));
  assert.match(service, /catch\(cleanupError\)[\s\S]*return true/);
});
