import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const engine=fs.readFileSync("lib/prospectEnrichment.ts","utf8");
const route=fs.readFileSync("app/api/prospects/enrich/route.ts","utf8");
const migration=fs.readFileSync("supabase/migrations/20260930002727_prospect_engine_phase_4b_website_discovery.sql","utf8");

test("phase 4b discovers a website only when the discovery result lacks one",()=>{
  assert.match(route,/if\(!website\)/);
  assert.match(route,/discoverOfficialWebsite/);
});
test("website discovery verifies identity and location before enrichment",()=>{
  assert.match(engine,/score<70/);
  assert.match(engine,/business name/);
  assert.match(engine,/ZIP/);
  assert.match(engine,/address/);
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
test("phase 4b is forward only",()=>{
  assert.match(migration,/alter table public\.prospect_enrichment_items/);
  assert.doesNotMatch(migration,/drop table|drop column/i);
});
