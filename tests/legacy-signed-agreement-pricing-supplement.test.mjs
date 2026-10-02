import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "supabase/migrations/20261002133151_legacy_signed_agreement_pricing_allocations.sql";
const migration = readFileSync(migrationPath, "utf8");
const invoiceMigrationPath = "supabase/migrations/20260923200258_post_construction_deposit_workflow.sql";
const invoiceMigration = readFileSync(invoiceMigrationPath, "utf8");

test("creates one private append-only supplement per Agreement", () => {
  assert.match(migration, /create table public\.legacy_signed_agreement_pricing_allocations/);
  assert.match(migration, /service_agreement_id uuid not null unique[\s\S]*references public\.service_agreements\(id\) on delete restrict/);
  assert.match(migration, /allocation jsonb not null/);
  assert.match(migration, /signed_total numeric\(12,2\) not null/);
  assert.match(migration, /evidence jsonb not null/);
  assert.doesNotMatch(migration, /\bactive\b[^;\n]*boolean/i);
  assert.doesNotMatch(migration, /create (?:or replace )?function public\.(?:insert|create|replace).*legacy_signed_agreement_pricing_allocation/i);
});

test("rejects unsigned, unaccepted, native-allocation, malformed, mismatched, and duplicate inserts", () => {
  assert.match(migration, /where id = new\.service_agreement_id\s+for update/);
  assert.match(migration, /agreement_row\.client_signed_at is null/);
  assert.match(migration, /agreement_row\.accepted_at is null/);
  assert.match(migration, /jsonb_typeof\(agreement_row\.client_signed_snapshot\) is distinct from 'object'/);
  assert.match(migration, /agreement_row\.billing_type is distinct from 'Per Visit'/);
  assert.match(migration, /round\(agreement_row\.billing_amount, 2\) is distinct from round\(new\.signed_total, 2\)/);
  assert.match(migration, /client_signed_snapshot->'billing_amount'/);
  assert.match(migration, /client_signed_snapshot->'pricing_snapshot'->'final_per_visit_price'/);
  assert.match(migration, /native accepted pricing allocation already exists/);
  assert.match(migration, /is_valid_job_pricing_snapshot\(new\.allocation, new\.signed_total\)/);
  assert.match(migration, /legacy pricing allocation already exists for this Service Agreement/);
});

test("supplements cannot be updated or deleted and have no authenticated access", () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.legacy_signed_agreement_pricing_allocations\s+from public, anon, authenticated/);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete).*legacy_signed_agreement_pricing_allocations.*authenticated/i);
  assert.match(migration, /before update or delete on public\.legacy_signed_agreement_pricing_allocations/);
  assert.match(migration, /Legacy signed Agreement pricing allocations are immutable/);
});

test("seeds only AGR-20260831-4970 from explicit persisted historical evidence", () => {
  assert.match(migration, /42a2f12c-0637-4ac6-bdd8-b3d2343779ee/);
  assert.match(migration, /AGR-20260831-4970/);
  assert.match(migration, /462c4943-d166-41b3-8db4-21c367e412b3/);
  assert.match(migration, /40703776-eda0-4068-a936-06b85f2b6e7d/);
  assert.match(migration, /'baseServiceAmount', 232\.00/);
  assert.match(migration, /'lineTotal', 18\.00/);
  assert.match(migration, /'totalAmount', 250\.00/);
  assert.match(migration, /proposal_row\.result->'adjustments'/);
  assert.match(migration, /agreement_row\.pricing_snapshot->'catalog_addons'/);
  assert.match(migration, /agreement_row\.client_signed_snapshot->'pricing_snapshot'->'catalog_addons'/);
  assert.match(migration, /currentPricingTablesConsulted', false/);
  assert.match(migration, /does not amend the signed Service Agreement/);
});

test("job creation gives native allocation strict precedence", () => {
  const functionSql = migration.slice(migration.indexOf("create or replace function public.create_job_from_service_occurrence"));
  const nativeBranch = functionSql.indexOf("native_pricing_allocation is not null");
  const supplementLookup = functionSql.indexOf("from public.legacy_signed_agreement_pricing_allocations");
  assert.ok(nativeBranch >= 0 && supplementLookup > nativeBranch);
  assert.match(functionSql, /if native_pricing_allocation is not null and jsonb_typeof\(native_pricing_allocation\) <> 'null' then/);
  assert.match(functionSql, /is_valid_job_pricing_snapshot\(native_pricing_allocation, agreement_row\.billing_amount\)[\s\S]*raise exception 'The Agreement native accepted pricing allocation is invalid/);
  assert.match(functionSql, /else\s+select \* into supplement_row/);
  assert.match(functionSql, /raise exception 'The Agreement native accepted pricing allocation is invalid[^;]+;\s+end if;\s+job_pricing_snapshot := native_pricing_allocation;\s+else\s+select \* into supplement_row/);
});

test("supplemental jobs receive a validated copy with provenance while price stays authoritative", () => {
  const functionSql = migration.slice(migration.indexOf("create or replace function public.create_job_from_service_occurrence"));
  assert.match(functionSql, /is_valid_job_pricing_snapshot\(supplement_row\.allocation, agreement_row\.billing_amount\)/);
  assert.match(functionSql, /round\(supplement_row\.signed_total, 2\) is distinct from round\(agreement_row\.billing_amount, 2\)/);
  assert.match(functionSql, /job_pricing_snapshot := supplement_row\.allocation \|\| jsonb_build_object/);
  assert.match(functionSql, /'source', 'legacy_signed_agreement_supplement'/);
  assert.match(functionSql, /job_amount := case when agreement_row\.billing_type = 'Per Visit' then agreement_row\.billing_amount else 0 end/);
  assert.doesNotMatch(functionSql, /job_amount := round\(\(job_pricing_snapshot->>'totalAmount'\)::numeric, 2\)/);
  assert.match(functionSql, /team, job_amount, job_pricing_snapshot/);
});

test("neither allocation preserves the null-snapshot total-only fallback", () => {
  const functionSql = migration.slice(migration.indexOf("create or replace function public.create_job_from_service_occurrence"));
  assert.match(functionSql, /job_pricing_snapshot := null/);
  assert.match(functionSql, /if found then[\s\S]*job_pricing_snapshot := supplement_row\.allocation/);
  assert.match(functionSql, /team, job_amount, job_pricing_snapshot/);
});

test("historical Jobs and invoice generation are not changed", () => {
  const beforeJobFunction = migration.slice(0, migration.indexOf("create or replace function public.create_job_from_service_occurrence"));
  assert.doesNotMatch(beforeJobFunction, /update public\.jobs/i);
  assert.doesNotMatch(migration, /update public\.invoices|update public\.payments/i);
  assert.doesNotMatch(migration, /create or replace function public\.create_completed_job_invoice/i);
  assert.match(invoiceMigration, /if job_row\.pricing_snapshot is null then line_items:=jsonb_build_array/);
});
