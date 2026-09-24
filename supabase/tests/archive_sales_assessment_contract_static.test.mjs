import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20260924162216_archive_sales_assessment.sql", "utf8");
const service = readFileSync("lib/services/walkthroughs.ts", "utf8");
const modal = readFileSync("components/walkthroughs/WalkthroughFormModal.tsx", "utf8");
const page = readFileSync("components/walkthroughs/WalkthroughsPage.tsx", "utf8");
const archives = readFileSync("lib/services/archives.ts", "utf8");

test("archive RPC is management-only, row-locked, and idempotent", () => {
  assert.match(migration, /create or replace function public\.archive_sales_assessment\(p_assessment_id uuid\)\s+returns public\.walkthroughs/i);
  assert.match(migration, /auth\.uid\(\) is null[\s\S]*public\.has_any_role\(array\['Master Admin', 'Administrator', 'Manager'\]\)/i);
  assert.match(migration, /from public\.walkthroughs[\s\S]*where id = p_assessment_id[\s\S]*for update/i);
  assert.match(migration, /if assessment\.archived_at is not null then[\s\S]*return assessment/i);
  assert.doesNotMatch(migration, /assessment\.(?:client_id|property_id) is null[\s\S]{0,80}raise exception/i);
});

test("archive RPC blocks retained business history", () => {
  for (const table of ["proposals", "service_agreements", "jobs", "invoices", "payments", "time_entries", "expenses", "mileage_entries", "job_mileage_trips", "service_occurrences", "invoice_job_photos", "client_communications"]) {
    assert.match(migration, new RegExp(`public\\.${table}`));
  }
  assert.match(migration, /snapshot\.storage_path = assessment_photo->>'storagePath'/);
  assert.match(migration, /proposal_photo->>'storagePath' = assessment_photo->>'storagePath'/);
  assert.match(migration, /communication\.estimate_id = assessment\.estimate_id/);
  assert.match(migration, /This Assessment cannot be archived because it is linked to retained %s history\./);
  assert.match(migration, /errcode = '23503'/);
  assert.match(migration, /set archived_at = now\(\), status = 'Archived'/);
});

test("archive RPC is hardened and narrowly granted", () => {
  assert.match(migration, /security definer\s+set search_path = ''/i);
  assert.match(migration, /revoke all on function public\.archive_sales_assessment\(uuid\)\s+from public, anon, authenticated;/i);
  assert.match(migration, /grant execute on function public\.archive_sales_assessment\(uuid\)\s+to authenticated;/i);
  assert.doesNotMatch(migration, /on delete cascade|grant (?:insert|update|delete)/i);
});

test("application routes archiving only through the RPC and preserves database messages", () => {
  assert.match(service, /rpc\("archive_sales_assessment", \{ p_assessment_id: id \}\)/);
  assert.match(service, /if \(error\) throw new Error\(error\.message\)/);
  assert.doesNotMatch(service, /archiveWalkthrough[\s\S]{0,200}\.from\("walkthroughs"\)\.update/);
});

test("detail control is confirmed, role-limited, and hidden for archived records", () => {
  assert.match(modal, /\["Master Admin", "Administrator", "Manager"\]\.includes\(profile\.role\)/);
  assert.match(modal, /window\.confirm\("Archive this Assessment\?"\)/);
  assert.match(modal, /!walkthrough\.archived_at && walkthrough\.status !== "Archived" && canArchive/);
  assert.match(modal, />Archive Assessment<\/button>/);
  assert.match(modal, /setError\(message\(caught, "The Assessment could not be archived\."\)\)/);
});

test("successful archiving immediately removes the Assessment and archive inventory includes it", () => {
  assert.match(page, /setWalkthroughs\(\(current\) => current\.filter\(\(item\) => item\.id !== archivedId\)\)/);
  assert.match(page, /void refresh\("Assessment archived successfully\."\)/);
  assert.match(archives, /\{ type: "Walkthroughs", table: "walkthroughs", href: "\/walkthroughs" \}/);
  assert.match(archives, /\.not\("archived_at", "is", null\)/);
});
