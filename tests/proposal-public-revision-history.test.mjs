import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const migration = readFileSync(new URL("../supabase/migrations/20261010000000_proposal_public_revision_history.sql", import.meta.url), "utf8");
const correction = readFileSync(new URL("../supabase/corrections/20261010_correct_prop_20261007_4229_r2_pricing_presentation.sql", import.meta.url), "utf8");
const verification = readFileSync(new URL("../supabase/corrections/20261010_verify_prop_20261007_4229_r2_pricing_presentation.sql", import.meta.url), "utf8");
const page = readFileSync(new URL("../components/proposals/PublicProposalPage.tsx", import.meta.url), "utf8");
const document = readFileSync(new URL("../components/proposals/ProposalDocument.tsx", import.meta.url), "utf8");

const target = { exports: {} };
const code = ts.transpileModule(readFileSync(new URL("../lib/proposals/revisionComparison.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(code, { module: target, exports: target.exports, require: () => ({}) });
const { compareProposalRevisions } = target.exports;

const revision = (number, overrides = {}) => ({
  revision_number: number,
  is_current_revision: number === 2,
  superseded: number !== 2,
  proposal_number: number === 1 ? "PROP-20261007-4229" : `PROP-20261007-4229-R${number}`,
  status: number === 2 ? "Sent" : "Archived",
  client_name: "Client",
  property_location: "Property",
  service_name: "Recording Studio Cleaning",
  service_description: "Cleaning",
  frequency: "One-Time",
  requested_date: null,
  scope: [],
  adjustments: [],
  base_price: 350,
  recurring_discount_percent: 0,
  recurring_discount_amount: 0,
  manual_discount: 0,
  discount: 0,
  taxes: 0,
  per_visit_total: 350,
  monthly_total: null,
  terms: {},
  expiration_date: "2026-11-07",
  accepted_at: null,
  accepted_by_name: null,
  client_acceptance_consent: null,
  business_name: "StudioScrubz",
  tagline: null,
  business_email: null,
  business_phone: null,
  website: null,
  address: null,
  city: null,
  state: null,
  zip: null,
  ...overrides,
});

test("public history is isolated to the valid current token revision family", () => {
  assert.match(migration, /client_access_token = p_token/);
  assert.match(migration, /proposal\.is_current_revision/);
  assert.match(migration, /proposal\.revision_group_id = anchor\.revision_group_id/);
  assert.match(migration, /proposal\.revision_number <= anchor\.revision_number/);
  assert.doesNotMatch(migration, /client_access_token['"]/);
});

test("historical delivery content is immutable and direct public table access is denied", () => {
  assert.match(migration, /before update or delete on public\.proposal_delivery_snapshots/);
  assert.match(migration, /Proposal delivery snapshots are immutable/);
  assert.match(migration, /revoke all on table public\.proposal_delivery_snapshots[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /after update of client_delivery_snapshot on public\.proposals/);
  assert.match(migration, /grant select on table public\.proposal_delivery_snapshots to service_role/);
  assert.doesNotMatch(migration, /grant[^;]*insert[^;]*proposal_delivery_snapshots[^;]*service_role/i);
});

test("the one-time R2 correction is exact, guarded, and snapshot-only", () => {
  assert.match(correction, /38e0e39c-4310-4864-944f-b4ba4ac4d5ef/);
  assert.match(correction, /PROP-20261007-4229-R2/);
  assert.match(correction, /proposal_before\.status is distinct from 'Sent'/);
  assert.match(correction, /proposal_before\.is_current_revision is not true/);
  assert.match(correction, /public\.service_agreements/);
  assert.match(correction, /public\.jobs/);
  assert.match(correction, /expected_bad_base constant numeric := 285\.85/);
  assert.match(correction, /corrected_base constant numeric := 350\.00/);
  assert.match(correction, /expected_total constant numeric := 400\.00/);
  assert.match(correction, /Interior Refrigerator/);
  assert.match(correction, /Existing delivered snapshot preserved/);
  assert.match(correction, /set_config\('studioscrubz\.controlled_delivery_snapshot', 'on', true\)/);
  assert.match(correction, /set client_delivery_snapshot = expected_snapshot/);
  assert.doesNotMatch(correction, /set\s+result\s*=/i);
  assert.match(correction, /Pricing Presentation Corrected/);
  assert.match(correction, /to_jsonb\(proposal_after\) - array\['client_delivery_snapshot', 'updated_at'\]/);
});

test("the correction fails closed when already applied and captures a new immutable payload", () => {
  assert.match(correction, /correction may already be applied/);
  assert.match(correction, /snapshot\.client_snapshot = proposal_before\.client_delivery_snapshot/);
  assert.match(correction, /snapshot\.client_snapshot = expected_snapshot/);
  assert.match(correction, /history_count_before <> 0/);
  assert.match(correction, /transaction will roll back/);
  assert.match(correction, /begin;[\s\S]*commit;/);
});

test("post-correction verification is explicitly read-only and covers preserved records", () => {
  assert.match(verification, /begin transaction read only/);
  assert.match(verification, /public\.proposal_delivery_snapshots/);
  assert.match(verification, /public\.proposal_history/);
  assert.match(verification, /public\.client_communications/);
  assert.doesNotMatch(verification, /\b(update|insert|delete|alter|create|drop)\b/i);
});

test("historical revisions are visibly superseded and never actionable", () => {
  assert.match(page, /This proposal has been superseded — read-only/);
  assert.match(page, /const actionable = displayed\.is_current_revision && !displayed\.superseded/);
  assert.match(page, /actionable && \(proposal\.status === "Sent" \|\| proposal\.status === "Viewed"\)/);
});

test("R2 comparison reports the inherited 350 baseline and intentional 50 add-on", () => {
  const r1 = revision(1);
  const r2 = revision(2, {
    adjustments: [{ id: "fridge", label: "Interior Refrigerator", amount: 50 }],
    per_visit_total: 400,
  });
  const changes = compareProposalRevisions(r1, r2);
  assert.deepEqual(JSON.parse(JSON.stringify(changes)), [
    { category: "Add-on", kind: "Added", label: "Interior Refrigerator", current: "$50.00", amountDelta: 50 },
    { category: "Price", kind: "Modified", label: "Final per-visit total", previous: "$350.00", current: "$400.00", amountDelta: 50 },
  ]);
});

test("comparison identifies modified discounts, frequency, service, and scope", () => {
  const changes = compareProposalRevisions(
    revision(1, { scope: [{ id: "room", text: "Control room" }] }),
    revision(2, { service_name: "Studio Plus", frequency: "Weekly", manual_discount: 25, discount: 25, scope: [{ id: "room", text: "Control and live rooms" }] }),
  );
  assert.ok(changes.some((change) => change.category === "Service" && change.kind === "Modified"));
  assert.ok(changes.some((change) => change.category === "Frequency" && change.kind === "Modified"));
  assert.ok(changes.some((change) => change.category === "Discount" && change.kind === "Modified"));
  assert.ok(changes.some((change) => change.category === "Scope" && change.kind === "Modified"));
});

test("corrected snapshots render the authoritative Proposal baseline", () => {
  assert.match(document, /base_price:p\.result\.baseEstimateAmount/);
  assert.doesNotMatch(document, /base_price:p\.estimate\?\.result\.oneTimePrice/);
  assert.match(migration, /'base_price', delivery\.proposal_result->'baseEstimateAmount'/);
});
