import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";

const source=readFileSync("lib/prospect-enrichment/tavilyCompanyResolution.ts","utf8");
const adapters=readFileSync("lib/prospect-enrichment/internalProviders.ts","utf8");
const foundation=readFileSync("lib/prospect-enrichment/providerFoundation.ts","utf8");
const waterfall=readFileSync("lib/prospect-enrichment/waterfallPlanner.ts","utf8");
const orchestrator=readFileSync("lib/prospect-enrichment/orchestrator.ts","utf8");
const route=readFileSync("app/api/prospects/enrich/route.ts","utf8");
const migration=readFileSync("supabase/migrations/20261001011054_allow_unknown_provider_cost.sql","utf8");
const harness=source
  .replace('import "server-only";','')
  .replace(/import \{[\s\S]*?\} from "\.\.\/prospectEnrichment";/,`const buildOfficialWebsiteSearchQuery=input=>[\`"\${input.businessName}"\`,...(input.address||input.city||input.zip?[input.address,input.city,input.state,input.zip].filter(Boolean):[input.locationQuery].filter(Boolean)),"official website"].join(" ");const blocked=new Set(["facebook.com","linkedin.com","yelp.com","trulia.com","zillow.com"]);const isBlockedWebsiteSearchHost=host=>blocked.has(host.replace(/^www\\./,""));const verifyOfficialWebsite=async()=>({result:null,rejectionReason:"identity_score_below_threshold"});`);
const js=ts.transpileModule(harness,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const tavily=await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const identityEngine=await import("../lib/prospectEnrichment.ts");
const review=await import("../lib/prospect-enrichment/reviewGrouping.ts");
const input={businessName:"Triana",address:"6250 Canoga Avenue",city:"Woodland Hills",state:"CA",zip:"91367",locationQuery:"91306"};
const response=(body,status=200)=>new Response(typeof body==="string"?body:JSON.stringify(body),{status,headers:{"content-type":"application/json"}});

test("Tavily is the registered paid company resolver and DuckDuckGo is not registered",()=>{
  assert.match(adapters,/providerKey:"tavily-company-resolution"[\s\S]*capabilities:\["company_resolution","domain_resolution"\][\s\S]*priority:20[\s\S]*costClass:"paid"/);
  assert.match(adapters,/internalEnrichmentProviders=\[osmMetadataProvider,tavilyCompanyResolutionProvider,officialWebsiteContactProvider/);
  assert.doesNotMatch(adapters,/officialWebsiteResolverProvider|discoverOfficialWebsite/);
  assert.match(waterfall,/mode:"allow-paid",maxCreditsPerItem:1/);
});

test("request is bounded, contains business location, and requests URLs rather than generated content",async()=>{
  let request;
  await tavily.searchTavilyCompanyCandidates(input,{apiKey:"private-test-key",searchFetch:async(url,init)=>{request={url,init,body:JSON.parse(init.body)};return response({results:[],usage:{credits:1}})}});
  assert.equal(request.url,"https://api.tavily.com/search");
  assert.match(request.body.query,/Triana/);assert.match(request.body.query,/6250 Canoga Avenue/);assert.match(request.body.query,/91367/);assert.doesNotMatch(request.body.query,/91306/);
  assert.equal(request.body.max_results,5);assert.equal(request.body.search_depth,"basic");assert.equal(request.body.include_answer,false);assert.equal(request.body.include_raw_content,false);assert.equal(request.body.include_images,false);
  assert.equal(request.init.cache,"no-store");assert.equal(request.init.headers.Authorization,"Bearer private-test-key");
});

test("Tavily results remain candidates until existing verification accepts one",async()=>{
  let attempts=0;
  const outcome=await tavily.resolveCompanyWithTavily(input,{apiKey:"key",searchFetch:async()=>response({results:[{url:"https://low.example/path"},{url:"https://triana.example/home"}],request_id:"request-1",usage:{credits:1}}),verifyCandidate:async url=>{attempts++;return url.includes("triana")?{result:{url:new URL(url).origin,confidence:75,signals:["business name","ZIP"]}}:{result:null,rejectionReason:"identity_score_below_threshold"}}});
  assert.equal(outcome.status,"resolved");assert.equal(outcome.result.url,"https://triana.example");assert.equal(attempts,2);assert.equal(outcome.diagnostics.verificationAttemptCount,2);assert.deepEqual(outcome.diagnostics.rejectionReasonCodes,["identity_score_below_threshold"]);assert.equal(outcome.providerRequestId,"request-1");assert.equal(outcome.creditsUsed,1);
});

test("The Q Variel preserves paths, excludes directories, ranks the direct property, and verifies it",async()=>{
  const attempted=[];
  const outcome=await tavily.resolveCompanyWithTavily({businessName:"The Q Variel",address:"6200 Variel Avenue",city:"Woodland Hills",state:"CA",zip:"91367",category:"Property Management / Multifamily"},{apiKey:"key",searchFetch:async()=>response({results:[
    {url:"https://balaciano.com/the-q-variel/",title:"The Q Variel - Balaciano Group",content:"The Q Variel 6200 Variel Avenue Woodland Hills CA 91367"},
    {url:"https://trulia.com/building/the-q-variel",title:"The Q Variel"},
    {url:"https://zillow.com/apartments/the-q-variel",title:"The Q Variel"},
    {url:"https://theqvariel.com/",title:"The Q Variel",content:"6200 Variel Avenue 91367 official website"}
  ]}),verifyCandidate:async url=>{attempted.push(url);return url.includes("theqvariel.com")?{result:{url:"https://theqvariel.com",landingUrl:url,confidence:95,signals:["domain name","exact business name"],relationshipType:"direct_property",contactUseAllowed:true}}:{result:{url:"https://balaciano.com",landingUrl:url,confidence:95,signals:["exact business name","address","ZIP"],relationshipType:"developer",contactUseAllowed:false,relatedWebsiteCandidates:["https://theqvariel.com/"]}}}});
  assert.equal(outcome.status,"resolved");assert.equal(outcome.result.url,"https://theqvariel.com");assert.equal(outcome.result.relationshipType,"direct_property");
  assert.deepEqual(attempted,["https://theqvariel.com/", "https://balaciano.com/the-q-variel/"]);
  assert.equal(outcome.diagnostics.blockedHostCount,2);assert.equal(outcome.diagnostics.verificationAttemptCount,2);
  assert.ok(outcome.diagnostics.candidateOrigins.includes("https://theqvariel.com"));
});

test("candidate representation bounds support text and never reduces the landing URL to its origin",async()=>{
  const long="x".repeat(1000),searched=await tavily.searchTavilyCompanyCandidates(input,{apiKey:"key",searchFetch:async()=>response({results:[{url:"https://candidate.example/company/path?ref=1#section",title:long,content:long}]})});
  assert.equal(searched.candidates[0].url,"https://candidate.example/company/path?ref=1");assert.equal(searched.candidates[0].origin,"https://candidate.example");assert.equal(searched.candidates[0].title.length,200);assert.equal(searched.candidates[0].snippet.length,500);
});

test("relationship classification separates direct properties, managers, owners, and developers",()=>{
  const property={businessName:"The Q Variel",address:"6200 Variel Avenue",category:"Property Management / Multifamily"};
  assert.deepEqual(identityEngine.classifyEntityRelationship(property,"https://theqvariel.com/","The Q Variel"),{type:"direct_property",contactUseAllowed:true});
  assert.deepEqual(identityEngine.classifyEntityRelationship(property,"https://manager.example/q","The Q Variel is managed by Example Property Management"),{type:"property_manager",contactUseAllowed:true});
  assert.deepEqual(identityEngine.classifyEntityRelationship(property,"https://owner.example/q","The Q Variel is owned by Example Holdings"),{type:"owner",contactUseAllowed:false});
  assert.deepEqual(identityEngine.classifyEntityRelationship(property,"https://balaciano.com/the-q-variel/","The Q Variel development portfolio",["https://theqvariel.com/"]),{type:"developer",contactUseAllowed:false});
});

test("weak single-token identity cannot receive the legacy business-name score",()=>{
  assert.match(readFileSync("lib/prospectEnrichment.ts","utf8"),/meaningful\.length>=2&&nameScore>=0\.8/);
  assert.match(readFileSync("lib/prospectEnrichment.ts","utf8"),/exactName/);
});

test("review grouping shows one value while retaining all evidence and distinct confidence concepts",()=>{
  const base={fieldName:"business_email",value:"info@example.com",normalizedValue:"info@example.com",sourceType:"Official Website",sourceUrl:"https://example.com/",sourcePageType:"Homepage",retrievedAt:"2026-01-01T00:00:00Z",decision:"Pending"};
  const grouped=review.groupEnrichmentCandidates([
    {...base,id:"published",confidence:85,providerKey:"official-website-contacts",verificationStatus:"published"},
    {...base,id:"mx",confidence:90,providerKey:"email-domain-verification",verificationStatus:"valid"}
  ]);
  assert.equal(grouped.length,1);assert.deepEqual(grouped[0].evidenceIds,["mx","published"]);assert.equal(grouped[0].evidenceCount,2);assert.equal(grouped[0].published,true);assert.equal(grouped[0].technicalVerificationStatus,"valid");assert.equal(grouped[0].confidence,85);
});

test("website grouping keeps resolver identity confidence separate from crawler confidence",()=>{
  const base={fieldName:"website",value:"https://example.com",normalizedValue:"https://example.com",sourceType:"Official Website",sourceUrl:"https://example.com/",sourcePageType:"Homepage",retrievedAt:"2026-01-01T00:00:00Z",decision:"Pending"};
  const grouped=review.groupEnrichmentCandidates([{...base,id:"resolver",confidence:70,identityConfidence:70,providerKey:"tavily-company-resolution",verificationStatus:"verified"},{...base,id:"crawler",confidence:95,providerKey:"official-website-contacts",verificationStatus:"published"}]);
  assert.equal(grouped.length,1);assert.equal(grouped[0].confidence,95);assert.equal(grouped[0].identityConfidence,70);assert.deepEqual(grouped[0].evidenceIds,["crawler","resolver"]);
  assert.match(readFileSync("lib/prospect-enrichment/reviewGrouping.ts","utf8"),/evidenceIds/);assert.match(readFileSync("components\/prospects\/ProspectDiscovery.tsx","utf8"),/fieldIds=grouped\?\.evidenceIds\?\?\[fieldId\]/);
});

test("blocked hosts and non-HTTPS URLs never reach candidate verification",async()=>{
  const attempted=[];
  const outcome=await tavily.resolveCompanyWithTavily(input,{apiKey:"key",searchFetch:async()=>response({results:[{url:"https://yelp.com/triana"},{url:"http://private.example"},{url:"https://candidate.example"}]}),verifyCandidate:async url=>{attempted.push(url);return{result:null,rejectionReason:"candidate_security_or_fetch_rejected"}}});
  assert.equal(outcome.status,"not_found");assert.deepEqual(attempted,["https://candidate.example/"]);assert.equal(outcome.diagnostics.blockedHostCount,1);
  const engine=readFileSync("lib/prospectEnrichment.ts","utf8");assert.match(engine,/validatePublicHttps/);assert.match(engine,/blockedIp/);assert.match(engine,/169\.254\.169\.254/);
});

test("missing key and provider HTTP failures are sanitized and distinct",async()=>{
  const missing=await tavily.searchTavilyCompanyCandidates(input,{apiKey:""});assert.equal(missing.errorCode,"tavily_configuration_unavailable");assert.doesNotMatch(JSON.stringify(missing),/TAVILY_API_KEY|private-test-key/);
  for(const [status,code] of [[401,"tavily_authentication_failed"],[403,"tavily_authentication_failed"],[429,"tavily_rate_limited"],[500,"tavily_upstream_failure"]]){const result=await tavily.searchTavilyCompanyCandidates(input,{apiKey:"secret",searchFetch:async()=>response({detail:"do not persist"},status)});assert.equal(result.errorCode,code);assert.doesNotMatch(JSON.stringify(result),/secret|do not persist/)}
});

test("timeouts, network errors, malformed responses, and legitimate empty results stay distinct",async()=>{
  const timeoutError=new Error("timeout");timeoutError.name="AbortError";
  assert.equal((await tavily.searchTavilyCompanyCandidates(input,{apiKey:"key",searchFetch:async()=>{throw timeoutError}})).errorCode,"tavily_timeout");
  assert.equal((await tavily.searchTavilyCompanyCandidates(input,{apiKey:"key",searchFetch:async()=>{throw new TypeError("offline")}})).errorCode,"tavily_network_failure");
  assert.equal((await tavily.searchTavilyCompanyCandidates(input,{apiKey:"key",searchFetch:async()=>response("not-json")})).errorCode,"tavily_malformed_response");
  assert.equal((await tavily.searchTavilyCompanyCandidates(input,{apiKey:"key",searchFetch:async()=>response({answer:"missing results"})})).errorCode,"tavily_malformed_response");
  const empty=await tavily.searchTavilyCompanyCandidates(input,{apiKey:"key",searchFetch:async()=>response({results:[],usage:{credits:1}})});assert.equal(empty.status,"not_found");assert.equal(empty.diagnostics.searchOutcome,"empty");
});

test("API key and raw responses cannot enter metadata, client code, or errors",()=>{
  assert.match(source,/process\.env\.TAVILY_API_KEY/);assert.doesNotMatch(source,/NEXT_PUBLIC_/);assert.doesNotMatch(route,/TAVILY|tavily-company-resolution/);
  assert.match(foundation,/BLOCKED_METADATA_KEY/);assert.doesNotMatch(adapters,/response\.text\(|raw_content/);
});

test("provider calls retain request ID and credits while monetary cost remains unknown",()=>{
  assert.match(adapters,/providerRequestId:outcome\.providerRequestId/);assert.match(adapters,/creditsUsed:outcome\.creditsUsed/);assert.match(adapters,/costMinorUnits:null/);
  assert.match(migration,/cost_minor_units drop not null/);assert.match(migration,/p_cost_minor_units bigint default null/);assert.match(migration,/prospect_enrichment_inherit_unknown_call_cost/);
});

test("technical failures are not no-data cache entries and downstream remains provider-neutral",()=>{
  assert.match(orchestrator,/result\.status==="failed"&&providerFailures/);assert.match(orchestrator,/!normalized\.length&&providerFailures\.length[\s\S]*status:"Failed"/);
  assert.match(adapters,/officialWebsiteContactProvider/);assert.match(adapters,/siteContactDiscoveryProvider/);assert.match(adapters,/companyEmailPatternProvider/);assert.match(adapters,/emailDomainVerificationProvider/);assert.match(adapters,/generatedRoleEmailProvider/);
  assert.doesNotMatch(route,/Tavily|tavily|company-resolution/);
});

test("OSM website satisfaction prevents unnecessary Tavily planning",async()=>{
  const foundationModule=await import("../lib/prospect-enrichment/providerFoundation.ts");
  const needs=foundationModule.planEnrichmentNeeds({discoveryResultId:"result",businessName:"Hammond",website:"https://example.com",verifiedDomain:"example.com"});
  assert.equal(needs.companyResolution,false);
});

test("no CAPTCHA bypass, external contact provider, or client-side key was introduced",()=>{
  assert.doesNotMatch(`${source}\n${adapters}`,/captcha|proxy|rotate|Hunter|Apollo|A-Leads/i);
  assert.doesNotMatch(route,/process\.env\.TAVILY_API_KEY|Authorization:\s*`Bearer/);
});
