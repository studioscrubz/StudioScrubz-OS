import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration=readFileSync("supabase/migrations/20260923200258_post_construction_deposit_workflow.sql","utf8");
const proposal=readFileSync("components/proposals/ProposalDocument.tsx","utf8");
const publicPage=readFileSync("components/proposals/PublicProposalPage.tsx","utf8");
const acceptance=readFileSync("app/api/public/proposals/accept/route.ts","utf8");
const email=readFileSync("lib/email/postConstructionDeposit.ts","utf8");
const agreements=readFileSync("lib/services/agreements.ts","utf8");
const revenue=readFileSync("lib/services/revenue.ts","utf8");

test("deposit settings stay out of the public settings projection and are validated",()=>{
  assert.match(migration,/post_construction_deposit_percent numeric\(5,2\) not null default 25\.00/);
  assert.match(migration,/post_construction_payment_method = 'Zelle'/);
  assert.match(migration,/post_construction_payment_recipient_phone ~ '\^\[0-9\]\{10,15\}\$'/);
  const workflow=migration.match(/create or replace view public\.business_settings_workflow[\s\S]*?grant select on public\.business_settings_workflow/)?.[0]??"";
  assert.match(workflow,/post_construction_payment_recipient_name/);
  assert.doesNotMatch(migration,/create or replace view public\.business_settings_public[\s\S]*post_construction_payment/);
});

test("sent Proposal snapshot uses final total and rounds the required deposit once",()=>{
  assert.match(proposal,/Math\.round\(d\.per_visit_total\*percent\)\/100/);
  assert.match(migration,/proposal_row\.client_delivery_snapshot->>'per_visit_total'/);
  assert.match(migration,/required_amount := round\(accepted_total\*deposit_percent\/100,2\)/);
  assert.match(migration,/remaining_balance = round\(accepted_total - required_amount, 2\)/);
  assert.match(proposal,/Required deposit/);assert.match(proposal,/Remaining balance after deposit/);
  assert.match(proposal,/Scheduling is not confirmed until StudioScrubz verifies receipt/);
});

test("acceptance atomically and idempotently ensures the Draft and requirement without payment",()=>{
  assert.match(migration,/private\.ensure_post_construction_acceptance_handoff/);
  assert.match(migration,/agreement_id:=private\.ensure_post_construction_draft_agreement/);
  assert.match(migration,/unique references public\.proposals/);
  const acceptanceRpc=migration.match(/create or replace function public\.accept_proposal_by_token[\s\S]*?grant execute on function public\.accept_proposal_by_token/)?.[0]??"";
  assert.match(acceptanceRpc,/ensure_post_construction_acceptance_handoff/);
  assert.doesNotMatch(acceptanceRpc,/insert into public\.payments/);
});

test("accepted token exposes only snapshotted instructions",()=>{
  const getter=migration.match(/create or replace function public\.get_proposal_by_token[\s\S]*?grant execute on function public\.get_proposal_by_token/)?.[0]??"";
  assert.match(getter,/'deposit_instructions'/);assert.match(getter,/p\.status='Accepted'/);
  assert.doesNotMatch(getter,/post_construction_payment_recipient_name/);
  assert.match(publicPage,/Sending payment does not automatically confirm receipt/);
});

test("confirmation is management-only, server-calculated, audited, and idempotent",()=>{
  const fn=migration.match(/create or replace function public\.confirm_post_construction_deposit[\s\S]*?create or replace function public\.refresh/)?.[0]??"";
  assert.match(fn,/\['Master Admin','Administrator','Manager'\]/);
  assert.match(fn,/proposal_row[\s\S]*agreement_row[\s\S]*requirement_row[\s\S]*payment_row/);
  assert.match(fn,/requirement_row\.required_amount/);assert.match(fn,/deposit_requirement_id/);assert.match(fn,/'Received'/);
  assert.doesNotMatch(fn,/service_occurrences|insert into public\.jobs|client_communications/);
});

test("Agreement send is gated in both RPC and trigger",()=>{
  assert.match(agreements,/mark_service_agreement_sent_for_delivery/);
  assert.match(migration,/service_agreements_require_pc_deposit_before_send/);
  assert.equal((migration.match(/Deposit confirmation required before this Agreement can be sent\./g)??[]).length>=2,true);
  assert.match(migration,/payment\.voided_at is null/);
});

test("reversal retains the payment and excludes voided money",()=>{
  const reversal=migration.match(/create or replace function public\.reverse_post_construction_deposit[\s\S]*?create or replace function public\.reopen/)?.[0]??"";
  assert.match(reversal,/voided_at=now\(\)/);assert.doesNotMatch(reversal,/delete from public\.payments/);
  assert.match(migration,/sum\(amount\)[\s\S]*voided_at is null/);
  assert.match(revenue,/from\("payments"\)\.select\(paymentSelect\)\.is\("voided_at",null\)/);
});

test("every invoice payment read added to the deposit migration excludes voided payments",()=>{
  const squareV1=migration.match(/create or replace function public\.record_square_invoice_payment\([\s\S]*?create or replace function public\.record_square_invoice_payment_v2/)?.[0]??"";
  const squareV2=migration.match(/create or replace function public\.record_square_invoice_payment_v2\([\s\S]*?create or replace function public\.get_invoice_by_token/)?.[0]??"";
  const invoiceToken=migration.match(/create or replace function public\.get_invoice_by_token\([\s\S]*?notify pgrst/)?.[0]??"";
  assert.equal((squareV1.match(/and payment\.voided_at is null/g)??[]).length,2);
  assert.equal((squareV2.match(/and payment\.voided_at is null/g)??[]).length,2);
  assert.equal((invoiceToken.match(/and p\.voided_at is null/g)??[]).length,1);
});

test("completed Job invoice stays full price and applies the deposit once",()=>{
  const invoice=migration.match(/create or replace function public\.create_completed_job_invoice[\s\S]*?revoke all on function public\.create_completed_job_invoice/)?.[0]??"";
  assert.match(invoice,/amount:=job_row\.price/);assert.match(invoice,/total,amount_paid,balance_due/);
  assert.match(invoice,/update public\.payments set invoice_id=invoice_id/);
  assert.match(invoice,/'Applied To Invoice'/);assert.match(migration,/one_active_payment_per_deposit_requirement/);
});

test("acceptance email is failure-isolated, idempotent, and email-only",()=>{
  assert.match(acceptance,/try \{ await sendPostConstructionDepositInstructions/);
  assert.match(email,/proposal:\$\{proposal\.id\}:deposit-instructions:\$\{d\.instruction_version\}/);
  assert.match(email,/status:"Prepared"/);assert.match(email,/status:"Sent"/);assert.match(email,/status:"Failed"/);
  assert.doesNotMatch(email,/channel:\s*["']SMS["']/);
});
