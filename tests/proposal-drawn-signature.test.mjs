import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const ui = read("components/proposals/PublicProposalPage.tsx");
const client = read("lib/services/publicProposals.ts");
const route = read("app/api/public/proposals/accept/route.ts");
const migration = read("supabase/migrations/20261031213000_require_drawn_proposal_acceptance_signature.sql");

test("proposal acceptance collects a drawn signature and blocks unsigned requests", () => {
  assert.match(ui, /<SignaturePad onChange=\{setSignature\}/);
  assert.match(ui, /!signature/);
  assert.match(ui, /acceptPublicProposal\(token, name, consent, signature \?\? ""\)/);
  assert.match(client, /JSON\.stringify\(\{token,acceptedName,consent,signature\}\)/);
});

test("server checks actual PNG ink before restricted acceptance RPC", () => {
  assert.match(route, /validateDrawnPngSignature\(signature\)/);
  assert.match(route, /createSupabaseAdminClient\(\)\.rpc\("accept_proposal_by_token"/);
  assert.match(route, /p_signature: signature/);
  assert.doesNotMatch(route, /createSupabaseServerClient/);
});

test("database accepts signature only in validated acceptance transaction on current approved revision", () => {
  assert.match(migration, /accept_proposal_by_token\(text,text,boolean,text\)/);
  assert.match(migration, /revoke all on function public\.accept_proposal_by_token\(text,text,boolean\) from public, anon, authenticated, service_role/);
  assert.match(migration, /grant execute on function public\.accept_proposal_by_token\(text,text,boolean,text\) to service_role/);
  assert.match(migration, /approval_status = 'Approved'/);
  assert.match(migration, /is_current_revision = true/);
  assert.match(migration, /signature = p_signature/);
  assert.match(migration, /new\.signature is distinct from old\.signature/);
  assert.match(migration, /old\.status in \('Sent', 'Viewed'\)/);
  assert.match(migration, /private\.ensure_post_construction_acceptance_handoff\(v_id\)/);
});
