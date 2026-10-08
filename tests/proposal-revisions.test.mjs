import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration=readFileSync(new URL("../supabase/migrations/20261007194500_proposal_revision_foundation.sql",import.meta.url),"utf8");
const service=readFileSync(new URL("../lib/services/proposals.ts",import.meta.url),"utf8");
const delivery=readFileSync(new URL("../lib/services/unifiedDocumentDelivery.ts",import.meta.url),"utf8");
const page=readFileSync(new URL("../components/proposals/OpenProposalsPage.tsx",import.meta.url),"utf8");
const publicPage=readFileSync(new URL("../components/proposals/PublicProposalPage.tsx",import.meta.url),"utf8");

test("existing proposals backfill as V1 and normal inserts self-group",()=>{
  assert.match(migration,/revision_group_id=coalesce\(revision_group_id,id\)/);
  assert.match(migration,/revision_number=coalesce\(revision_number,1\)/);
  assert.match(migration,/new\.revision_group_id:=new\.id/);
});

test("revision creation is authorized, copied, reset, and concurrency safe",()=>{
  assert.match(migration,/has_any_role\(array\['Master Admin','Administrator','Sales'\]\)/);
  assert.match(migration,/source\.result,source\.photos,null,'Draft','Not Submitted'/);
  assert.match(migration,/proposals_one_open_revision_uidx/);
  assert.match(migration,/proposals_revision_group_number_uidx/);
  assert.match(migration,/for update/);
  assert.match(service,/create_proposal_revision/);
});

test("draft revision leaves V1 active and successful send supersedes atomically",()=>{
  assert.match(migration,/source\.revision_group_id,next_revision,source\.id,false,null/);
  assert.match(migration,/set is_current_revision=false,superseded_at=sent_time/);
  assert.match(migration,/set is_current_revision=true,superseded_at=null/);
  assert.ok(migration.indexOf("set is_current_revision=false,superseded_at=sent_time")<migration.indexOf("set status='Sent'"));
});

test("delivery preparation precedes provider work and finalization follows success",()=>{
  assert.ok(delivery.indexOf("await input.prepare")<delivery.indexOf("await sendTransactionalCustomerEmail"));
  assert.ok(delivery.indexOf("if (emailStatus !== \"Sent\"")<delivery.indexOf("await input.complete?."));
  assert.match(page,/prepareProposalDelivery/);
  assert.match(page,/complete: async/);
  assert.match(page,/requestId: `proposal-/);
});

test("superseded and accepted races are rejected server-side",()=>{
  assert.match(migration,/not v_current then raise exception 'This Proposal has been revised/);
  assert.match(migration,/prior Proposal was accepted before this revision could be activated/);
  assert.match(migration,/A superseded Proposal cannot be accepted/);
  assert.match(migration,/perform 1 from public\.proposals p where p\.revision_group_id=v_group for update/);
});

test("public history is readable but superseded links are not actionable",()=>{
  assert.match(migration,/'superseded',not p\.is_current_revision/);
  assert.match(publicPage,/This proposal has been superseded/);
  assert.match(publicPage,/!proposal\.superseded/);
  assert.match(page,/Create Revision/);
  assert.match(page,/Superseded · read-only/);
});

test("post-construction acceptance handoff remains authoritative",()=>{
  assert.match(migration,/private\.ensure_post_construction_acceptance_handoff\(v_id\)/);
  assert.match(migration,/deposit_instructions/);
  assert.match(migration,/required_deposit_amount/);
});

test("estimate and walkthrough association supports one family with many versions",()=>{
  assert.match(migration,/proposals_origin_estimate_uidx[\s\S]*revision_number=1/);
  assert.match(migration,/proposals_origin_walkthrough_uidx[\s\S]*revision_number=1/);
  assert.match(service,/order\("revision_number",\{ascending:false\}\)\.limit\(1\)/);
});
