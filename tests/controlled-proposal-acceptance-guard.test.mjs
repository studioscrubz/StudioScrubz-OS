import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20261011024132_allow_controlled_proposal_acceptance_through_sent_guard.sql", "utf8");

test("sent guard allows only the exact controlled acceptance transition", () => {
  assert.match(migration, /controlled_proposal_acceptance/);
  assert.match(migration, /accept_proposal_by_token\(text,text,boolean\)/);
  assert.match(migration, /current_user is not distinct from acceptance_owner/);
  assert.match(migration, /old\.status in \('Sent', 'Viewed'\)/);
  assert.match(migration, /new\.status = 'Accepted'/);
  assert.match(migration, /old\.is_current_revision[\s\S]*new\.is_current_revision/);
  assert.match(migration, /to_jsonb\(new\) - array\[/);
});

test("commercial content and superseded Proposal protections remain", () => {
  for (const column of ["client_id", "property_id", "estimate_id", "walkthrough_id", "result", "photos", "signature", "expiration_date"]) {
    assert.match(migration, new RegExp(`new\\.${column} is distinct from old\\.${column}`));
  }
  assert.match(migration, /old\.is_current_revision is not true/);
  assert.match(migration, /Sent Proposal revisions are immutable/);
  assert.match(migration, /A superseded Proposal cannot be accepted/);
});
