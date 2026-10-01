import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const engine=fs.readFileSync("lib/prospectEnrichment.ts","utf8");
const route=fs.readFileSync("app/api/prospects/enrich/route.ts","utf8");
const orchestrator=fs.readFileSync("lib/prospect-enrichment/orchestrator.ts","utf8");
const adapters=fs.readFileSync("lib/prospect-enrichment/internalProviders.ts","utf8");
const waterfall=fs.readFileSync("lib/prospect-enrichment/waterfallPlanner.ts","utf8");
const migration=fs.readFileSync("supabase/migrations/20260930002727_prospect_engine_phase_4b_website_discovery.sql","utf8");
const runtimeFix=fs.readFileSync("supabase/migrations/20260930134359_fix_prospect_enrichment_cache_provider_version.sql","utf8");
const enrichment=await import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(engine,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString("base64")}`);
const response=(body,status=200)=>new Response(body,{status,headers:{"content-type":"text/html"}});
const input={businessName:"Triana",address:"6250 Canoga Avenue",city:"Woodland Hills",state:"CA",zip:"91367",locationQuery:"91306"};

test("phase 4b discovers a website only when the discovery result lacks one",()=>{
  assert.match(orchestrator,/this\.planner\.next/);
  assert.match(waterfall,/if\(needs\.companyResolution\)capabilities\.push\("company_resolution","domain_resolution"\)/);
  assert.match(adapters,/resolveCompanyWithTavily/);
});
test("website discovery verifies identity and location before enrichment",()=>{
  assert.match(engine,/score<70/);
  assert.match(engine,/business name/);
  assert.match(engine,/ZIP/);
  assert.match(engine,/address/);
});
test("website discovery receives the original discovery search location when OSM address fields are sparse",()=>{
  assert.match(route,/locationQuery:item\.locationQuery/);
  assert.match(adapters,/locationQuery:subject\.locationQuery/);
  assert.match(runtimeFix,/location_query/);
});
test("prospect-specific location context takes precedence over the discovery location",()=>{
  assert.equal(enrichment.buildOfficialWebsiteSearchQuery(input),'"Triana" 6250 Canoga Avenue Woodland Hills CA 91367 official website');
  assert.doesNotMatch(enrichment.buildOfficialWebsiteSearchQuery(input),/91306/);
  assert.equal(enrichment.buildOfficialWebsiteSearchQuery({businessName:"Vela on Ox",locationQuery:"91306"}),'"Vela on Ox" 91306 official website');
});
test("search challenges and provider failures are technical failures",async()=>{
  const challenge=await enrichment.searchOfficialWebsite(input,async()=>response("challenge",202));
  assert.equal(challenge.status,"failed");assert.equal(challenge.errorCode,"search_challenge");assert.equal(challenge.diagnostics.searchOutcome,"challenge");
  const unavailable=await enrichment.searchOfficialWebsite(input,async()=>response("unavailable",503));
  assert.equal(unavailable.status,"failed");assert.equal(unavailable.errorCode,"search_http_failure");
  const network=await enrichment.searchOfficialWebsite(input,async()=>{throw new TypeError("offline")});
  assert.equal(network.status,"failed");assert.equal(network.errorCode,"search_network_failure");
  const timeoutError=new Error("timed out");timeoutError.name="AbortError";
  const timeout=await enrichment.searchOfficialWebsite(input,async()=>{throw timeoutError});
  assert.equal(timeout.status,"failed");assert.equal(timeout.errorCode,"search_timeout");
});
test("legitimate empty and structurally unexpected searches remain distinct",async()=>{
  const empty=await enrichment.searchOfficialWebsite(input,async()=>response('<div class="result--no-result">No results found</div>'));
  assert.equal(empty.status,"empty");assert.equal(empty.diagnostics.searchOutcome,"empty");
  const unexpected=await enrichment.searchOfficialWebsite(input,async()=>response("<html><body>changed markup</body></html>"));
  assert.equal(unexpected.status,"failed");assert.equal(unexpected.errorCode,"search_parser_unexpected");assert.deepEqual(unexpected.diagnostics.rejectionReasonCodes,["unexpected_search_structure"]);
});
test("resolver diagnostics are bounded, sanitized, and verification is attempted",async()=>{
  const links=`<a class="result__a" href="https://yelp.com/triana">Directory</a>`+Array.from({length:8},(_,index)=>`<a class="result__a" href="https://site${index}.example/path?q=secret">Site</a>`).join("");
  let attempts=0;
  const outcome=await enrichment.discoverOfficialWebsite(input,{searchFetch:async()=>response(links),verifyCandidate:async url=>{attempts+=1;return attempts===2?{result:{url:new URL(url).origin,confidence:75,signals:["business name","domain name"]}}:{result:null,rejectionReason:"identity_score_below_threshold"}}});
  assert.equal(outcome.status,"resolved");assert.equal(outcome.diagnostics.parsedResultCount,5);assert.equal(outcome.diagnostics.candidateOrigins.length,5);assert.equal(outcome.diagnostics.blockedHostCount,1);assert.equal(outcome.diagnostics.verificationAttemptCount,3);assert.ok(outcome.diagnostics.rejectionReasonCodes.length<=5);assert.equal(outcome.diagnostics.acceptedDomain,"site1.example");assert.equal(attempts,3);
  assert.ok(outcome.diagnostics.candidateOrigins.every(value=>new URL(value).pathname==="/"));
  assert.doesNotMatch(JSON.stringify(outcome.diagnostics),/changed markup|<html|secret/);
});
test("website candidates still pass public HTTPS SSRF protections",()=>{
  assert.match(engine,/validatePublicHttps/);
  assert.match(engine,/blockedIp/);
  assert.match(engine,/169\.254\.169\.254/);
});
test("search results exclude common directory and social hosts",()=>{
  assert.match(engine,/yelp\.com/);
  assert.match(engine,/facebook\.com/);
  assert.match(engine,/linkedin\.com/);
});
test("technical resolver failures propagate and cannot collapse into ordinary no-data",()=>{
  assert.match(adapters,/outcome\.status==="failed"[\s\S]*status:"failed"[\s\S]*errorCode:outcome\.errorCode/);
  assert.match(orchestrator,/providerFailures\.push/);
  assert.match(orchestrator,/!normalized\.length&&providerFailures\.length[\s\S]*status:"Failed"/);
  assert.match(orchestrator,/normalized\.length\?"Complete":"No Additional Data Found"/);
});
test("resolver metadata is bounded and provider-neutral routing remains intact",()=>{
  assert.match(engine,/candidateOrigins:urls\.slice\(0,5\)/);
  assert.match(engine,/rejectionReasonCodes\.length<5/);
  assert.doesNotMatch(route,/official-website-resolver|tavily-company-resolution|DuckDuckGo|search_challenge/);
  assert.doesNotMatch(`${engine}\n${adapters}`,/Google|Bing|Hunter|Apollo|A-Leads/i);
});
test("phase 4b is forward only",()=>{
  assert.match(migration,/alter table public\.prospect_enrichment_items/);
  assert.doesNotMatch(migration,/drop table|drop column/i);
});
