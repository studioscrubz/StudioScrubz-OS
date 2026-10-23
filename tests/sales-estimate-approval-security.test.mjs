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
  assert.match(migration,/role_name NOT IN \('Manager','Master Admin'\)/);
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
