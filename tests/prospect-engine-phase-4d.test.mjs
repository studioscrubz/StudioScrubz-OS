import test from "node:test";
import assert from "node:assert/strict";

const foundation=await import("../lib/prospect-enrichment/providerFoundation.ts");
const read=(await import("node:fs")).readFileSync;
const adapters=read("lib/prospect-enrichment/internalProviders.ts","utf8");
const orchestrator=read("lib/prospect-enrichment/orchestrator.ts","utf8");
const route=read("app/api/prospects/enrich/route.ts","utf8");
const compatibilityMigration=read("supabase/migrations/20260930143423_allow_generated_email_enrichment_page_type.sql","utf8");

const evidence=(sourceType,verificationStatus)=>({providerKey:sourceType==="Generated Candidate"?"generated-role-email":"official-website-contacts",providerVersion:"1",sourceKind:"Homepage",sourceType,sourceUrl:"https://example.com/",sourcePageType:"Homepage",verificationStatus,discoveredAt:"2026-09-30T00:00:00.000Z"});
const candidate=(overrides={})=>({fieldName:"business_email",value:" INFO@Example.com ",normalizedValue:"",sourceType:"Official Website",sourceUrl:"https://example.com/",sourcePageType:"Homepage",confidence:85,retrievedAt:"2026-09-30T00:00:00.000Z",evidence:evidence("Official Website","published"),...overrides});

test("provider registry orders providers and rejects duplicates or paid providers",()=>{
  const free=(key,priority)=>({providerKey:key,version:"1",capabilities:["business_email_find"],priority,costClass:"free",enabled:true,requiresVerifiedDomain:false,requiresWebsite:false,supportsCache:false,stopPolicy:"when-needed",async findEmails(){return{status:"not_found",candidates:[]}}});
  const registry=new foundation.ProviderRegistry([free("later",20),free("first",10)]);
  assert.deepEqual(registry.providers.map(x=>x.providerKey),["first","later"]);
  assert.throws(()=>new foundation.ProviderRegistry([free("same",1),free("same",2)]));
  assert.throws(()=>new foundation.ProviderRegistry([{...free("paid",1),costClass:"paid"}]).assertFreeOnly());
});

test("needs planner stops work for adequate original or provider data",()=>{
  const complete={discoveryResultId:"r",businessName:"Business",website:"https://example.com",verifiedDomain:"example.com",email:"info@example.com",phone:"8185551212",address:"1 Main",city:"Los Angeles",state:"CA",zip:"90001"};
  assert.deepEqual(foundation.planEnrichmentNeeds(complete),{companyResolution:false,websiteContacts:false,businessEmail:false,personEmailPattern:false,businessPhone:false,address:false,city:false,state:false,zip:false,emailVerification:false,phoneVerification:false});
  assert.equal(foundation.planEnrichmentNeeds({discoveryResultId:"r",businessName:"Business"}).companyResolution,true);
  assert.equal(foundation.planEnrichmentNeeds({discoveryResultId:"r",businessName:"Business",website:"https://example.com"},[candidate()]).businessEmail,false);
});

test("normalization retains independent evidence and deterministic ranking favors published over generated",()=>{
  const generated=candidate({value:"info@example.com",normalizedValue:"info@example.com",sourceType:"Generated Candidate",confidence:55,evidence:evidence("Generated Candidate","unverified")});
  const published=candidate();
  const rows=foundation.normalizeDedupeAndRank([generated,published]);
  assert.equal(rows.length,2);
  assert.equal(rows[0].sourceType,"Official Website");
  assert.equal(rows[0].normalizedValue,"info@example.com");
  assert.ok(foundation.candidateRank(published)>foundation.candidateRank(generated));
});

test("internal provider waterfall is free and ordered OSM, resolver, website, generated email",()=>{
  assert.match(adapters,/priority:10,costClass:"free"/);
  assert.match(adapters,/priority:20,costClass:"free"/);
  assert.match(adapters,/priority:30,costClass:"free"/);
  assert.match(adapters,/priority:1000,costClass:"free"/);
  assert.doesNotMatch(adapters,/A-Leads|Apollo|Hunter|api[_-]?key/i);
});

test("orchestrator preserves review payload and does not stage OSM baseline candidates",()=>{
  assert.match(orchestrator,/stopPolicy==="baseline"/);
  assert.match(orchestrator,/normalizeDedupeAndRank/);
  assert.match(route,/p_candidates:found\.candidates/);
  const row=foundation.normalizeCandidate(candidate());
  for(const key of ["fieldName","value","normalizedValue","sourceType","sourceUrl","sourcePageType","confidence","retrievedAt"])assert.ok(key in row);
});

test("generated role-email provenance is accepted by the forward-only field constraint",()=>{
  assert.match(compatibilityMigration,/Generated Email Pattern/);
  assert.match(compatibilityMigration,/alter table public\.prospect_enrichment_fields/);
  assert.doesNotMatch(compatibilityMigration,/drop table|drop column/i);
});
