import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const migration=readFileSync("supabase/migrations/20260930145919_prospect_engine_phase_4d2_provider_provenance_usage.sql","utf8");
const recorder=readFileSync("lib/prospect-enrichment/providerCallRecorder.ts","utf8");
const orchestrator=readFileSync("lib/prospect-enrichment/orchestrator.ts","utf8");
const foundation=await import("../lib/prospect-enrichment/providerFoundation.ts");

const evidence=(providerKey,sourceUrl)=>({providerKey,providerVersion:"1",sourceKind:"Contact",sourceType:"Official Website",sourceUrl,sourcePageType:"Contact",verificationStatus:"published",discoveredAt:"2026-09-30T00:00:00.000Z"});
const candidate=(providerKey,sourceUrl)=>({fieldName:"business_email",value:"info@example.com",normalizedValue:"info@example.com",sourceType:"Official Website",sourceUrl,sourcePageType:"Contact",confidence:85,retrievedAt:"2026-09-30T00:00:00.000Z",evidence:evidence(providerKey,sourceUrl)});

test("provider calls persist lifecycle, cache, usage, cost, and request identity",()=>{
  assert.match(migration,/create table public\.prospect_enrichment_provider_calls/);
  for(const column of ["provider_key","provider_version","operation","request_fingerprint","provider_request_id","cache_hit","credits_used","cost_minor_units","cost_currency","http_status","response_metadata"])assert.match(migration,new RegExp(`\\b${column}\\b`));
  assert.match(recorder,/begin_prospect_enrichment_provider_call/);
  assert.match(recorder,/complete_prospect_enrichment_provider_call/);
  assert.match(orchestrator,/cacheHit:true/);
});

test("internal provider calls and candidates default to zero cost",()=>{
  assert.match(recorder,/usage\.creditsUsed\?\?0/);
  assert.match(recorder,/usage\.costMinorUnits===undefined\?0:usage\.costMinorUnits/);
  assert.match(orchestrator,/usage:result\.usage\?\?\{creditsUsed:0,costMinorUnits:0\}/);
  assert.doesNotMatch(recorder,/A-Leads|Apollo|Hunter/i);
});

test("candidate rows link to the exact authorized provider call",()=>{
  assert.match(migration,/provider_call_id uuid references public\.prospect_enrichment_provider_calls\(id\) on delete restrict/);
  assert.match(migration,/c\.enrichment_item_id=item\.id/);
  assert.match(migration,/Candidate provider call unavailable/);
  assert.match(orchestrator,/providerCallId:callId/);
});

test("equivalent values retain independent provider evidence",()=>{
  const rows=foundation.normalizeDedupeAndRank([candidate("provider-a","https://example.com/contact"),candidate("provider-b","https://example.com/contact")]);
  assert.equal(rows.length,2);
  assert.match(migration,/evidence->>'providerKey'/);
  assert.match(migration,/evidence->>'providerVersion'/);
});

test("verification, confidence, and source provenance remain separate",()=>{
  for(const column of ["source_kind","verification_status","discovered_at","verified_at","provider_record_id","provider_metadata"])assert.match(migration,new RegExp(`\\b${column}\\b`));
  assert.match(migration,/confidence,retrieved_at,candidate_fingerprint/);
  assert.match(migration,/verification_status in\('published','verified','valid','catch_all','risky','unverified','invalid','unknown'\)/);
});

test("metadata is bounded and rejects secret or raw response material",()=>{
  const foundationSource=readFileSync("lib/prospect-enrichment/providerFoundation.ts","utf8");
  assert.match(foundationSource,/BLOCKED_METADATA_KEY/);
  assert.match(foundationSource,/MAX_METADATA_STRING_LENGTH=500/);
  assert.match(migration,/pg_column_size\(response_metadata\)<=16384/);
  assert.match(migration,/authorization\|api\[-_\]\?key/);
  const clean=foundation.sanitizeProviderMetadata;
  assert.deepEqual(clean({candidateCount:2,authorization:"Bearer secret",nested:{api_key:"secret",safe:true}}),{candidateCount:2,nested:{safe:true}});
});

test("provider-call RLS and hardened RPCs preserve management and Sales ownership",()=>{
  assert.match(migration,/enable row level security/);
  assert.match(migration,/security definer set search_path=''/g);
  assert.match(migration,/d\.created_by=actor and d\.assigned_user_id=actor/);
  assert.match(migration,/revoke all on table public\.prospect_enrichment_provider_calls from public,anon,authenticated/);
  assert.match(migration,/grant select on table public\.prospect_enrichment_provider_calls to authenticated/);
});

test("review response remains unchanged while staging persists provenance",()=>{
  assert.doesNotMatch(migration,/create or replace function public\.get_prospect_enrichment_review/);
  assert.match(migration,/create or replace function public\.stage_prospect_enrichment_result/);
  assert.match(migration,/provider_metadata,credits_used,cost_minor_units,cost_currency/);
});
