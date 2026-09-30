import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const engine=fs.readFileSync("lib/prospectEnrichment.ts","utf8");
const types=fs.readFileSync("types/prospectEnrichment.ts","utf8");
const migration=fs.readFileSync("supabase/migrations/20260930004227_prospect_engine_phase_4c_email_discovery_generation.sql","utf8");
const route=fs.readFileSync("app/api/prospects/enrich/route.ts","utf8");
const cacheFix=fs.readFileSync("supabase/migrations/20260930134359_fix_prospect_enrichment_cache_provider_version.sql","utf8");

test("generated email candidates use only a verified canonical domain",()=>{
  assert.match(engine,/generateBusinessEmailCandidates\(canonicalDomain,candidates\)/);
  assert.match(engine,/const email=`\$\{local\}@\$\{clean\}`/);
});
test("generated candidates are visibly distinct from published emails",()=>{
  assert.match(types,/"Generated Candidate"/);
  assert.match(engine,/"Generated Email Pattern"/);
});
test("generated email confidence is capped below published website email confidence",()=>{
  assert.match(migration,/candidate_source='Generated Candidate' then 55/);
  assert.match(engine,/\["info",55\]/);
});
test("generation uses conservative role mailboxes and never fabricates a person name",()=>{
  assert.match(engine,/\["info",55\],\["contact",50\],\["hello",45\]/);
  assert.doesNotMatch(engine,/firstname|lastname|firstName|lastName/);
});
test("published email suppresses generated fallback",()=>{
  assert.match(engine,/!candidates\.some\(x=>x\.fieldName==="business_email"/);
});
test("generated emails still require the existing pending acceptance workflow",()=>{
  assert.match(migration,/decision='Pending'/);
  assert.match(migration,/Generated Candidate/);
});
test("phase 4c is forward only",()=>{
  assert.match(migration,/create or replace function public\.stage_prospect_enrichment_result/);
  assert.doesNotMatch(migration,/drop table|drop column/i);
});
test("pre-4c cache entries cannot suppress generated email fallback",()=>{
  assert.match(engine,/ENRICHMENT_PROVIDER_VERSION="official-site-v2"/);
  assert.match(route,/cached\?\.providerVersion===ENRICHMENT_PROVIDER_VERSION/);
  assert.match(cacheFix,/'providerVersion',c\.provider_version/);
});
test("visible formatted public phone numbers are extracted without guessing",()=>{
  assert.match(engine,/visible\.matchAll/);
  assert.match(engine,/business_phone",m\[0\]/);
});
