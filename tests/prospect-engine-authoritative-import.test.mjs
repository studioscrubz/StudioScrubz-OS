import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
const migration=read("supabase/migrations/20261001165332_prospect_enrichment_authoritative_import_overlay.sql");
const service=read("lib/services/prospects.ts");
const ui=read("components/prospects/ProspectDiscovery.tsx");

test("accepted published email website and phone become effective insert values",()=>{
  assert.match(migration,/f\.decision='Accepted'/);
  assert.match(migration,/effective_email:=nullif\(btrim\(effective->>'businessEmail'\),''\)/);
  assert.match(migration,/effective_website:=nullif\(btrim\(effective->>'website'\),''\)/);
  assert.match(migration,/effective_phone:=nullif\(btrim\(effective->>'businessPhone'\),''\)/);
  assert.match(migration,/entity\.business_name,entity\.category,effective_website,effective_email,effective_phone/);
});

test("rejected and pending evidence cannot silently import",()=>{
  assert.doesNotMatch(migration,/decision in\('Accepted','Rejected'\).*candidate_value/s);
  assert.match(migration,/where f\.enrichment_item_id=enrichment_item\.id\s+and f\.decision='Accepted'/);
  assert.match(migration,/where enrichment_item_id=enrichment_item\.id and decision='Pending'/);
  assert.match(migration,/Resolve all enrichment candidates for % before importing/);
});

test("explicitly accepted generated evidence is eligible without losing provenance",()=>{
  assert.match(migration,/case f\.source_type when 'Official Website' then 0 when 'OpenStreetMap' then 1 else 2 end/);
  assert.match(migration,/'acceptedEnrichmentEvidenceIds',effective->'acceptedEvidenceIds'/);
  assert.doesNotMatch(migration,/delete from public\.prospect_enrichment_fields/);
  assert.doesNotMatch(migration,/update public\.prospect_discovery_entities/);
});

test("authoritative duplicate classification uses the effective overlay",()=>{
  for(const field of ["normalized_email","normalized_phone","normalized_domain","normalized_address","normalized_zip"])assert.match(migration,new RegExp(`${field}:=`));
  assert.match(migration,/normalized_email:=nullif\(lower\(effective_email\),''\)/);
  assert.match(migration,/normalized_domain:=public\.prospect_domain_normalized\(coalesce\(effective_website/);
  assert.ok(migration.indexOf("effective:=public.prospect_discovery_effective_values")<migration.lastIndexOf("from public.prospects p"));
});

test("server revalidation preserves stale-review protection",()=>{
  assert.match(migration,/client_classification is distinct from authoritative_classification/);
  assert.match(migration,/Duplicate status changed for %\. Review discovery results again before importing/);
  assert.match(migration,/submitted_match is distinct from authoritative_match/);
  assert.match(migration,/Duplicate match changed for %\. Review discovery results again before merging/);
});

test("merge fills only missing CRM fields from the effective overlay",()=>{
  for(const pair of [["business_email","effective_email"],["business_phone","effective_phone"],["website","effective_website"],["address","effective_address"]])assert.match(migration,new RegExp(`${pair[0]}=coalesce\\(nullif\\(p\\.${pair[0]},''\\),${pair[1]}\\)`));
  assert.doesNotMatch(migration,/business_email=effective_email/);
});

test("conflicting accepted values fail instead of relying on iteration order",()=>{
  assert.match(migration,/having count\(distinct case f\.field_name/);
  assert.match(migration,/Multiple accepted values exist for % on %\. Keep only one accepted value/);
  assert.match(ui,/Multiple accepted values exist for/);
});

test("client submits only enrichment identity and never enriched values",()=>{
  assert.match(service,/enrichmentItemId:reviews\.find\(review=>review\.resultId===result\.resultId\)\?\.itemId\?\?null/);
  assert.match(service,/discoveryImportSelections\(results,reviews,true\)/);
  assert.doesNotMatch(service,/candidate_value|businessEmail:|businessPhone:/);
  assert.match(migration,/where id=p_enrichment_item_id and discovery_result_id=rr\.id/);
  assert.match(migration,/where id=enrichment_item\.run_id and discovery_run_id=rr\.run_id/);
});

test("client duplicate preview is projected by the same database resolver",()=>{
  assert.match(migration,/create function public\.get_prospect_discovery_import_preview/);
  assert.match(migration,/effective:=public\.prospect_discovery_effective_values\(result_id,enrichment_item_id\)/);
  assert.match(service,/rpc\("get_prospect_discovery_import_preview"/);
  assert.match(ui,/reclassifyFromServer/);
  assert.doesNotMatch(ui,/function applyOverlay/);
});

test("authorization and function grants remain hardened",()=>{
  assert.match(migration,/security definer\s+set search_path=''/g);
  assert.match(migration,/actor uuid := \(select auth\.uid\(\)\)/);
  assert.match(migration,/public\.has_any_role\(array\['Master Admin','Administrator','Manager'\]\)/);
  assert.match(migration,/discovery\.created_by=actor\s+and discovery\.assigned_user_id=actor/);
  assert.match(migration,/revoke all on function public\.prospect_discovery_effective_values/);
  assert.match(migration,/grant execute on function public\.get_prospect_discovery_import_preview/);
  assert.doesNotMatch(migration,/grant execute on function public\.prospect_discovery_effective_values/);
});
