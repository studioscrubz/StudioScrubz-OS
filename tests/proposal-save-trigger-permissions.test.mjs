import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20261027201500_proposal_approval_trigger_invoker_fix.sql", "utf8");
const builder = readFileSync("components/proposals/ProposalBuilder.tsx", "utf8");

test("proposal approval trigger runs as invoker without calling revoked private snapshot helpers", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION private\.proposal_approval_integrity\(\)/);
  assert.match(migration, /RETURNS trigger\s+LANGUAGE plpgsql/);
  assert.doesNotMatch(migration, /LANGUAGE plpgsql\s+SECURITY DEFINER/i);
  assert.doesNotMatch(migration, /GRANT\s+(?:ALL|EXECUTE|USAGE)/i);
  assert.doesNotMatch(migration, /private\.proposal_approved_snapshot\(new\)/);
  assert.doesNotMatch(migration, /private\.proposal_approved_snapshot\(old\)/);
  assert.doesNotMatch(migration, /private\.estimate_approval_snapshot\(e\)/);
  assert.match(migration, /old_snapshot := pg_catalog\.jsonb_build_object/);
  assert.match(migration, /new_snapshot := pg_catalog\.jsonb_build_object/);
  assert.match(migration, /'result',new\.result,'notes',new\.notes,'frequency',new\.frequency/);
  assert.match(migration, /'expiration_date',new\.expiration_date,'estimate_id',new\.estimate_id/);
  assert.match(migration, /'client_id',e\.client_id,'property_id',e\.property_id/);
  assert.match(migration, /'frequency',e\.frequency,'service_name',e\.service_name/);
});

test("approval enforcement and delivery guards stay in place for reviewed and sent proposals", () => {
  assert.match(migration, /Cannot forge a proposal approval snapshot/);
  assert.match(migration, /Proposal approval must be recorded by an authorized reviewer/);
  assert.match(migration, /old\.approval_status='Pending Approval'/);
  assert.match(migration, /Pending approval cannot be edited/);
  assert.match(migration, /old\.approval_status='Approved'/);
  assert.match(migration, /Approved proposal pricing is immutable/);
  assert.match(migration, /Proposal pricing version has not been approved/);
  assert.match(migration, /Source estimate requires approval of its current pricing/);
  assert.match(migration, /current_setting\('studioscrubz\.proposal_review_rpc',true\)/);
});

test("Proposal Builder shows safe plain-object PostgREST error details", () => {
  assert.match(builder, /x instanceof Error \? x\.message/);
  assert.match(builder, /"message" in x && typeof x\.message === "string"/);
  assert.match(builder, /Proposal save failed/);
});
