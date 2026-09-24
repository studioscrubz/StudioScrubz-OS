import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20260924155140_client_delete_safe_assessment_cleanup.sql", "utf8");
const archives = readFileSync("lib/services/archives.ts", "utf8");

test("combined migration preserves the archived Client Property Service Plan guard", () => {
  assert.match(migration, /create or replace function private\.prevent_client_delete_with_service_plan\(\)/i);
  assert.match(migration, /from public\.property_service_plans plan[\s\S]*plan\.client_id = old\.id/i);
  assert.match(migration, /This Client cannot be permanently deleted because it has a Property Service Plan\. Permanently delete the eligible archived Service Plan first, or keep the Client archived\./);
  assert.match(migration, /drop trigger if exists clients_prevent_service_plan_delete on public\.clients;[\s\S]*create trigger clients_prevent_service_plan_delete[\s\S]*before delete on public\.clients/i);
  assert.ok(migration.indexOf("private.prevent_client_delete_with_service_plan") < migration.indexOf("private.cleanup_client_assessments_before_delete"));
});

test("Client archive behavior is untouched and permanent deletion owns Assessment cleanup", () => {
  assert.doesNotMatch(migration, /update public\.clients[\s\S]*archived_at/i);
  assert.match(migration, /before delete on public\.clients/i);
  assert.match(migration, /auth\.uid\(\) is null or not public\.is_master_admin\(\)/i);
  assert.match(migration, /from public\.walkthroughs assessment[\s\S]*assessment\.client_id = old\.id[\s\S]*for update/i);
  assert.match(migration, /delete from public\.assessment_photo_access/i);
  assert.match(migration, /update public\.walkthroughs[\s\S]*set photos = '\[\]'::jsonb[\s\S]*delete from public\.walkthroughs/i);
});

test("retained Assessment dependencies block with a controlled user-facing message", () => {
  for (const table of ["proposals", "service_agreements", "jobs", "invoices", "payments", "invoice_job_photos"]) {
    assert.match(migration, new RegExp(`public\\.${table}`));
  }
  assert.match(migration, /This Client cannot be permanently deleted because an Assessment is linked to retained %s history/);
  assert.match(migration, /errcode = '23503'/);
  assert.doesNotMatch(migration, /on delete cascade/i);
});

test("Assessment photo objects use Storage API after guarded references are removed", () => {
  assert.doesNotMatch(migration, /delete from storage\.objects/i);
  assert.match(migration, /not exists \(select 1 from public\.invoice_job_photos/);
  assert.match(migration, /not exists \([\s\S]*from public\.proposals proposal/);
  assert.match(archives, /from\("walkthroughs"\)\.select\("id,photos"\)\.eq\("client_id", clientId\)/);
  assert.match(archives, /storage\.from\(OPERATIONAL_PHOTO_BUCKET\)\.remove\(assessmentPhotoPaths\)/);
});

test("archive dependency preview no longer treats a deletable Assessment as a Client blocker", () => {
  const clientDependencies = archives.match(/Clients: \[(.*?)\],\n  Properties:/s)?.[1] ?? "";
  assert.doesNotMatch(clientDependencies, /walkthroughs/);
  assert.match(clientDependencies, /proposals/);
  assert.match(clientDependencies, /jobs/);
  assert.match(clientDependencies, /invoices/);
  assert.match(clientDependencies, /payments/);
});
