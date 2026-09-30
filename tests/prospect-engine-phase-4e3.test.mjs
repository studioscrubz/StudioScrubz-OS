import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const patterns=await import("../lib/prospect-enrichment/companyEmailPattern.ts");
const foundation=await import("../lib/prospect-enrichment/providerFoundation.ts");
const providerSource=readFileSync("lib/prospect-enrichment/internalProviders.ts","utf8");
const patternSource=readFileSync("lib/prospect-enrichment/companyEmailPattern.ts","utf8");
const orchestratorSource=readFileSync("lib/prospect-enrichment/orchestrator.ts","utf8");
const routeSource=readFileSync("app/api/prospects/enrich/route.ts","utf8");
const discoverySource=readFileSync("lib/prospectEnrichment.ts","utf8");

function candidate(fieldName,value,id,{sourceType="Official Website",status="published",domain="example.com",strong=true}={}){
  const normalizedValue=fieldName==="business_email"?value.toLowerCase():value.toLowerCase().replace(/\s+/g," ");
  return{fieldName,value,normalizedValue,sourceType,sourceUrl:`https://${domain}/team`,sourcePageType:"Team",confidence:90,retrievedAt:"2026-09-30T00:00:00.000Z",evidence:{providerKey:sourceType==="Generated Candidate"?"company-email-pattern":"site-contact-discovery",providerVersion:"2",sourceKind:strong?"team-card":"Team",sourceType,sourceUrl:`https://${domain}/team`,sourcePageType:"Team",verificationStatus:status,discoveredAt:"2026-09-30T00:00:00.000Z",providerMetadata:strong?{personObservationId:id,structuralEvidence:"team-card"}:{}}};
}
const person=(id,name,email,options)=>[candidate("contact_name",name,id,options),...(email?[candidate("business_email",email,id,options)]:[])];
const learn=(name,email)=>patterns.analyzeCompanyEmailPattern(person("source",name,email),"example.com");
const generate=(evidence,targetName="Alex Rivera",extra=[])=>patterns.generatePersonPatternCandidates([...evidence,...person("target",targetName),...extra],"example.com");

test("first.last recognition",()=>assert.equal(learn("Jane Smith","jane.smith@example.com").patternId,"first.last"));
test("firstlast recognition",()=>assert.equal(learn("Jane Smith","janesmith@example.com").patternId,"firstlast"));
test("first recognition",()=>assert.equal(learn("Jane Smith","jane@example.com").patternId,"first"));
test("first-initial-last recognition",()=>assert.equal(learn("Jane Smith","jsmith@example.com").patternId,"first_initial_last"));
test("first_last recognition",()=>assert.equal(learn("Jane Smith","jane_smith@example.com").patternId,"first_last"));
test("last.first recognition",()=>assert.equal(learn("Jane Smith","smith.jane@example.com").patternId,"last.first"));

test("two matching observations establish a pattern",()=>{
  const analysis=patterns.analyzeCompanyEmailPattern([...person("one","Jane Smith","jane.smith@example.com"),...person("two","John Michael Doe","john.doe@example.com")],"example.com");
  assert.equal(analysis.status,"usable");assert.equal(analysis.patternId,"first.last");assert.equal(analysis.evidenceCount,2);
});

test("unique single observation establishes a pattern",()=>assert.equal(learn("Jane Smith","jsmith@example.com").status,"usable"));
test("ambiguous single observation does not establish a pattern",()=>{
  const analysis=learn("John John","john.john@example.com");assert.equal(analysis.status,"insufficient");assert.equal(analysis.patternId,undefined);
});
test("conflicting patterns prevent generation",()=>{
  const evidence=[...person("one","Jane Smith","jane.smith@example.com"),...person("two","John Doe","johndoe@example.com")];
  const result=generate(evidence);assert.equal(result.analysis.status,"conflicting");assert.equal(result.candidates.length,0);
});

test("generic role mailbox is excluded from learning",()=>assert.equal(learn("Jane Smith","info@example.com").evidenceCount,0));
test("generated candidate is excluded from learning",()=>{
  const evidence=person("source","Jane Smith","jane.smith@example.com",{sourceType:"Generated Candidate",status:"unverified"});
  assert.equal(patterns.analyzeCompanyEmailPattern(evidence,"example.com").evidenceCount,0);
});
test("foreign-domain email is excluded",()=>assert.equal(learn("Jane Smith","jane.smith@other.example").evidenceCount,0));
test("weak unassociated email is excluded",()=>{
  const evidence=[candidate("contact_name","Jane Smith","source"),candidate("business_email","jane.smith@example.com","source",{strong:false})];
  assert.equal(patterns.analyzeCompanyEmailPattern(evidence,"example.com").evidenceCount,0);
});

test("target must be an explicitly published person",()=>{
  const result=generate(person("source","Jane Smith","jane.smith@example.com"),"Alex Rivera",[candidate("contact_name","Weak Person","weak",{strong:false})]);
  assert.deepEqual(result.candidates.map(x=>x.targetPersonObservationId),["target"]);
});
test("target with existing published email is skipped",()=>{
  const evidence=[...person("source","Jane Smith","jane.smith@example.com"),...person("target","Alex Rivera","alex.rivera@example.com")];
  assert.equal(patterns.generatePersonPatternCandidates(evidence,"example.com").candidates.length,0);
});
test("exact published email duplicate is skipped",()=>{
  const result=generate(person("source","Jane Smith","jane.smith@example.com"),"Alex Rivera",person("other","Another Person","alex.rivera@example.com"));
  assert.equal(result.candidates.length,0);
});
test("duplicate generated candidate for the person is skipped",()=>{
  const existing=candidate("business_email","alex.rivera@example.com","target",{sourceType:"Generated Candidate",status:"unverified"});
  const result=generate(person("source","Jane Smith","jane.smith@example.com"),"Alex Rivera",[existing]);assert.equal(result.candidates.length,0);
});
test("ambiguous target name is skipped",()=>{
  const result=generate(person("source","Jane Smith","jane.smith@example.com"),"Dr. Alex Rivera");assert.equal(result.candidates.length,0);
});

test("generated candidate is Unverified",()=>assert.match(providerSource,/company-email-pattern[\s\S]*"unverified"/));
test("generated candidate source is Generated Candidate",()=>assert.match(providerSource,/company-email-pattern[\s\S]*"Generated Candidate"/));
test("pattern confidence remains separate from verification",()=>{
  const draft=generate(person("source","Jane Smith","jane.smith@example.com")).candidates[0];assert.equal(draft.confidence,65);assert.match(providerSource,/item\.confidence,"unverified"/);
});
test("pattern identifier is persisted in sanitized metadata",()=>assert.match(providerSource,/providerMetadata:\{patternId:/));
test("evidence count is persisted",()=>assert.match(providerSource,/evidenceCount:result\.candidates\[index\]\.evidenceCount/));
test("target person observation ID is persisted",()=>assert.match(providerSource,/targetPersonObservationId:result\.candidates\[index\]\.targetPersonObservationId/));
test("source evidence observation IDs are persisted",()=>assert.match(providerSource,/evidenceObservationIds:result\.candidates\[index\]\.evidenceObservationIds/));

test("pattern provider performs no website crawl or network request",()=>{
  assert.doesNotMatch(patternSource,/\bfetch\s*\(|validatePublicHttps|robotsAllows|discoverOfficialSiteContacts/);
  assert.match(orchestratorSource,/evidenceCandidates:normalizeDedupeAndRank/);
});
test("generic role fallback remains functional and last",()=>{
  assert.match(providerSource,/companyEmailPatternProvider,generatedRoleEmailProvider/);
  assert.match(discoverySource,/\[\["info",55\],\["contact",50\],\["hello",45\]\]/);
});
test("existing published-contact behavior remains intact",()=>{
  assert.match(discoverySource,/extractPublishedPersonContacts/);assert.match(providerSource,/siteContactDiscoveryProvider/);
});
test("API route remains provider-neutral",()=>assert.doesNotMatch(routeSource,/company-email-pattern|COMPANY_EMAIL_PATTERNS|person_email_pattern/));
test("no external provider or API is introduced",()=>{
  assert.doesNotMatch(`${providerSource}\n${patternSource}`,/A-Leads|Apollo|Hunter|RocketReach|Clearbit|api[_-]?key|smtp|mx lookup/i);
});

test("person-pattern need remains independent from business email satisfaction",()=>{
  const evidence=[...person("source","Jane Smith","jane.smith@example.com"),...person("target","Alex Rivera")];
  const needs=foundation.planEnrichmentNeeds({discoveryResultId:"result",businessName:"Business",verifiedDomain:"example.com",email:"public@example.com"},evidence);
  assert.equal(needs.businessEmail,false);assert.equal(needs.personEmailPattern,true);
});
