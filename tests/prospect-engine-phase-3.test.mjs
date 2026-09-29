import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
const migration=read("supabase/migrations/20260929160406_prospect_engine_phase_3_public_discovery.sql");
const discovery=read("lib/prospectDiscovery.ts");
const route=read("app/api/prospects/discover/route.ts");
const ui=read("components/prospects/ProspectDiscovery.tsx");

test("Phase 3 centralizes bounded OSM discovery categories",()=>{
  for(const category of ["Property Management / Multifamily","Commercial Offices","Post-Construction / Contractors","Airbnb / Short-Term Rentals","Restaurants / Hospitality","Salons / Barbershops","Gyms / Spas","Recording / Production Facilities","Luxury Property Care","Pressure Washing Opportunities","Other Commercial"])assert.match(discovery,new RegExp(category.replace(/[\/-]/g,"\\$&")));
  assert.match(discovery,/DISCOVERY_MAX_RADIUS_METERS=25_000/);
  assert.match(discovery,/DISCOVERY_MAX_RESULTS=100/);
  assert.match(discovery,/\[out:json\]\[timeout:20\]/);
});

test("discovery is server authenticated, provider-safe, and never automatic",()=>{
  assert.match(route,/server\.auth\.getUser\(\)/);
  assert.match(route,/profile\?\.is_active/);
  assert.match(route,/\["Master Admin","Administrator","Manager","Sales"\]/);
  assert.match(route,/StudioScrubz Prospect Engine\/1\.0/);
  assert.match(route,/nominatim\.openstreetmap\.org\/search/);
  assert.match(route,/overpass-api\.de\/api\/interpreter/);
  assert.match(route,/25_000/);
  assert.match(route,/cache:"no-store"/);
  assert.doesNotMatch(route,/google|yelp|linkedin/i);
  assert.doesNotMatch(route,/service[_-]?role/i);
  assert.match(ui,/Review public OpenStreetMap results before anything is saved/);
  assert.match(ui,/Import selected/);
});

test("RLS, role boundaries, caching, throttling, provenance, and idempotency are enforced",()=>{
  for(const table of ["prospect_discovery_runs","prospect_discovery_locations","prospect_discovery_entities","prospect_discovery_run_results"]){assert.match(migration,new RegExp(`alter table public\\.${table} enable row level security`));assert.match(migration,new RegExp(`revoke all on table[^;]*${table}`));}
  assert.match(migration,/has_any_role\(array\['Master Admin','Administrator','Manager'\]\)/);
  assert.match(migration,/has_any_role\(array\['Sales'\]\)/);
  assert.match(migration,/Sales discoveries must be self-assigned/);
  assert.match(migration,/created_at>now\(\)-interval '15 minutes'/);
  assert.match(migration,/pg_advisory_xact_lock/);
  assert.match(migration,/source_name,provider_identifier/);
  assert.match(migration,/unique\(created_by,request_id\)/);
  assert.match(migration,/unique\(run_id,entity_id\)/);
  assert.match(migration,/if rr\.imported_prospect_id is not null/);
  assert.match(migration,/license_attribution/);
  assert.match(migration,/grant select on table/);
  assert.doesNotMatch(migration,/grant (insert|update|delete|all) on table/i);
});

test("discovery accepts miles and converts provider and stored radii to meters",()=>{
  assert.match(discovery,/METERS_PER_MILE=1609\.344/);
  assert.match(discovery,/milesToMeters\(miles:number\).*Math\.round\(miles\*METERS_PER_MILE\)/);
  assert.equal(Math.round(1*1609.344),1609);
  assert.equal(Math.round(5*1609.344),8047);
  assert.match(ui,/radiusMiles/);
  assert.match(ui,/Radius in miles/);
  assert.match(ui,/>\{value\} mi</);
  assert.match(ui,/metersToMiles\(item\.distanceMeters\).*mi away/);
  assert.doesNotMatch(ui,/\bkm\b|kilometers?/i);
  assert.match(route,/const radiusMeters=milesToMeters\(radiusMiles\)/);
  assert.match(route,/p_radius_meters:radiusMeters/);
  assert.match(route,/buildOverpassQuery\(category,latitude,longitude,radiusMeters,keyword\)/);
  assert.match(route,/radiusMiles<DISCOVERY_MIN_RADIUS_MILES/);
  assert.match(route,/radiusMiles>DISCOVERY_MAX_RADIUS_MILES/);
});

test("result filters preserve underlying selections and source links are allowlisted",()=>{
  assert.match(discovery,/discoveryResultFilters.*All results.*New.*Possible Duplicate.*Exact Duplicate/);
  assert.match(discovery,/filterDiscoveryResults/);
  assert.match(ui,/visibleResults=filterDiscoveryResults\(classified,resultFilter,resultSearch\)/);
  assert.match(ui,/setResults\(current=>current\.map/);
  assert.doesNotMatch(ui,/setResults\(visibleResults/);
  assert.match(ui,/Hidden results keep their selections and duplicate decisions/);
  assert.match(discovery,/url\.protocol==="https:"&&url\.hostname==="www\.openstreetmap\.org"/);
  assert.match(discovery,/node\|way\|relation/);
  assert.match(ui,/target="_blank" rel="noopener noreferrer"/);
  assert.match(ui,/Source: /);
});

test("location resolution is cached independently from category discovery",()=>{
  assert.match(discovery,/normalizeDiscoveryLocation/);
  assert.match(migration,/create table public\.prospect_discovery_locations/);
  assert.match(migration,/create function public\.get_prospect_discovery_location/);
  assert.match(migration,/create function public\.cache_prospect_discovery_location/);
  assert.match(route,/rpc\("get_prospect_discovery_location"/);
  assert.match(route,/if\(cachedLocation\)/);
  assert.match(route,/rpc\("cache_prospect_discovery_location"/);
  assert.ok(route.indexOf('if(cachedLocation)')<route.indexOf('new URL(NOMINATIM_URL)'));
});

test("database revalidates duplicates authoritatively immediately before import",()=>{
  assert.match(migration,/authoritative_classification:='New'/);
  assert.match(migration,/from public\.prospects p/);
  assert.match(migration,/public\.prospect_phone_normalized\(e\.business_phone\)/);
  assert.match(migration,/public\.prospect_domain_normalized/);
  assert.match(migration,/public\.prospect_text_normalized/);
  assert.match(migration,/client_classification is distinct from authoritative_classification/);
  assert.match(migration,/Duplicate status changed.*Review discovery results again/);
  assert.match(migration,/submitted_match is distinct from authoritative_match/);
  assert.match(migration,/if rr\.imported_prospect_id is not null/);
});

test("review preserves public-source truth and explicit duplicate decisions",()=>{
  assert.match(ui,/Not supplied/);
  assert.match(ui,/inferred from public OSM tags/);
  assert.match(ui,/Exact duplicate/);
  assert.match(ui,/Possible duplicate/);
  assert.match(ui,/Import Separately/);
  assert.match(ui,/© OpenStreetMap contributors/);
  assert.match(migration,/decision not in\('Skip','Import Separately','Merge'\)/);
  assert.doesNotMatch(`${route}\n${ui}\n${migration}`,/send(email|sms)|automated outreach|createClient|createEstimate|cron\.schedule|openai/i);
});
