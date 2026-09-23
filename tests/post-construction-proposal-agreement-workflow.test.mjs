import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const builder = read("components/proposals/ProposalBuilder.tsx");
const document = read("components/proposals/ProposalDocument.tsx");
const proposalTypes = read("types/proposal.ts");
const agreementPricing = read("lib/pricing/agreementPricing.ts");
const agreementService = read("lib/services/agreements.ts");
const agreementUi = read("components/agreements/AgreementsPage.tsx");
const proposalUi = read("components/proposals/OpenProposalsPage.tsx");
const migration = read("supabase/migrations/20260923182045_post_construction_proposal_duration_agreement_handoff.sql");

test("V2 and legacy Post-Construction duration snapshots are inherited without labor-derived days", () => {
  assert.match(proposalTypes, /estimatedCleaningDays\?: number \| null/);
  assert.match(proposalTypes, /estimatedHoursPerDay\?: number \| null/);
  assert.match(builder, /project\?\.plannedProjectDays \?\? input\.targetProjectDays/);
  assert.match(builder, /project\?\.workdayHours \?\? input\.workdayHours/);
  assert.doesNotMatch(builder, /estimatedCleaningDays[^\n]*(laborHours|estimatedDuration)/);
});

test("staff can edit validated duration fields and proposal recalculation preserves them", () => {
  assert.match(builder, /Estimated Cleaning Days/);
  assert.match(builder, /Estimated Hours Per Day \(optional\)/);
  assert.match(builder, /validDuration\(estimatedCleaningDays, 365\)/);
  assert.match(builder, /validDuration\(estimatedHoursPerDay, 24, true\)/);
  assert.match(builder, /estimatedCleaningDays: postConstruction/);
  assert.match(builder, /estimatedHoursPerDay: postConstruction/);
});

test("delivery snapshot and public printable document expose only customer duration wording", () => {
  assert.match(document, /estimated_cleaning_days:d\.estimated_cleaning_days/);
  assert.match(document, /Estimated cleaning duration: approximately/);
  assert.match(document, /up to \$\{formatNumber\(document\.estimated_hours_per_day\)\} hours per day/);
  assert.match(document, /This is an estimate\. Actual timing may vary based on site readiness, access, construction conditions, and approved scope\./);
  assert.doesNotMatch(document, /laborCost|profitability|person-hours|projectedGrossMargin/);
});

test("acceptance creates one idempotent unsent Draft Agreement without Jobs or delivery", () => {
  assert.match(migration, /after update of status, accepted on public\.proposals/);
  assert.match(migration, /private\.ensure_post_construction_draft_agreement\(new\.id\)/);
  assert.match(migration, /drop index if exists public\.one_active_agreement_per_proposal;\s+create unique index one_active_agreement_per_proposal/s);
  assert.match(migration, /where proposal_id is not null\s+and archived_at is null\s+and status not in \('Cancelled', 'Archived'\)/s);
  assert.doesNotMatch(migration, /create unique index if not exists one_active_agreement_per_proposal/);
  assert.match(migration, /'Draft', proposal_row\.notes/);
  assert.match(migration, /client_access_token is not null/);
  assert.doesNotMatch(migration, /insert into public\.jobs/);
  assert.match(migration, /Post-Construction Jobs must be created downstream of the Service Agreement workflow/);
  assert.doesNotMatch(migration, /send_email|send_sms|deliverDocument/);
  assert.match(migration, /accepted_pricing_allocation', proposal_row\.result->'acceptedPricingAllocation'/);
  assert.match(migration, /accepted_proposal_result', proposal_row\.result/);
  assert.match(migration, /catalog_addons'.*proposal_row\.result->'adjustments'/s);
  assert.match(agreementPricing, /estimated_cleaning_days/);
  assert.match(proposalUi, /autoDraft=\{p\.frequency === "One-Time"\}/);
});

test("Draft deletion is management-only, locked, dependency-free, and regenerable", () => {
  assert.match(migration, /has_any_role\(array\['Master Admin','Administrator','Manager'\]\)/);
  assert.match(migration, /where id = p_agreement_id\s+for update/s);
  assert.match(migration, /Only a pristine, never-sent Draft Agreement can be deleted/);
  assert.match(migration, /agreement_row\.proposal_id is not null\s+and exists \(\s+select 1\s+from public\.jobs job\s+where job\.proposal_id = agreement_row\.proposal_id\s+and job\.archived_at is null/s);
  for (const dependency of ["service_occurrences", "invoices", "payments", "property_service_plans", "service_agreement_documents", "client_communications", "jobs"]) assert.match(migration, new RegExp(`public\\.${dependency}`));
  assert.match(migration, /delete from public\.service_agreements/);
  assert.match(migration, /revoke delete on public\.service_agreements from authenticated/);
  assert.match(migration, /create_post_construction_draft_agreement/);
  assert.doesNotMatch(migration.match(/if v_previous_status = 'Accepted'[\s\S]*?end if;/)?.[0] ?? "", /ensure_post_construction/);
  assert.match(agreementService, /delete_unsent_draft_service_agreement/);
  assert.match(agreementUi, /Delete Draft/);
  assert.match(agreementUi, /The accepted Proposal will remain unchanged/);
});

test("non-Post-Construction one-time and recurring proposal routing remains unchanged", () => {
  assert.match(proposalUi, /isRecurringFrequency\(p\.frequency\)/);
  assert.match(proposalUi, /p\.frequency === "One-Time"/);
  assert.match(proposalUi, /post\[- \]construction/i);
  assert.match(proposalUi, /<ProposalJobAction proposalId=\{p\.id\}/);
});
