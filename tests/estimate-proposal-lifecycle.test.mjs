import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  new URL("../supabase/migrations/20261008130000_estimate_lifecycle_correction.sql", import.meta.url),
  "utf8",
);
const estimatesPage = fs.readFileSync(
  new URL("../components/estimates/OpenEstimatesPage.tsx", import.meta.url),
  "utf8",
);
const dashboard = fs.readFileSync(
  new URL("../lib/services/dashboard.ts", import.meta.url),
  "utf8",
);
const estimateTypes = fs.readFileSync(
  new URL("../types/estimate.ts", import.meta.url),
  "utf8",
);
const delivery = fs.readFileSync(
  new URL("../lib/services/unifiedDocumentDelivery.ts", import.meta.url),
  "utf8",
);

test("Converted is an explicit persisted and TypeScript estimate status", () => {
  assert.match(migration, /check \(status in \('Open', 'Converted', 'Superseded', 'Declined', 'Archived'\)\)/);
  assert.match(estimateTypes, /"Open" \| "Converted" \| "Superseded" \| "Declined" \| "Archived"/);
});

test("successful proposal completion converts only a linked open non-archived estimate", () => {
  assert.match(migration, /source_estimate_id := coalesce\(direct_estimate_id, walkthrough_estimate_id\)/);
  assert.match(migration, /update public\.proposals[\s\S]*set status = 'Sent'[\s\S]*update public\.estimates[\s\S]*set status = 'Converted'/);
  assert.match(migration, /where id = source_estimate_id\s+and status = 'Open'\s+and archived_at is null/);
  assert.doesNotMatch(migration, /prepare_proposal_delivery[\s\S]*Converted/);
});

test("direct and walkthrough estimate references must agree", () => {
  assert.match(migration, /direct_estimate_id is distinct from walkthrough_estimate_id/);
  assert.match(migration, /Proposal source Estimate references do not agree/);
  assert.match(migration, /Estimate lifecycle backfill found conflicting Proposal source references/);
});

test("delivery failure cannot convert an estimate", () => {
  const completeCall = delivery.indexOf("await input.complete?.");
  const failureCheck = delivery.indexOf('if (emailStatus !== "Sent" && smsStatus !== "Message opened")');
  assert.ok(failureCheck >= 0 && completeCall > failureCheck);
  assert.doesNotMatch(delivery, /Converted/);
});

test("proposal retries and revisions keep the existing idempotent delivery contract", () => {
  assert.match(migration, /row\.status not in \('Approved','Sent','Viewed'\)/);
  assert.match(migration, /sent_at = coalesce\(sent_at, sent_time\)/);
  assert.match(migration, /if previous_status = 'Approved' then/);
  assert.match(migration, /proposal\.revision_group_id = row\.revision_group_id[\s\S]*for update/);
  assert.match(migration, /prior Proposal was accepted before this revision could be activated/);
});

test("backfill is relational, idempotent, and explicitly excludes the unconfirmed estimate", () => {
  assert.match(migration, /coalesce\(proposal\.estimate_id, walkthrough\.estimate_id\) as estimate_id/);
  assert.match(migration, /proposal\.sent_at is not null/);
  assert.match(migration, /estimate\.status = 'Open'/);
  assert.match(migration, /estimate\.archived_at is null/);
  assert.match(migration, /estimate\.id <> 'cfbf7106-33ee-48e6-a548-6f8f1985d3ec'::uuid/);
  assert.doesNotMatch(migration, /proposal\.client_id\s*=\s*estimate\.client_id/);
  assert.doesNotMatch(migration, /proposal\.property_id\s*=\s*estimate\.property_id/);
});

test("Active Estimates excludes Converted while historical filters retain it", () => {
  assert.match(estimatesPage, /item\.status !== "Converted"/);
  assert.match(estimatesPage, /"All", "Open", "Converted", "Superseded", "Declined", "Archived"/);
  assert.match(estimatesPage, /archive === "All Records"/);
});

test("confirmed superseded estimate correction is exact, auditable, and idempotent", () => {
  assert.match(migration, /where id = 'cfbf7106-33ee-48e6-a548-6f8f1985d3ec'::uuid/);
  assert.match(migration, /replacement_id constant uuid := 'f2cebd49-dfcf-4f91-9d20-cfcd58ff10a6'::uuid/);
  assert.match(migration, /replacement\.estimate_number <> 'EST-20261007-2315'/);
  assert.match(migration, /Replaced with a new estimate to correctly attach project photographs\./);
  assert.match(migration, /original\.status = 'Superseded'[\s\S]*return;/);
  assert.match(migration, /set status = 'Superseded',[\s\S]*archived_at = now\(\),[\s\S]*superseded_by_estimate_id = replacement_id/);
  const correction = migration.slice(migration.indexOf("-- Explicitly preserve and retire"));
  assert.doesNotMatch(correction, /update public\.proposals/);
  assert.doesNotMatch(correction, /\b(?:result|notes|terms|client_id|property_id|estimate_id)\s*=/);
});

test("scheduled walkthrough behavior and dashboard open counts remain intact", () => {
  assert.match(estimatesPage, /item\.status\s*===?\s*"Open"\s*&&\s*scheduledEstimateIds\.has\(item\.id\)/);
  assert.match(dashboard, /row\.status === "Open" && !scheduledEstimateIds\.has\(row\.id\)/);
});
