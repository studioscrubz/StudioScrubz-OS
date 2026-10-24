import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import ts from "typescript";
const read=path=>readFileSync(path,"utf8");
const migration=read("supabase/migrations/20261023132000_sales_estimate_approval_guards.sql");
const estimates=read("lib/services/estimates.ts");
const proposals=read("lib/services/proposals.ts");
const open=read("components/estimates/OpenEstimatesPage.tsx");
const attention=read("lib/services/attention.ts");
const component=read("components/estimates/EstimateApprovalControls.tsx");
const permissions=read("lib/auth/permissions.ts");
const estimateWriteRoute=read("app/api/sales-pipeline/estimates/route.ts");
const proposalWriteRoute=read("app/api/sales-pipeline/proposals/route.ts");
const walkthroughWriteRoute=read("app/api/sales-pipeline/walkthroughs/route.ts");
const pricingReviewRoute=read("app/api/walkthroughs/pricing-review/route.ts");
test("approval states and server-side deliverability guard exist",()=>{
  assert.match(migration,/ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'Draft'/);
  assert.match(migration,/approval_version integer NOT NULL DEFAULT 1/);
  assert.match(migration,/CREATE OR REPLACE FUNCTION public\.review_estimate_approval/);
  assert.match(migration,/CREATE OR REPLACE FUNCTION public\.submit_estimate_for_approval/);
  assert.match(migration,/CREATE TRIGGER estimates_approval_delivery_guard/);
  assert.match(migration,/CREATE TRIGGER proposals_approval_integrity/);
  assert.match(migration,/private\.estimate_approval_snapshot\(e\)/);
  assert.match(migration,/only Manager|only Managers|Only Managers and Master Admin/i);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS public\.estimate_approval_history/);
  assert.match(migration,/CREATE OR REPLACE FUNCTION public\.review_proposal_approval/);
});
test("signed-in role checks protect approval RPCs and snapshots are not client-supplied",()=>{
  assert.match(migration,/actor uuid:=auth\.uid\(\)/);
  assert.ok(migration.includes("coalesce(role_name, '') NOT IN ('Manager','Master Admin')"));
  assert.match(migration,/Use the estimate approval workflow/);
  assert.match(migration,/Cannot forge a proposal approval snapshot/);
  assert.match(migration,/Proposal approval must be recorded by an authorized reviewer/);
  assert.match(migration,/approved_pricing_snapshot IS DISTINCT FROM private\.estimate_approval_snapshot\(new\)/);
  assert.match(migration,/Source estimate requires approval of its current pricing/);
});
test("review UI allows Sales submit and Manager decisions, blocks unapproved sends",()=>{
  assert.match(estimates,/export async function submitEstimateForApproval/);
  assert.match(estimates,/export async function reviewEstimateApproval/);
  assert.match(component,/canReview = hasPermission\(profile,"estimates\.approve"\)/);
  assert.match(component,/Submit for Approval/);
  assert.match(component,/Request Changes/);
  assert.match(component,/History/);
  assert.match(open,/item\.approval_status==="Approved"&&<button/);
  assert.match(open,/estimate\.approval_status!=="Approved"/);
  assert.match(open,/onApprovalChanged=\{refresh\}/);
});
test("proposal decisions are made by audited server-side RPC",()=>{
  assert.match(proposals,/public async|review_proposal_approval/);
  assert.match(proposals,/p_decision:"Approved"/);
  assert.match(proposals,/p_decision:"Changes Requested"/);
  assert.match(permissions,/"estimates\.approve"/);
  assert.match(attention,/Estimate Awaiting Approval/);
  assert.match(attention,/Estimate Changes Requested/);
});
test("Lead Representative payout and attribution unchanged",()=>{
  assert.doesNotMatch(migration,/ALTER TABLE public\.lead_representatives|UPDATE public\.lead_representative_commissions/i);
  assert.match(permissions,/"Lead Representative": new Set\(\[/);
});

test("migration function terminators and PL/pgSQL declaration structure",()=>{
  const normalized=migration.replaceAll("\r\n","\n");
  assert.ok(normalized.includes(["DECLARE","  valid_review boolean;","  source_id uuid;","  e public.estimates;"].join("\n")));
  assert.ok(normalized.includes(["end;","$function$;","","","CREATE OR REPLACE FUNCTION public.review_proposal_approval"].join("\n")));
});

test("Sales writes use server-authorized paths and cannot submit raw protected JSON",()=>{
  assert.match(migration,/service_save_sales_estimate/);
  assert.match(migration,/GRANT EXECUTE ON FUNCTION public\.service_save_sales_estimate\(uuid,uuid,jsonb,jsonb\) TO service_role/);
  assert.match(migration,/CREATE POLICY %I ON public\.%I AS RESTRICTIVE FOR ALL/);
  assert.match(migration,/submit_proposal_for_approval/);
  for(const route of [estimateWriteRoute,proposalWriteRoute,walkthroughWriteRoute]){
    assert.match(route,/profile\.role\s*!==\s*"Sales"/);
    assert.match(route,/createSupabaseAdminClient/);
  }
  assert.match(estimateWriteRoute,/calculateSalesEstimate/);
  assert.match(proposalWriteRoute,/source\.laborCost/);
  assert.match(walkthroughWriteRoute,/protectedMeasurementKeys/);
  assert.match(pricingReviewRoute,/\["Manager", "Master Admin"\]\.includes\(profile\.role\)/);
});

test("pricing revisions are audited and cannot silently reuse prior approvals",()=>{
  assert.match(migration,/CREATE OR REPLACE FUNCTION private\.audit_estimate_approval_invalidation/);
  assert.match(migration,/CREATE TRIGGER estimates_approval_revision_audit AFTER UPDATE/);
  assert.match(migration,/new\.approval_version > old\.approval_version/);
  assert.match(migration,/old\.approval_version,'Revision Required',actor,old\.approval_status,new\.approval_status/);
  assert.match(migration,/Authenticated user required to revise reviewed pricing/);
});
test("new estimates and proposals cannot forge reviewer metadata on INSERT",()=>{
  assert.match(migration,/Estimate approval audit fields are server-generated/);
  assert.match(migration,/New proposals must begin unapproved and unsent/);
  assert.match(migration,/new\.status <> 'Draft' OR new\.approval_status <> 'Not Submitted'/);
});

test("Sales cannot directly SELECT private estimate, proposal, walkthrough or catalog JSON",()=>{
  assert.match(migration,/AS RESTRICTIVE FOR SELECT TO authenticated/);
  assert.match(migration,/\['estimates','proposals','walkthroughs','services','service_addons','service_price_tiers','recurring_pricing_rules'\]/);
  assert.match(migration,/CREATE OR REPLACE FUNCTION public\.read_sales_estimates\(\)/);
  assert.match(migration,/CREATE OR REPLACE FUNCTION public\.read_sales_proposals\(\)/);
  assert.match(migration,/CREATE OR REPLACE FUNCTION public\.read_sales_walkthroughs\(\)/);
  assert.match(migration,/CREATE OR REPLACE FUNCTION public\.read_sales_catalog\(\)/);
  assert.match(migration,/p\.is_active AND p\.role='Sales'/);
  assert.match(migration,/private\.sales_public_estimate_result\(e\.result\)/);
  assert.match(migration,/private\.sales_public_proposal_result\(p\.result\)/);
  assert.match(migration,/REVOKE ALL ON FUNCTION public\.read_sales_estimates\(\) FROM PUBLIC,anon/);
  assert.match(migration,/REVOKE ALL ON FUNCTION public\.read_sales_catalog\(\) FROM PUBLIC,anon/);
});
test("Client Sales reads must route through authenticated safe RPCs",()=>{
  const projection=read("lib/services/salesPipeline.ts");
  const catalog=read("lib/services/serviceCatalog.ts");
  const walkthroughs=read("lib/services/walkthroughs.ts");
  assert.match(projection,/usesSalesPipelineProjection/);
  assert.match(projection,/getCurrentProfile\(\)/);
  assert.match(estimates,/readSalesPipeline<EstimateWithRelations>\("read_sales_estimates"\)/);
  assert.match(proposals,/readSalesPipeline<ProposalWithRelations>\("read_sales_proposals"\)/);
  assert.match(walkthroughs,/readSalesPipeline<WalkthroughWithRelations>\("read_sales_walkthroughs"\)/);
  assert.match(catalog,/readSalesPipeline<ServiceCatalogBundle>\("read_sales_catalog"\)/);
});
