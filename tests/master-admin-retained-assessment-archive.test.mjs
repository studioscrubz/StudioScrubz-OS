import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20261008133000_master_admin_archive_retained_assessment.sql",
  "utf8",
);

test("retained-history archive exception is restricted to the confirmed Assessment and Master Admin", () => {
  assert.match(migration, /target_assessment_id constant uuid := 'd1f5ecaf-94fe-4223-a944-15b78e86ea6f'::uuid/);
  assert.match(migration, /p_assessment_id is distinct from target_assessment_id[\s\S]*archive_sales_assessment_before_retained_history_override_20261008/);
  assert.match(migration, /auth\.uid\(\)\) is null or not public\.is_master_admin\(\)/);
  assert.match(migration, /using errcode = '42501'/);
});

test("archive is non-destructive and preserves every retained relationship", () => {
  assert.match(migration, /update public\.walkthroughs[\s\S]*status = 'Archived'/);
  assert.doesNotMatch(migration, /delete from/i);
  assert.doesNotMatch(migration, /update public\.(?:proposals|jobs|invoices|payments|client_communications)/i);
  assert.doesNotMatch(migration, /set\s+walkthrough_id\s*=\s*null/i);
  for (const protectedTable of ["proposals", "jobs", "invoice_job_photos", "client_communications", "invoices", "payments"]) {
    assert.doesNotMatch(migration, new RegExp(`delete\\s+from\\s+public\\.${protectedTable}`, "i"));
  }
});

test("archive records the mistaken Proposal note in immutable Assessment history", () => {
  assert.match(migration, /insert into public\.assessment_history/);
  assert.match(migration, /Archived With Retained History/);
  assert.match(migration, /The linked Proposal was created by mistake/);
  assert.match(migration, /no related records were deleted or detached/);
  assert.match(migration, /changed_by_user_id[\s\S]*auth\.uid\(\)/);
});

test("repeat calls are idempotent and normal archive protections remain authoritative", () => {
  assert.match(migration, /if assessment\.archived_at is not null then[\s\S]*return assessment/);
  assert.match(migration, /rename to archive_sales_assessment_before_retained_history_override_20261008/);
  assert.match(migration, /revoke all on function public\.archive_sales_assessment_before_retained_history_override_20261008/);
  assert.match(migration, /revoke all on function public\.archive_sales_assessment\(uuid\)[\s\S]*grant execute[\s\S]*to authenticated/);
  assert.match(migration, /security definer[\s\S]*set search_path = ''/);
});
