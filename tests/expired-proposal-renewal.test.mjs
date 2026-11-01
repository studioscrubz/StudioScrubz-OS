import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20261101090000_renew_expired_proposal_as_draft_revision.sql","utf8");
const service = readFileSync("lib/services/proposals.ts","utf8");
const page = readFileSync("components/proposals/OpenProposalsPage.tsx","utf8");

test("renewal creates a new draft revision from an expired, current, unaccepted proposal", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.renew_expired_proposal\(p_proposal_id uuid, p_expiration_date date\)/);
  assert.match(migration, /source\.status <> 'Expired'/);
  assert.match(migration, /source\.accepted/);
  assert.match(migration, /not source\.is_current_revision/);
  assert.match(migration, /regexp_replace\(source\.proposal_number, '\(-R/);
  assert.match(migration, /'Draft', 'Not Submitted'/);
  assert.match(migration, /p_expiration_date, null/);
  assert.match(migration, /created\.id, 'Proposal Renewed'/);
  assert.doesNotMatch(migration, /update public\.proposals/);
});

test("renewal is restricted to authorized roles and rejects invalid dates", () => {
  assert.match(migration, /p_expiration_date <= current_date/);
  assert.match(migration, /auth\.uid\(\) is null/);
  assert.match(migration, /public\.has_any_role\(array\['Master Admin','Administrator','Sales'\]\)/);
  assert.match(migration, /This Proposal already has an open draft revision/);
  assert.match(migration, /revoke all on function public\.renew_expired_proposal\(uuid,date\)/);
  assert.match(service, /getSupabaseClient\(\).*?\.rpc\("renew_expired_proposal"/);
  assert.doesNotMatch(service, /renewProposal=\(id:string,expiration:string\)=>updateProposalStatus/);
});

test("Renew opens the revised draft for pricing review and fresh approval", () => {
  assert.match(page, /renew=\{async\(p,expiration\)=>/);
  assert.match(page, /setEdit\(revision\)/);
  assert.match(page, /Review pricing and submit for approval/);
  assert.match(page, /<Action t="Renew" disabled=\{busy \|\| !canCreate\}/);
});
