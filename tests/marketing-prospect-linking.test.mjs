import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prospectMatchesFlyer } from "../lib/marketingMaterials/prospectMatching.mjs";
const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");

test("industry matching supports multiple flyer categories without changing prospect",()=>{
 const p={industry:"Property Management",company_type:"Multifamily",services:["Pressure Washing"]};
 assert.equal(prospectMatchesFlyer(p,{category:"Property Management / Multifamily"}),true);
 assert.equal(prospectMatchesFlyer(p,{category:"Pressure Washing"}),true);
 assert.equal(prospectMatchesFlyer(p,{category:"Recording / Production Facilities"}),false);
 assert.equal(p.industry,"Property Management");
});
test("contractors match post-construction and unrelated categories do not",()=>{
 assert.equal(prospectMatchesFlyer({industry:"General Contractor",services:[]},{category:"Post-Construction"}),true);
 assert.equal(prospectMatchesFlyer({industry:"Barbershop",services:[]},{category:"Post-Construction"}),false);
});
test("marketing UI selects existing prospects without automatic sends",()=>{
 const page=read("components/marketingMaterials/MarketingMaterialsPage.tsx");
 assert.match(page,/Existing Prospect/);
 assert.match(page,/prospectMatchesFlyer/);
 assert.match(page,/chooseProspect/);
 assert.match(page,/Filter flyers by category/);
 assert.match(page,/I confirm the recipient/);
 assert.match(page,/Confirm & Send/);
});
test("server validates linked prospect before email and persists relationship",()=>{
 const route=read("app/api/marketing-materials/route.ts");
 const migration=read("supabase/migrations/20261012160000_marketing_delivery_prospect_link.sql");
 assert.match(route,/existingProspect/);
 assert.match(route,/link_marketing_delivery_prospect/);
 assert.ok(route.indexOf("link_marketing_delivery_prospect")<route.indexOf("sendResendEmail({"));
 assert.match(migration,/prospect_id uuid references public\.prospects\(id\) on delete set null/);
 assert.match(migration,/prospect\.assigned_user_id is distinct from auth\.uid\(\)/);
 assert.match(migration,/delivery\.status <> 'Prepared'/);
 assert.match(migration,/delivery\.recipient_email/);
 assert.match(migration,/grant execute on function public\.link_marketing_delivery_prospect/);
});
