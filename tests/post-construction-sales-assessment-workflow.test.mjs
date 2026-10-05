import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
const migration=read("supabase/migrations/20260926031557_post_construction_sales_assessment_workflow.sql");
const form=read("components/walkthroughs/WalkthroughFormModal.tsx");
const structured=read("components/walkthroughs/PostConstructionAssessmentFields.tsx");
const workflow=read("lib/walkthroughWorkflow.ts");
const pricing=read("app/api/walkthroughs/pricing-review/route.ts");
const link=read("app/api/walkthroughs/[id]/photo-submission/route.ts");
const upload=read("app/api/public/assessments/[token]/photos/route.ts");
const proposal=read("components/proposals/ProposalBuilder.tsx");
const publicProposal=read("components/proposals/ProposalDocument.tsx");
const agreement=read("supabase/migrations/20260923182045_post_construction_proposal_duration_agreement_handoff.sql");
const assignmentOptions=read("supabase/migrations/20261005142308_master_admin_walkthrough_execution_access.sql");

test("one authoritative Assessment preserves existing Estimate linkage and Proposal idempotency",()=>{
  assert.match(migration,/proposals_one_active_per_walkthrough/);
  assert.match(migration,/where walkthrough_id is not null and archived_at is null/);
  assert.match(form,/estimate_id: mode === "estimate" \? estimateId : null/);
  assert.doesNotMatch(migration,/insert into public\.(jobs|service_agreements|invoices|employees)/);
});

test("qualification, stages, and every structured Post-Construction area are persisted with history",()=>{
  for(const stage of ["Qualification","Contacting","Assessment Method Required","Walkthrough Scheduled","Awaiting Customer Photos","Assessment In Progress","Pricing Review","Proposal Ready","Proposal Created","Closed / Not Proceeding"])assert.ok(migration.includes(`'${stage}'`));
  for(const field of ["projectType","propertyUse","projectPhase","expectedConstructionCompletionDate","desiredReadinessDate","occupancyStatus","dustLevel","debrisCondition","utilities","decisionMakerStatus","contactStatus","nextFollowUpAt","roomsAreas","detailedScope","surfaceMaterials","residues","lightDebrisInScope","exclusions","applianceInteriors","interiorCabinets","workingHourRestrictions","readinessBlockers","siteSafetyConcerns","customerPriorities","internalObservations","recommendedExclusions","proposalNotes"])assert.ok(structured.includes(field),field);
  assert.match(migration,/create table public\.assessment_history/);
  assert.match(migration,/changed_by_user_id uuid references auth\.users/);
  assert.match(migration,/after update of sales_stage, measurements, scope, recommendations/);
});

test("exactly one method is active, scheduling is enforced, and secure tokens are reused",()=>{
  assert.match(form,/value:"On-Site Walkthrough"/);
  assert.match(form,/value:"Customer Photo Submission"/);
  assert.match(workflow,/An in-person walkthrough must have both a scheduled date and scheduled time/);
  assert.match(migration,/must be scheduled before it can begin/);
  assert.match(link,/existing\?\.token_value/);
  assert.match(link,/reused:\s*true/);
  assert.match(link,/token_hash:\s*hashAssessmentToken\(token\)/);
  assert.match(upload,/photos=\[\.\.\./);
  assert.match(upload,/sales_stage:"Assessment In Progress"/);
});

test("new assessments require an eligible walkthrough executor and use the reduced scheduling form",()=>{
  assert.match(form,/<Panel title="Schedule Walkthrough">/);
  assert.match(form,/Assigned Field Representative/);
  assert.match(form,/Select an active Master Admin, Manager, or Crew Lead/);
  assert.match(form,/getEligibleWalkthroughAssignees/);
  assert.match(form,/!walkthrough && !assignedEmployeeId/);
  assert.match(form,/assigned_employee_id: assignedEmployeeId \|\| null/);
  assert.match(assignmentOptions,/public\.has_any_role\(array\['Master Admin', 'Administrator', 'Manager', 'Sales'\]\)/);
  assert.match(assignmentOptions,/employee\.employment_status = 'Active'/);
  assert.match(assignmentOptions,/profile\.is_active/);
  assert.match(assignmentOptions,/profile\.role in \('Master Admin', 'Manager', 'Crew Lead'\)/);
  for(const removed of ["Access Restrictions","Parking / Loading","Water Access","Power Access","Security / Alarm Information","Damage Observed","Hazards Observed","Heavy Soil / Buildup"]){
    assert.doesNotMatch(form,new RegExp(`label="${removed.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}"`));
  }
  assert.match(form,/walkthrough && \/post\[- \]construction\/i\.test\(measurements\.serviceType\)/);
  assert.match(form,/walkthrough && <ListEditor title="Scope"/);
  assert.match(form,/walkthrough && <ListEditor title="Recommendations"/);
  assert.match(form,/walkthrough && <PhotoUploader/);
});

test("V2 pricing keeps person-hours, crew, workday, planned days, and completion duration distinct",()=>{
  const calculator=read("lib/pricing/postConstruction.ts");
  for(const term of ["estimatedPersonHours","crewSize","plannedProjectDays","workdayHours","estimatedCompletionDays"])assert.ok(calculator.includes(term),term);
  assert.match(pricing,/assessmentReadyForPricing\(walkthrough\)/);
  assert.match(workflow,/postConstructionAssessment/);
  assert.match(pricing,/sales_stage: "Proposal Ready"/);
});

test("customer Proposal remains cost-safe and existing acceptance/deposit/Agreement routing is unchanged",()=>{
  assert.match(proposal,/pricing_review\?\.estimateResult/);
  assert.match(proposal,/estimatedCleaningDays/);
  assert.match(proposal,/estimatedHoursPerDay/);
  assert.match(publicProposal,/Estimated cleaning duration/);
  assert.doesNotMatch(publicProposal,/workerHourlyPay|laborCost|projectedGrossMargin|profitability/);
  assert.match(agreement,/Post-Construction Jobs must be created downstream of the Service Agreement workflow/);
  assert.match(agreement,/private\.ensure_post_construction_draft_agreement/);
});

test("RLS and narrow RPC grants preserve role boundaries",()=>{
  assert.match(migration,/alter table public\.assessment_history enable row level security/);
  assert.match(migration,/revoke all on table public\.assessment_history from public, anon, authenticated/);
  assert.match(migration,/grant select on table public\.assessment_history to authenticated/);
  assert.match(migration,/security definer\s+set search_path = ''/g);
  assert.match(migration,/revoke all on function public\.transition_post_construction_assessment\(uuid, text\)/);
  assert.match(migration,/array\['Master Admin', 'Administrator', 'Manager', 'Sales'\]/);
  assert.doesNotMatch(migration,/grant (insert|update|delete).*assessment_history to authenticated/i);
});


