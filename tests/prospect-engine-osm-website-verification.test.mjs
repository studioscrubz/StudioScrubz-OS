import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const engine=await import("../lib/prospectEnrichment.ts");
const foundation=await import("../lib/prospect-enrichment/providerFoundation.ts");
const adapter=readFileSync("lib/prospect-enrichment/osmWebsiteVerification.ts","utf8");
const providers=readFileSync("lib/prospect-enrichment/internalProviders.ts","utf8");
const planner=readFileSync("lib/prospect-enrichment/waterfallPlanner.ts","utf8");
const orchestrator=readFileSync("lib/prospect-enrichment/orchestrator.ts","utf8");
const route=readFileSync("app/api/prospects/enrich/route.ts","utf8");

const property={businessName:"The Q Variel",address:"6200 Variel Avenue",city:"Woodland Hills",state:"CA",zip:"91367",category:"Property Management / Multifamily"};

test("OSM URL is explicit candidate state rather than verified website state",()=>{
  assert.match(route,/websiteCandidate:item\.website/);
  assert.match(route,/websiteCandidateDomain:item\.canonicalDomain/);
  assert.doesNotMatch(route,/website:item\.website[\s\S]{0,80}verifiedDomain:item\.canonicalDomain/);
  const needs=foundation.planEnrichmentNeeds({discoveryResultId:"r",businessName:"Business",websiteCandidate:"https://candidate.example",websiteCandidateDomain:"candidate.example"});
  assert.equal(needs.companyResolution,true);
});

test("OSM verification provider is registered before Tavily with free resolution capabilities",()=>{
  assert.match(adapter,/providerKey:"osm-website-verification",version:OSM_WEBSITE_VERIFICATION_VERSION/);
  assert.match(adapter,/capabilities:\["company_resolution","domain_resolution"\],priority:15,costClass:"free"/);
  assert.match(providers,/internalEnrichmentProviders=\[osmMetadataProvider,osmWebsiteVerificationProvider,tavilyCompanyResolutionProvider/);
  assert.match(planner,/policyVersion:"waterfall-v2"/);
});

test("direct property, direct business, and explicitly associated manager are contact applicable",()=>{
  assert.deepEqual(engine.classifyEntityRelationship(property,"https://theqvariel.com/","The Q Variel at 6200 Variel Avenue"),{type:"direct_property",contactUseAllowed:true});
  assert.deepEqual(engine.classifyEntityRelationship({businessName:"Studio Diner",category:"Restaurant"},"https://studiodiner.com/","Studio Diner"),{type:"direct_business",contactUseAllowed:true});
  assert.deepEqual(engine.classifyEntityRelationship(property,"https://manager.example/q-variel","The Q Variel is managed by Example Property Management"),{type:"property_manager",contactUseAllowed:true});
});

test("generic manager and unknown relationships cannot supply property contacts",()=>{
  assert.deepEqual(engine.classifyEntityRelationship(property,"https://manager.example/","Example Property Management serves Woodland Hills"),{type:"unknown_related",contactUseAllowed:false});
  assert.deepEqual(engine.classifyEntityRelationship(property,"https://other.example/","Woodland Hills apartment communities"),{type:"unknown_related",contactUseAllowed:false});
});

test("owner, developer, and related corporate relationships are blocked",()=>{
  assert.deepEqual(engine.classifyEntityRelationship(property,"https://owner.example/q","The Q Variel is owned by Example Holdings"),{type:"owner",contactUseAllowed:false});
  assert.deepEqual(engine.classifyEntityRelationship(property,"https://developer.example/q","The Q Variel was developed by Example Development"),{type:"developer",contactUseAllowed:false});
  assert.deepEqual(engine.classifyEntityRelationship(property,"https://corporate.example/q","The Q Variel"),{type:"related_corporate",contactUseAllowed:false});
});

test("bounded related-site verification independently verifies an explicit direct-property link",async()=>{
  const attempted=[];
  const result=await engine.verifyOfficialWebsiteCandidates(["https://developer.example/q"],property,{maxAttempts:3,verifyCandidate:async url=>{
    attempted.push(url);
    if(url.includes("developer.example"))return{result:{url:"https://developer.example",landingUrl:url,confidence:90,signals:["exact business name"],relationshipType:"developer",contactUseAllowed:false,relatedWebsiteCandidates:["https://theqvariel.com/"]}};
    return{result:{url:"https://theqvariel.com",landingUrl:url,confidence:95,signals:["domain name"],relationshipType:"direct_property",contactUseAllowed:true}};
  }});
  assert.deepEqual(attempted,["https://developer.example/q","https://theqvariel.com/"]);
  assert.equal(result.attempts,2);assert.equal(result.result.url,"https://theqvariel.com");assert.equal(result.related[0].relationshipType,"developer");
});

test("related-site verification is bounded and does not recursively crawl arbitrary links",async()=>{
  const attempted=[];
  await engine.verifyOfficialWebsiteCandidates(["https://one.example"],property,{maxAttempts:3,verifyCandidate:async url=>{attempted.push(url);return{result:{url:new URL(url).origin,landingUrl:url,confidence:80,signals:[],relationshipType:"developer",contactUseAllowed:false,relatedWebsiteCandidates:[`https://${attempted.length+1}.example`]}}}});
  assert.equal(attempted.length,3);
});

test("blocked relationship is retained as bounded provider evidence",()=>{
  assert.match(adapter,/verified\.related\.map\(item=>relationshipCandidate\(subject,item,false\)\)/);
  assert.match(adapter,/sourceKind:contactUseAllowed\?"OSM Website Verification":"OSM Website Relationship"/);
  assert.match(adapter,/relationshipType:result\.relationshipType\?\?"unknown_related"/);
  assert.match(adapter,/identitySignals:result\.signals\.slice\(0,10\)/);
  assert.match(adapter,/rejectionReasonCodes:verified\.rejectionReasonCodes\.slice\(0,5\)/);
  assert.doesNotMatch(adapter,/rawHtml|responseBody|pageContent/);
});

test("contact providers require verified domain and cannot establish identity",()=>{
  assert.match(providers,/providerKey:"official-website-contacts",version:"3"[\s\S]*requiresVerifiedDomain:true/);
  assert.match(providers,/if\(!subject\.website\|\|!subject\.verifiedDomain\)return\{status:"not_found"/);
  assert.match(providers,/extractOfficialWebsiteContacts\(subject\.website,subject\.verifiedDomain\)/);
  assert.match(providers,/providerKey:"site-contact-discovery"[\s\S]*requiresVerifiedDomain:true/);
  const contactBodies=[...providers.matchAll(/(?:officialWebsiteContactProvider|siteContactDiscoveryProvider)[\s\S]*?\n};/g)].map(match=>match[0]).join("\n");
  assert.doesNotMatch(contactBodies,/resolvedCompany:/);
});

test("cache requires current-run authorization and matching-domain evidence",()=>{
  assert.match(orchestrator,/authorizedDomainThisRun&&cached\?\.providerVersion/);
  assert.match(orchestrator,/cacheMatchesAuthorizedDomain\(cached,authorizedDomainThisRun\)/);
  assert.match(orchestrator,/sameSite\(url\.hostname,verifiedDomain\)/);
  assert.match(orchestrator,/result\.resolvedCompany&&plan\.operation==="company_resolution"/);
});

test("verification fingerprint includes the untrusted candidate and OSM provenance remains separate",()=>{
  assert.match(orchestrator,/websiteCandidate:subject\.websiteCandidate\?\?null/);
  assert.match(providers,/\["website",subject\.websiteCandidate\?\?subject\.website\]/);
  assert.match(adapter,/candidateSource:"OpenStreetMap"/);
  assert.match(adapter,/originalCandidateUrl:subject\.websiteCandidate/);
  assert.match(adapter,/sourceUrl=subject\.sourceUrl\?\?subject\.websiteCandidate/);
});

test("shared verification preserves attempt limits, HTTPS/DNS/SSRF and redirect protections",()=>{
  assert.match(engine.verifyOfficialWebsiteCandidates.toString(),/Math\.min\(3/);
  const source=readFileSync("lib/prospectEnrichment.ts","utf8");
  assert.match(source,/validatePublicHttps/);assert.match(source,/blockedIp/);assert.match(source,/redirects<=2/);assert.match(source,/ENRICHMENT_MAX_BYTES/);assert.match(source,/content type is unsupported/);
});

