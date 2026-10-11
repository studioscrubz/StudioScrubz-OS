import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parsePublicJsonResponse } from "../lib/services/publicJsonResponse.ts";

test("returns a successful JSON acceptance response", async () => {
  const payload = { status: "Accepted", accepted: true };
  assert.deepEqual(await parsePublicJsonResponse(Response.json(payload), "fallback"), payload);
});

test("turns an empty successful response into a safe reconciliation message", async () => {
  await assert.rejects(parsePublicJsonResponse(new Response(null, { status: 200 }), "fallback"), /Refresh this page to confirm whether your request completed/);
});

test("turns malformed successful JSON into a safe reconciliation message", async () => {
  await assert.rejects(parsePublicJsonResponse(new Response("not-json", { status: 200 }), "fallback"), /Refresh this page to confirm whether your request completed/);
});

test("preserves a safe JSON error from a non-2xx response", async () => {
  await assert.rejects(parsePublicJsonResponse(Response.json({ error: "This Proposal is no longer available." }, { status: 409 }), "fallback"), /This Proposal is no longer available/);
});

test("uses the safe fallback for empty and malformed non-2xx responses", async () => {
  await assert.rejects(parsePublicJsonResponse(new Response(null, { status: 504 }), "Acceptance could not be confirmed."), /Acceptance could not be confirmed/);
  await assert.rejects(parsePublicJsonResponse(new Response("gateway", { status: 502 }), "Acceptance could not be confirmed."), /Acceptance could not be confirmed/);
});

test("an already accepted Proposal is reconciled without repeating acceptance effects", () => {
  const migration = readFileSync("supabase/migrations/20261007194500_proposal_revision_foundation.sql", "utf8");
  const rpc = migration.match(/create or replace function public\.accept_proposal_by_token[\s\S]*?revoke all on function public\.accept_proposal_by_token/)?.[0] ?? "";
  const replayBranch = rpc.match(/if v_previous_status='Accepted'[\s\S]*?end if;/)?.[0] ?? "";

  assert.match(replayBranch, /ensure_post_construction_acceptance_handoff/);
  assert.match(replayBranch, /return public\.get_proposal_by_token/);
  assert.doesNotMatch(replayBranch, /insert into public\.proposal_history|update public\.proposals/);
});
