import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../supabase/migrations/20261009100000_proposal_activity_tracker.sql");
const publicPage = read("../components/proposals/PublicProposalPage.tsx");
const publicService = read("../lib/services/publicProposals.ts");
const proposals = read("../lib/services/proposals.ts");
const proposalsPage = read("../components/proposals/OpenProposalsPage.tsx");
const attention = read("../lib/services/attention.ts");
const attentionTypes = read("../types/attention.ts");
const declineRoute = read("../app/api/public/proposals/decline/route.ts");
const viewRoute = read("../app/api/public/proposals/view/route.ts");
const rateLimit = read("../lib/proposalPublicRateLimit.ts");

test("public views are token-scoped and recorded only on the first Sent-to-Viewed transition", () => {
  assert.match(migration, /create or replace function public\.record_proposal_view_by_token\(p_token text\)/);
  assert.match(migration, /for update/);
  assert.match(migration, /if proposal_row\.status = 'Sent' and proposal_row\.is_current_revision then/);
  assert.match(migration, /where id = proposal_row\.id\s+and status = 'Sent'/);
  assert.match(migration, /insert into public\.proposal_history[\s\S]*'Viewed', 'Sent', 'Viewed'/);
  assert.match(publicService, /fetch\("\/api\/public\/proposals\/view"/);
  assert.match(publicPage, /recordPublicProposalView\(token\)/);
});

test("client decline is revision-aware, race-safe, and preserves offer snapshots", () => {
  assert.match(migration, /create or replace function public\.decline_proposal_by_token/);
  assert.match(migration, /where p\.revision_group_id = revision_group\s+for update/);
  assert.match(migration, /if not current_revision then/);
  assert.match(migration, /and accepted = false\s+and is_current_revision = true/);
  assert.doesNotMatch(migration, /set[\s\S]{0,160}(result|client_delivery_snapshot)\s*=/i);
  assert.match(migration, /grant execute on function public\.decline_proposal_by_token\(text, text\) to service_role/);
  assert.match(declineRoute, /decline_proposal_by_token[\s\S]*scheduleAttentionPushAfterResponse\(\)/);
});

test("public payload remains snapshot-based and does not expose private proposal columns", () => {
  assert.match(migration, /p\.client_delivery_snapshot \|\| jsonb_build_object/);
  assert.doesNotMatch(migration, /jsonb_build_object\([\s\S]*'customer_email'/);
  assert.doesNotMatch(migration, /jsonb_build_object\([\s\S]*'customer_phone'/);
  assert.match(publicPage, /Proposal Declined/);
  assert.match(publicPage, /Declining is final for this proposal revision/);
});

test("internal activity timeline spans every revision and list shows latest lifecycle activity", () => {
  assert.match(proposals, /getProposalFamilyHistory/);
  assert.match(proposals, /\.in\("proposal_id",versions\.map\(version=>version\.id\)\)/);
  assert.match(proposalsPage, /getProposalFamilyHistory\(p\.revision_group_id\)/);
  assert.match(proposalsPage, /V\{x\.revision_number\}/);
  for (const activity of ["accepted_at", "declined_at", "expired_at", "viewed_at", "sent_at"]) {
    assert.match(proposalsPage, new RegExp(`p\\.${activity}`));
  }
});

test("Master Admin receives immediate accepted and declined proposal attention", () => {
  assert.match(attentionTypes, /"Proposal Accepted"/);
  assert.match(attention, /profile\.role === "Master Admin"[\s\S]*proposal\.status !== "Accepted"[\s\S]*"Proposal Accepted"/);
  assert.match(attention, /proposal\.archived_at \|\| routedProposalIds\.has\(proposal\.id\)/);
  assert.match(attention, /proposal\.accepted_at \?\? proposal\.updated_at/);
  assert.match(attention, /"Proposal Declined"/);
  assert.match(declineRoute, /scheduleAttentionPushAfterResponse\(\)/);
});

test("historical accepted proposals already routed to an agreement or job are not surfaced as new alerts", () => {
  assert.match(attention, /const routedProposalIds = new Set\(\[\.\.\.input\.jobRouteIds, \.\.\.input\.agreementProposalIds\]/);
  assert.match(attention, /proposal\.status !== "Accepted" \|\| !proposal\.accepted \|\| proposal\.archived_at \|\| routedProposalIds\.has\(proposal\.id\)/);
  assert.match(attention, /proposal:\$\{proposal\.id\}:accepted/);
  assert.doesNotMatch(attention, /notification_revision[^\n]*Proposal Accepted/);
});

test("existing acceptance and downstream financial workflow remain untouched", () => {
  assert.doesNotMatch(migration, /create or replace function public\.accept_proposal_by_token/);
  assert.doesNotMatch(migration, /ensure_post_construction_acceptance_handoff/);
  assert.doesNotMatch(migration, /create_job_from_accepted_proposal/);
  assert.doesNotMatch(migration, /update public\.(jobs|service_agreements|invoices|payments)/);
});

test("public activity throttling is durable, atomic, and inaccessible to anonymous callers", () => {
  assert.match(migration, /create table public\.proposal_public_rate_limits/);
  assert.match(migration, /primary key \(action, scope, fingerprint\)/);
  assert.match(migration, /on conflict \(action, scope, fingerprint\) do update/g);
  assert.match(migration, /rate_limit\.request_count \+ 1/g);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on function public\.consume_proposal_public_rate_limit\(text, text, text\)[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.consume_proposal_public_rate_limit\(text, text, text\)[\s\S]*to service_role/);
  assert.match(rateLimit, /createSupabaseAdminClient/);
  assert.match(rateLimit, /createHash\("sha256"\)/);
  const limiterDefinition = migration.slice(
    migration.indexOf("create table public.proposal_public_rate_limits"),
    migration.indexOf("-- Keep the public payload"),
  );
  assert.doesNotMatch(limiterDefinition, /client_access_token|x-forwarded-for/);
  assert.match(viewRoute, /createSupabaseAdminClient/);
  assert.match(declineRoute, /createSupabaseAdminClient/);
  assert.match(migration, /grant execute on function public\.record_proposal_view_by_token\(text\) to service_role/);
  assert.match(migration, /grant execute on function public\.decline_proposal_by_token\(text, text\) to service_role/);
});

test("view and decline routes fail closed and return HTTP 429 with Retry-After", () => {
  for (const route of [viewRoute, declineRoute]) {
    assert.match(route, /await enforceProposalPublicRateLimit\(request,/);
    assert.match(route, /error instanceof ProposalPublicRateLimitError/);
    assert.match(route, /status: error\.status/);
    assert.match(route, /"Retry-After"/);
  }
  assert.match(rateLimit, /status: 429 \| 503/);
  assert.match(rateLimit, /"Proposal activity is temporarily unavailable[\s\S]*503/);
  assert.match(rateLimit, /"Too many requests[\s\S]*429/);
});

test("rate-limit counters cover concurrent requests without changing proposal lifecycle RPCs", () => {
  assert.match(migration, /insert into public\.proposal_public_rate_limits as rate_limit[\s\S]*on conflict[\s\S]*do update/g);
  assert.match(migration, /client_count <= client_limit and token_count <= token_limit/);
  assert.doesNotMatch(rateLimit, /accept_proposal_by_token|client_delivery_snapshot|revision_group_id/);
});
