import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  new URL("../migrations/20260919164057_restore_finished_job_invoice_photo_contract.sql", import.meta.url),
  "utf8",
);
const invoiceService = fs.readFileSync(new URL("../../lib/services/invoices.ts", import.meta.url), "utf8");
const publicPhotosRoute = fs.readFileSync(
  new URL("../../app/api/public/invoices/[token]/photos/route.ts", import.meta.url),
  "utf8",
);

test("invoice photo table matches the application columns and historical foreign keys", () => {
  for (const column of [
    "id", "invoice_id", "job_id", "job_photo_id", "storage_path", "category",
    "original_filename", "mime_type", "size_bytes", "caption", "uploaded_at",
    "uploaded_by", "source", "customer_visible", "created_at",
  ]) {
    assert.match(migration, new RegExp(`\\b${column}\\b`));
  }
  assert.match(migration, /invoice_id uuid not null references public\.invoices\(id\) on delete cascade/);
  assert.match(migration, /job_id uuid not null references public\.jobs\(id\) on delete restrict/);
  assert.match(migration, /unique \(invoice_id, job_photo_id\)/);
  assert.match(migration, /unique \(invoice_id, storage_path\)/);
  assert.match(migration, /storage_path like 'walkthroughs\/%'/);
  assert.match(migration, /storage_path like 'proposals\/%'/);
  assert.match(migration, /storage_path like 'jobs\/%'/);
});

test("table is management-readable and otherwise immutable to authenticated clients", () => {
  assert.match(migration, /alter table public\.invoice_job_photos enable row level security/);
  assert.match(migration, /revoke all on table public\.invoice_job_photos from public, anon, authenticated/);
  assert.match(migration, /grant select on table public\.invoice_job_photos to authenticated/);
  assert.match(migration, /profile\.is_active/);
  assert.match(migration, /profile\.role in \('Master Admin', 'Administrator', 'Manager'\)/);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete|all) on table public\.invoice_job_photos/i);
  assert.doesNotMatch(migration, /create policy "Invoice finished photos (?:create|update|delete)"/);
});

test("visibility RPC is authenticated, administrator-scoped, and invoice/photo exact", () => {
  const visibilityFunction = migration.match(
    /create or replace function public\.set_invoice_job_photo_visibility[\s\S]*?\n\$\$;/,
  )?.[0] ?? "";
  assert.match(invoiceService, /rpc\("set_invoice_job_photo_visibility"/);
  assert.match(visibilityFunction, /set_invoice_job_photo_visibility\(\s*p_invoice_id uuid,\s*p_photo_id uuid,\s*p_customer_visible boolean\s*\)\s+returns public\.invoice_job_photos/);
  assert.match(visibilityFunction, /auth\.uid\(\) is null/);
  assert.match(visibilityFunction, /profile\.role in \('Master Admin', 'Administrator'\)/);
  assert.match(visibilityFunction, /where invoice_id = p_invoice_id and id = p_photo_id/);
  assert.doesNotMatch(visibilityFunction, /'Manager'|'Sales'|'Crew Lead'|'Scrub Technician'/);
  assert.match(migration, /revoke all on function public\.set_invoice_job_photo_visibility\(uuid, uuid, boolean\)[\s\S]*?from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.set_invoice_job_photo_visibility\(uuid, uuid, boolean\)[\s\S]*?to authenticated/);
});

test("snapshots preserve all verified sources and fail closed on visibility", () => {
  assert.match(migration, /'Job'::text as owner_type/);
  assert.match(migration, /'Proposal'::text/);
  assert.match(migration, /'Walkthrough'::text/);
  assert.match(migration, /jsonb_typeof\(candidate\.photo -> 'customerVisible'\) = 'boolean'[\s\S]*?else false end/);
  assert.match(migration, /invoice\.status not in \('Paid', 'Cancelled', 'Archived'\)/);
  assert.match(migration, /on conflict do nothing/);
  assert.match(migration, /invoices_snapshot_finished_job_photos/);
  assert.match(migration, /jobs_sync_new_finished_photos_to_invoice/);
});

test("Job JSON and private Storage deletion retain invoiced references", () => {
  assert.match(migration, /jobs_protect_invoiced_photo_references/);
  assert.match(migration, /reference\.storage_path like 'jobs\/' \|\| old\.id::text \|\| '\/%'/);
  assert.equal((migration.match(/from public\.invoice_job_photos reference/g) ?? []).length >= 3, true);
  assert.match(migration, /create policy "Operational photos scoped delete"[\s\S]*?to authenticated/);
  assert.match(migration, /public\.can_delete_operational_photo_path\(name\)/);
  assert.match(migration, /public\.can_delete_proposal_photo_path\(name\)/);
});

test("public receipt photos remain token-scoped, customer-visible, and short-lived", () => {
  assert.match(publicPhotosRoute, /token\.length < 40/);
  assert.match(publicPhotosRoute, /client_access_token_expires_at/);
  assert.match(publicPhotosRoute, /\.eq\("invoice_id", invoice\.id\)\.eq\("customer_visible", true\)/);
  assert.match(publicPhotosRoute, /createSignedUrls\([^,]+, 5 \* 60\)/);
  assert.doesNotMatch(migration, /grant select on table public\.invoice_job_photos to anon/);
});

test("all promoted helpers use empty search paths and internal trigger helpers stay private", () => {
  assert.equal((migration.match(/security definer\s+set search_path = ''/g) ?? []).length, 6);
  for (const name of [
    "snapshot_finished_job_photos_for_invoice",
    "sync_new_finished_job_photos_to_invoice",
    "protect_invoiced_job_photo_references",
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${name}\\(\\)[\\s\\S]*?from public, anon, authenticated`));
    assert.doesNotMatch(migration, new RegExp(`grant execute on function public\\.${name}`));
  }
});
