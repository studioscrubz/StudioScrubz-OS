import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const engine=await import("../lib/prospectEnrichment.ts");
const providerSource=readFileSync("lib/prospect-enrichment/internalProviders.ts","utf8");
const engineSource=readFileSync("lib/prospectEnrichment.ts","utf8");
const routeSource=readFileSync("app/api/prospects/enrich/route.ts","utf8");

const group=(candidates)=>Object.groupBy(candidates,item=>item.personObservation?.id??"none");

test("JSON-LD Person preserves one published name title email and phone observation",()=>{
  const html='<script type="application/ld+json">{"@type":"Person","name":" Jane   Smith ","jobTitle":"Property Manager","email":"jane@example.com","telephone":"(818) 555-1234"}</script>';
  const candidates=engine.extractPublishedPageCandidates(html,"https://example.com/team","Team").filter(item=>item.personObservation);
  assert.deepEqual(candidates.map(item=>item.fieldName),["contact_name","contact_title","business_email","business_phone"]);
  assert.ok(candidates.every(item=>item.personObservation.kind==="json-ld-person"));
  assert.equal(candidates[0].value,"Jane Smith");
});

test("team card associates explicitly bounded person fields",()=>{
  const html='<div class="team-member"><h3> Jane   Smith </h3><p>Property Manager</p><a href="mailto:jane@example.com">Email</a><a href="tel:+18185551234">Call</a></div>';
  const candidates=engine.extractPublishedPersonContacts(html,"https://example.com/team","Team");
  assert.deepEqual(candidates.map(item=>item.fieldName),["contact_name","contact_title","business_email","business_phone"]);
  assert.equal(candidates[0].value,"Jane Smith");
  assert.equal(new Set(candidates.map(item=>item.personObservation.id)).size,1);
});

test("directory row creates a bounded observation",()=>{
  const html='<tr><td>John Doe</td><td>Facilities Manager</td><td><a href="mailto:john@example.com">Email</a></td></tr>';
  const candidates=engine.extractPublishedPersonContacts(html,"https://example.com/directory","Directory");
  assert.deepEqual(candidates.map(item=>item.value),["John Doe","Facilities Manager","john@example.com"]);
  assert.ok(candidates.every(item=>item.personObservation.kind==="directory-row"));
});

test("two person cards remain separate and never cross-assign contacts",()=>{
  const html='<div class="team-member"><h3>Jane Smith</h3><p>Manager</p><a href="mailto:jane@example.com">Email</a></div><div class="team-member"><h3>John Doe</h3><p>Director</p><a href="mailto:john@example.com">Email</a></div>';
  const observations=Object.values(group(engine.extractPublishedPersonContacts(html,"https://example.com/team","Team")));
  assert.equal(observations.length,2);
  assert.ok(observations.some(items=>items.some(x=>x.value==="Jane Smith")&&items.some(x=>x.value==="jane@example.com")&&!items.some(x=>x.value==="john@example.com")));
  assert.ok(observations.some(items=>items.some(x=>x.value==="John Doe")&&items.some(x=>x.value==="john@example.com")&&!items.some(x=>x.value==="jane@example.com")));
});

test("page and footer proximity alone never creates a person association",()=>{
  const html='<header><h2>Jane Smith</h2></header><footer><a href="mailto:jane@example.com">Email</a></footer>';
  assert.deepEqual(engine.extractPublishedPersonContacts(html,"https://example.com/team","Team"),[]);
});

test("generic mailbox is not assigned unless explicitly semantic",()=>{
  const weak='<div class="team-member"><h3>Jane Smith</h3><p>Manager</p><a href="mailto:info@example.com">Email</a></div>';
  const explicit='<div class="team-member" itemscope itemtype="https://schema.org/Person"><h3 itemprop="name">Jane Smith</h3><p itemprop="jobTitle">Manager</p><a itemprop="email" href="mailto:info@example.com">Email</a></div>';
  assert.ok(!engine.extractPublishedPersonContacts(weak,"https://example.com/team","Team").some(x=>x.fieldName==="business_email"));
  assert.ok(engine.extractPublishedPersonContacts(explicit,"https://example.com/team","Team").some(x=>x.value==="info@example.com"));
});

test("company and navigation labels are rejected as people while explicit titles remain",()=>{
  const html='<div class="team-member"><h3>Example Company LLC</h3><p>Owner</p><a href="mailto:owner@example.com">Email</a></div><div class="team-member"><h3>Contact Us</h3><p>Navigation</p></div>';
  assert.deepEqual(engine.extractPublishedPersonContacts(html,"https://example.com/team","Team"),[]);
  const valid=engine.extractPublishedPersonContacts('<div class="team-member"><h3>Alex Rivera</h3><p>Director of Operations</p></div>',"https://example.com/team","Team");
  assert.ok(valid.some(x=>x.fieldName==="contact_title"&&x.value==="Director of Operations"));
});

test("provenance is published and contains bounded structural observation metadata",()=>{
  assert.match(providerSource,/site-contact-discovery",version:"2"/);
  assert.match(providerSource,/sourceKind:item\.personObservation\?\.kind/);
  assert.match(providerSource,/personObservationId:item\.personObservation\.id,structuralEvidence:item\.personObservation\.kind/);
  assert.match(providerSource,/item\.sourceUrl,item\.sourcePageType,"published"/);
  assert.doesNotMatch(providerSource,/verificationStatus:"verified"/);
  assert.doesNotMatch(providerSource,/rawHtml|fullPage|domFragment/);
});

test("person extraction reuses the existing crawl and preserves generated-email safety",()=>{
  assert.match(engineSource,/extractJsonLd\(html,url,page,list\);list\.push\(\.\.\.extractPublishedPersonContacts\(html,url,page\)\)/);
  assert.equal((engineSource.match(/rankOfficialSiteContactLinks\(home,base\)/g)||[]).length,1);
  assert.match(engineSource,/\[\["info",55\],\["contact",50\],\["hello",45\]\]/);
  assert.doesNotMatch(engineSource,/jane\.smith@|jsmith@|firstName|lastName|mx lookup/i);
  assert.doesNotMatch(providerSource,/A-Leads|Apollo|Hunter|RocketReach|Clearbit/i);
  assert.doesNotMatch(routeSource,/site-contact-discovery|generated-role-email|official-website-contacts/);
});

test("name and title remain linked",()=>{
  const rows=engine.extractPublishedPersonContacts('<article class="profile"><h3>Robin Taylor</h3><p class="role">Regional Manager</p></article>',"https://example.com/people","People");
  assert.equal(rows.find(x=>x.fieldName==="contact_name")?.personObservation.id,rows.find(x=>x.fieldName==="contact_title")?.personObservation.id);
});

test("name and published email remain linked",()=>{
  const rows=engine.extractPublishedPersonContacts('<article class="profile"><h3>Robin Taylor</h3><a href="mailto:robin@example.com">Email</a></article>',"https://example.com/people","People");
  assert.equal(rows.find(x=>x.fieldName==="contact_name")?.personObservation.id,rows.find(x=>x.fieldName==="business_email")?.personObservation.id);
});

test("name and published phone remain linked",()=>{
  const rows=engine.extractPublishedPersonContacts('<article class="profile"><h3>Robin Taylor</h3><a href="tel:8185551234">Call</a></article>',"https://example.com/people","People");
  assert.equal(rows.find(x=>x.fieldName==="contact_name")?.personObservation.id,rows.find(x=>x.fieldName==="business_phone")?.personObservation.id);
});

test("complete person contact has one observation id",()=>{
  const rows=engine.extractPublishedPersonContacts('<article class="profile"><h3>Robin Taylor</h3><p>General Manager</p><a href="mailto:robin@example.com">Email</a><a href="tel:8185551234">Call</a></article>',"https://example.com/people","People");
  assert.equal(rows.length,4);assert.equal(new Set(rows.map(x=>x.personObservation.id)).size,1);
});

test("person A email is not assigned to person B",()=>{
  const rows=engine.extractPublishedPersonContacts('<article class="profile"><h3>Robin Taylor</h3><a href="mailto:robin@example.com">Email</a></article><article class="profile"><h3>Casey Morgan</h3><p>Owner</p></article>',"https://example.com/people","People");
  const casey=rows.filter(x=>x.personObservation.id===rows.find(x=>x.value==="Casey Morgan")?.personObservation.id);
  assert.ok(!casey.some(x=>x.value==="robin@example.com"));
});

test("footer email is not assigned to a staff member",()=>{
  const rows=engine.extractPublishedPersonContacts('<article class="profile"><h3>Robin Taylor</h3><p>Manager</p></article><footer><a href="mailto:robin@example.com">Email</a></footer>',"https://example.com/people","People");
  assert.ok(!rows.some(x=>x.fieldName==="business_email"));
});

test("unmarked generic mailbox is excluded from person observation",()=>{
  const rows=engine.extractPublishedPersonContacts('<article class="profile"><h3>Robin Taylor</h3><a href="mailto:office@example.com">Email</a></article>',"https://example.com/people","People");
  assert.ok(!rows.some(x=>x.fieldName==="business_email"));
});

test("explicit schema email may associate a generic mailbox",()=>{
  const html='<script type="application/ld+json">{"@type":"Person","name":"Robin Taylor","jobTitle":"Leasing Manager","email":"leasing@example.com"}</script>';
  const rows=engine.extractPublishedPageCandidates(html,"https://example.com/people","People").filter(x=>x.personObservation);
  assert.ok(rows.some(x=>x.value==="leasing@example.com"));
});

test("company name is rejected as person",()=>{
  const rows=engine.extractPublishedPersonContacts('<article class="profile"><h3>Example Properties LLC</h3><p>Management</p></article>',"https://example.com/people","People");
  assert.equal(rows.length,0);
});

test("navigation text is rejected as person",()=>{
  const rows=engine.extractPublishedPersonContacts('<article class="profile"><h3>Our Team</h3><p>Learn More</p></article>',"https://example.com/people","People");
  assert.equal(rows.length,0);
});

test("title must be explicit in the bounded structure",()=>{
  const rows=engine.extractPublishedPersonContacts('<article class="profile"><h3>Robin Taylor</h3></article><p>President</p>',"https://example.com/people","People");
  assert.ok(!rows.some(x=>x.fieldName==="contact_title"));
});

test("person whitespace is normalized",()=>{
  const rows=engine.extractPublishedPersonContacts('<article class="profile"><h3>  Robin   Taylor </h3><p>  Community   Manager </p></article>',"https://example.com/people","People");
  assert.deepEqual(rows.map(x=>x.value),["Robin Taylor","Community Manager"]);
});

test("person candidates preserve actual source URL",()=>{
  const source="https://example.com/leadership";
  const rows=engine.extractPublishedPersonContacts('<article class="profile"><h3>Robin Taylor</h3><p>President</p></article>',source,"Leadership");
  assert.ok(rows.every(x=>x.sourceUrl===source&&x.sourcePageType==="Leadership"));
});

test("published remains separate from verified",()=>{
  assert.match(providerSource,/item\.sourceUrl,item\.sourcePageType,"published"/);
  assert.doesNotMatch(providerSource,/site-contact-discovery[\s\S]{0,500}"verified"/);
});

test("existing site-contact discovery remains bounded",()=>{
  assert.match(engineSource,/SITE_CONTACT_MAX_TOTAL_PAGES=7/);
  assert.match(engineSource,/slice\(0,SITE_CONTACT_MAX_ADDITIONAL_PAGES\)/);
});

test("API route remains provider neutral",()=>{
  assert.doesNotMatch(routeSource,/site-contact-discovery|generated-role-email|official-website-contacts/);
});
