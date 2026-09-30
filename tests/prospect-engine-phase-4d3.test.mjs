import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const foundation=await import("../lib/prospect-enrichment/providerFoundation.ts");
const waterfall=await import("../lib/prospect-enrichment/waterfallPlanner.ts");
const route=readFileSync("app/api/prospects/enrich/route.ts","utf8");
const orchestrator=readFileSync("lib/prospect-enrichment/orchestrator.ts","utf8");
const adapters=readFileSync("lib/prospect-enrichment/internalProviders.ts","utf8");

const descriptor=(key,priority,capabilities,extra={})=>({providerKey:key,version:"1",capabilities,priority,costClass:"free",enabled:true,requiresVerifiedDomain:false,requiresWebsite:false,supportsCache:false,stopPolicy:"when-needed",async findEmails(){return{status:"not_found",candidates:[]}},...extra});
const emptyNeeds=()=>({companyResolution:false,websiteContacts:false,businessEmail:false,businessPhone:false,address:false,city:false,state:false,zip:false,emailVerification:false,phoneVerification:false});
const state=(overrides={})=>({subject:{discoveryResultId:"result",businessName:"Business"},needs:emptyNeeds(),attemptedFingerprints:new Set(),executedBaselineProviders:new Set(),providerCalls:0,creditsUsed:0,costMinorUnits:0,...overrides});
const fingerprint=(provider,operation)=>`${provider.providerKey}|${operation}|input`;

test("registry and planner order providers deterministically by priority then key",()=>{
  const registry=new foundation.ProviderRegistry([descriptor("z",20,["business_email_find"]),descriptor("b",10,["business_email_find"]),descriptor("a",10,["business_email_find"])]);
  assert.deepEqual(registry.providers.map(provider=>provider.providerKey),["a","b","z"]);
  const planner=new waterfall.WaterfallPlanner(registry);
  assert.equal(planner.next(state({needs:{...emptyNeeds(),businessEmail:true}}),fingerprint).provider.providerKey,"a");
});

test("capability selection stops email while unresolved phone continues",()=>{
  const registry=new foundation.ProviderRegistry([descriptor("email",10,["business_email_find"]),descriptor("phone",20,["business_phone_find"],{findEmails:undefined,async findPhones(){return{status:"not_found",candidates:[]}}})]);
  const plan=new waterfall.WaterfallPlanner(registry).next(state({needs:{...emptyNeeds(),businessPhone:true}}),fingerprint);
  assert.equal(plan.provider.providerKey,"phone");
  assert.equal(plan.capability,"business_phone_find");
});

test("authoritative discovery phone prevents unnecessary phone lookup",()=>{
  const needs=foundation.planEnrichmentNeeds({discoveryResultId:"result",businessName:"Business",phone:"818-555-1212"});
  const registry=new foundation.ProviderRegistry([descriptor("phone",10,["business_phone_find"])]);
  assert.equal(needs.businessPhone,false);
  assert.equal(new waterfall.WaterfallPlanner(registry).next(state({needs}),fingerprint),null);
});

test("verified-domain and website prerequisites block ineligible providers",()=>{
  const generated=descriptor("generated",1000,["business_email_find"],{requiresVerifiedDomain:true,stopPolicy:"last-resort"});
  const website=descriptor("website",30,["business_contact_enrichment"],{requiresWebsite:true});
  const planner=new waterfall.WaterfallPlanner(new foundation.ProviderRegistry([generated,website]));
  assert.equal(planner.next(state({needs:{...emptyNeeds(),businessEmail:true,websiteContacts:true}}),fingerprint),null);
  assert.equal(planner.next(state({subject:{discoveryResultId:"result",businessName:"Business",verifiedDomain:"example.com"},needs:{...emptyNeeds(),businessEmail:true}}),fingerprint).provider.providerKey,"generated");
});

test("generated email is last and skipped once published email satisfies the field",()=>{
  assert.match(adapters,/providerKey:"generated-role-email"[\s\S]*priority:1000[\s\S]*stopPolicy:"last-resort"/);
  const needs=foundation.planEnrichmentNeeds({discoveryResultId:"result",businessName:"Business",verifiedDomain:"example.com"},[{fieldName:"business_email",value:"info@example.com",normalizedValue:"info@example.com",sourceType:"Official Website",sourceUrl:"https://example.com/contact",sourcePageType:"Contact",confidence:90,retrievedAt:new Date().toISOString(),evidence:{providerKey:"website",providerVersion:"1",sourceKind:"Contact",sourceType:"Official Website",sourceUrl:"https://example.com/contact",sourcePageType:"Contact",verificationStatus:"published",discoveredAt:new Date().toISOString()}}]);
  assert.equal(needs.businessEmail,false);
});

test("provider failure can advance to the next eligible provider",()=>{
  const first=descriptor("first",10,["business_email_find"]),second=descriptor("second",20,["business_email_find"]);
  const planner=new waterfall.WaterfallPlanner(new foundation.ProviderRegistry([first,second]));
  const current=state({needs:{...emptyNeeds(),businessEmail:true}});
  assert.equal(planner.next(current,fingerprint).provider.providerKey,"first");
  current.attemptedFingerprints.add(fingerprint(first,"email_finding"));current.providerCalls=1;
  assert.equal(planner.next(current,fingerprint).provider.providerKey,"second");
  assert.match(orchestrator,/Provider-level failures are recorded and the next eligible adapter may continue/);
});

test("duplicate fingerprints and max-call budget stop execution",()=>{
  const provider=descriptor("email",10,["business_email_find"]),planner=new waterfall.WaterfallPlanner(new foundation.ProviderRegistry([provider]));
  const needs={...emptyNeeds(),businessEmail:true};
  assert.equal(planner.next(state({needs,attemptedFingerprints:new Set([fingerprint(provider,"email_finding")])}),fingerprint),null);
  assert.equal(planner.next(state({needs,providerCalls:8}),fingerprint),null);
});

test("free-only policy rejects paid execution and budget limits future providers",()=>{
  const paid=descriptor("paid",10,["business_email_find"],{costClass:"paid",estimatedCredits:1,estimatedCostMinorUnits:5});
  const registry=new foundation.ProviderRegistry([paid]);
  assert.throws(()=>registry.assertFreeOnly());
  const planner=new waterfall.WaterfallPlanner(registry,{...waterfall.DEFAULT_PROVIDER_EXECUTION_POLICY});
  assert.equal(planner.next(state({needs:{...emptyNeeds(),businessEmail:true}}),fingerprint),null);
});

test("planner stops with unresolved needs when no eligible provider remains",()=>{
  const disabled=descriptor("disabled",10,["business_email_find"],{enabled:false});
  const planner=new waterfall.WaterfallPlanner(new foundation.ProviderRegistry([disabled]));
  assert.equal(planner.next(state({needs:{...emptyNeeds(),businessEmail:true}}),fingerprint),null);
});

test("future providers register centrally without route branching and output stays compatible",()=>{
  assert.doesNotMatch(route,/osm-metadata|official-website-resolver|official-website-contacts|generated-role-email/);
  assert.match(orchestrator,/this\.planner\.next/);
  assert.match(orchestrator,/normalizeDedupeAndRank/);
  assert.match(route,/p_candidates:found\.candidates/);
  for(const key of ["providerKey","providerVersion","sourceKind","verificationStatus","discoveredAt"])assert.match(readFileSync("lib/prospect-enrichment/providerFoundation.ts","utf8"),new RegExp(key));
});
