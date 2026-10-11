import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20261011025119_manual_proposal_acceptance.sql");
const page = read("components/proposals/OpenProposalsPage.tsx");
const service = read("lib/services/proposals.ts");

test("manual acceptance uses a role-gated dedicated RPC", () => {
  assert.match(migration, /profile\.is_active/);
  assert.match(migration, /profile\.role in \('Master Admin', 'Administrator'\)/);
  assert.match(migration, /security definer/);
  assert.match(migration, /grant execute on function public\.record_manual_proposal_acceptance[\s\S]*to authenticated/);
  assert.doesNotMatch(migration, /grant execute[\s\S]*to anon/);
  assert.match(service, /callManualAcceptanceRpc\("record_manual_proposal_acceptance"/);
  assert.doesNotMatch(service, /markProposalAccepted/);
});

test("manual acceptance UI captures the required evidence and disclosure", () => {
  assert.match(page, /Record Manual Acceptance/);
  assert.match(page, /Actual date and time accepted/);
  assert.match(page, /Notes or evidence reference/);
  assert.match(page, /explicitly authorized acceptance of this exact proposal revision/);
  assert.match(page, /does not send deposit instructions or impersonate the client/);
  assert.match(page, /Manual acceptance authorization could not be verified/);
});

test("RPC preserves commercial content and records an idempotent audit trail", () => {
  assert.match(migration, /status = 'Accepted',[\s\S]*accepted = true/);
  assert.doesNotMatch(migration, /set[\s\S]{0,200}result\s*=/);
  assert.doesNotMatch(migration, /signature\s*=/);
  assert.match(migration, /if proposal_row\.status = 'Accepted' and proposal_row\.accepted/);
  assert.match(migration, /'Manual Acceptance'/);
  assert.match(migration, /'recorded_by_user_id', actor\.id/);
  assert.match(migration, /private\.ensure_post_construction_acceptance_handoff/);
});
