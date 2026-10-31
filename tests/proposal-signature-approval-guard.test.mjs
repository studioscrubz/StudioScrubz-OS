import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20261031235000_fix_proposal_signature_approval_guard.sql","utf8");
const sentGuard = readFileSync("supabase/migrations/20261031213000_require_drawn_proposal_acceptance_signature.sql","utf8");

test("both approval and sent-offer guards allow only server-controlled drawn signature acceptance", () => {
  assert.match(migration, /controlled_acceptance boolean/);
  assert.match(migration, /public\.accept_proposal_by_token\(text,text,boolean,text\)/);
  assert.match(migration, /current_user is distinct from digital_acceptance_owner/);
  assert.match(migration, /old\.signature is not null/);
  assert.match(migration, /new\.signature is null/);
  assert.match(migration, /new\.signature is not distinct from old\.signature/);
  assert.equal((migration.match(/'acceptance_method', 'signature', 'client_acceptance_consent'/g) || []).length, 2);
  assert.match(migration, /new\.accepted_at is distinct from new\.client_acceptance_consent_at/);
  assert.match(sentGuard, /new\.signature is distinct from old\.signature/);
  assert.match(sentGuard, /old\.status in \('Sent', 'Viewed'\)/);
});

test("manual acceptance and administrator review paths remain independent", () => {
  assert.match(migration, /controlled_manual_acceptance boolean/);
  assert.match(migration, /public\.record_manual_proposal_acceptance/);
  assert.match(migration, /review_proposal_approval\(uuid,text,text\)/);
  assert.match(migration, /Only Master Admin may change proposal approval or acceptance fields/);
  assert.doesNotMatch(migration, /^\s*(?:begin|commit)\s*;/im);
});
