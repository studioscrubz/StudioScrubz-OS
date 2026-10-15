import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20261015151129_automatic_proposal_agreement_drafts.sql", import.meta.url),
  "utf8",
);

test("all acceptance paths converge on one idempotent draft helper", () => {
  assert.match(migration, /function private\.ensure_proposal_draft_agreement\(p_proposal_id uuid\)/);
  assert.match(migration, /create unique index one_active_agreement_per_proposal|unique_violation/);
  assert.match(migration, /ensure_post_construction_acceptance_handoff[\s\S]*ensure_proposal_draft_agreement/);
  assert.match(migration, /create_post_construction_agreement_after_acceptance[\s\S]*ensure_post_construction_acceptance_handoff/);
  assert.doesNotMatch(migration, /update public\.proposals\s+set status='Accepted'/);
});

test("accepted proposal snapshots remain authoritative and drafts are not sent", () => {
  assert.match(migration, /'accepted_proposal_result',proposal_row\.result/);
  assert.match(migration, /'accepted_delivery_snapshot',proposal_row\.client_delivery_snapshot/);
  assert.match(migration, /'accepted_pricing_allocation',proposal_row\.result->'acceptedPricingAllocation'/);
  assert.match(migration, /'Draft',proposal_row\.notes/);
  assert.doesNotMatch(migration, /client_access_token\s*,|client_access_token\s*=/);
});

test("Upkeep remains one monthly package with three unscheduled review visits", () => {
  assert.match(migration, /service_name = 'StudioScrubz Upkeep Plan'/);
  assert.match(migration, /visitsIncluded[\s\S]*<> 3/);
  assert.match(migration, /amount := round\(\(proposal_row\.result#>>'\{upkeepPlan,monthlyPackage\}'\)::numeric, 2\)/);
  assert.match(migration, /case when is_upkeep then 'Monthly' else 'Per Visit' end/);
  assert.match(migration, /Confirm all three Upkeep Plan visit days before sending/);
});

test("cancelled or archived agreement history requires explicit recovery", () => {
  assert.match(migration, /has only cancelled or archived Agreements\. Explicit administrative recovery is required/);
  assert.doesNotMatch(migration, /delete from public\.service_agreements/i);
});
