import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const engine=await import("../lib/prospectEnrichment.ts");
const foundation=await import("../lib/prospect-enrichment/providerFoundation.ts");
const adapters=readFileSync("lib/prospect-enrichment/internalProviders.ts","utf8");
const orchestrator=readFileSync("lib/prospect-enrichment/orchestrator.ts","utf8");
const migration=readFileSync("supabase/migrations/20260930214800_extend_enrichment_source_page_types_phase_4e1.sql","utf8");
const engineSource=readFileSync("lib/prospectEnrichment.ts","utf8");

test("site-contact-discovery is internal, free, priority 40, and precedes generated email",()=>{
  assert.match(adapters,/providerKey:"site-contact-discovery",version:"2"[\s\S]*priority:40[\s\S]*costClass:"free"/);
  assert.match(adapters,/internalEnrichmentProviders=\[osmMetadataProvider,officialWebsiteResolverProvider,officialWebsiteContactProvider,siteContactDiscoveryProvider,companyEmailPatternProvider,emailDomainVerificationProvider,generatedRoleEmailProvider\]/);
  assert.doesNotMatch(adapters,/A-Leads|Apollo|Hunter|RocketReach|Clearbit|api[_-]?key/i);
});

test("contact links are ranked deterministically from anchor text and path",()=>{
  const html='<a href="/about">About us</a><a href="/people">Our people</a><a href="/contact-us">Write to us</a><a href="/leadership">Leadership</a><a href="/directory">Directory</a>';
  const ranked=engine.rankOfficialSiteContactLinks(html,new URL("https://example.com/"));
  assert.deepEqual(ranked.map(item=>item.pageType),["Contact","Directory","Leadership","People","About"]);
  assert.equal(ranked[0].url,"https://example.com/contact-us");
});

test("crawl is same-origin, depth one, homepage plus at most six pages",()=>{
  assert.equal(engine.SITE_CONTACT_MAX_TOTAL_PAGES,7);
  assert.equal(engine.SITE_CONTACT_MAX_ADDITIONAL_PAGES,6);
  const links=engine.rankOfficialSiteContactLinks('<a href="https://evil.example/contact">Contact</a>'+Array.from({length:10},(_,i)=>`<a href="/contact-${i}">Contact ${i}</a>`).join(""),new URL("https://example.com/"));
  assert.equal(links.length,6);
  assert.ok(links.every(item=>new URL(item.url).origin==="https://example.com"));
  assert.match(engineSource,/for\(const link of rankOfficialSiteContactLinks\(home,base\)\)/);
  assert.doesNotMatch(engineSource,/rankOfficialSiteContactLinks\(html,url/);
});

test("verified official domain is mandatory and existing fetch protections are reused",()=>{
  assert.match(adapters,/site-contact-discovery[\s\S]*requiresVerifiedDomain:true[\s\S]*requiresWebsite:true/);
  assert.match(engineSource,/Official website does not match the verified domain/);
  for(const token of ["validatePublicHttps","robotsAllows","fetchBounded","ENRICHMENT_MAX_BYTES","redirect limit","application/xhtml\\+xml"])assert.match(engineSource,new RegExp(token,"i"));
  assert.doesNotMatch(engineSource,/puppeteer|playwright|eval\(/i);
});

test("published contacts use mailto tel JSON-LD and visible content without inference",()=>{
  assert.match(engineSource,/application\\\/ld\\\+json/);
  assert.match(engineSource,/mailto:/);
  assert.match(engineSource,/tel:/);
  assert.match(engineSource,/A-Z0-9\._%\+\-/);
  assert.match(adapters,/site-contact-discovery[\s\S]*"published"/);
  assert.doesNotMatch(engineSource,/firstName|lastName|mx lookup/i);
  assert.match(engineSource,/\[\["info",55\],\["contact",50\],\["hello",45\]\]/);
});

test("actual source page URL and ranked page type flow into candidate provenance",()=>{
  assert.match(engineSource,/extractPage\(html,url\.toString\(\),link\.pageType,pageCandidates\)/);
  assert.match(adapters,/item\.sourceUrl,item\.sourcePageType,"published"/);
  for(const pageType of ["Leadership","Directory","People","Offices"])assert.match(migration,new RegExp(`'${pageType}'`));
});

test("published email satisfies the field before generated fallback planning",()=>{
  const candidate={fieldName:"business_email",value:"info@example.com",normalizedValue:"info@example.com",sourceType:"Official Website",sourceUrl:"https://example.com/contact",sourcePageType:"Contact",confidence:85,retrievedAt:new Date().toISOString(),evidence:{providerKey:"site-contact-discovery",providerVersion:"1",sourceKind:"Contact",sourceType:"Official Website",sourceUrl:"https://example.com/contact",sourcePageType:"Contact",verificationStatus:"published",discoveredAt:new Date().toISOString()}};
  const needs=foundation.planEnrichmentNeeds({discoveryResultId:"result",businessName:"Business",website:"https://example.com",verifiedDomain:"example.com"},[candidate]);
  assert.equal(needs.businessEmail,false);
  assert.match(orchestrator,/evidenceCandidates=normalizeDedupeAndRank\(\[\.\.\.baseline,\.\.\.candidates\]\),needs=planEnrichmentNeeds\(subject,evidenceCandidates\)/);
});

test("partial legacy cache cannot suppress the deeper contact waterfall",()=>{
  assert.match(orchestrator,/cachedNeeds=planEnrichmentNeeds/);
  assert.match(orchestrator,/!cachedNeeds\.businessEmail&&!cachedNeeds\.businessPhone/);
  assert.match(orchestrator,/candidates\.push\(\.\.\.cachedNormalized\)/);
});

test("migration only extends legitimate source page types",()=>{
  assert.match(migration,/drop constraint if exists prospect_enrichment_fields_source_page_type_check/);
  assert.match(migration,/add constraint prospect_enrichment_fields_source_page_type_check/);
  assert.doesNotMatch(migration,/create table|drop table|drop column/i);
});
