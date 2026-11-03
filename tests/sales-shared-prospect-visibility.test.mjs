import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read=(path)=>readFileSync(new URL(path,import.meta.url),"utf8");
const page=read("../components/prospects/ProspectsPage.tsx");
const sales=read("../supabase/migrations/20261019160000_sales_shared_prospect_visibility.sql");
const service=read("../lib/services/prospects.ts");
const routes=read("../app/(workspace)/my-prospects/page.tsx");
test("Sales My Prospects defaults to shared visible leads and offers an assigned-only scope",()=>{
 assert.match(routes,/ProspectsPage assignedOnly/);
 assert.match(page,/useState<"shared"\|"mine">\("shared"\)/);
 assert.match(page,/const showAssignedOnly=assignedOnly&&prospectScope==="mine"/);
 assert.match(page,/Shared prospects \(/);
 assert.match(page,/Assigned to me \(/);
 assert.match(page,/!showAssignedOnly\|\|row\.assigned_user_id===profile\?\.id/);
});
test("shared Sales access is RLS-backed, not a forced assignment or administrative override",()=>{
 assert.match(sales,/Sales read shared prospects/);
 assert.match(sales,/using \(public\.has_any_role\(array\['Sales'\]\)\)/);
 assert.match(page,/Viewing a prospect does not assign ownership/);
 assert.match(page,/View only · Not assigned/);
 assert.match(page,/selected\.assigned_user_id===profile\?\.id/);
 assert.match(page,/merge=\{canManageAll\?mergeInto:null\}/);
 assert.doesNotMatch(page,/setRows\(prospects\.filter\(row=>row\.assigned_user_id===profile\?\.id\)\)/);
});
test("Sales initial load waits for resolved profile and queries existing prospect service",()=>{
 assert.match(page,/if\(profile\?\.id\)queueMicrotask\(\(\)=>void load\(\)\)/);
 assert.match(service,/\.from\("prospects"\)\.select\("\*"\)/);
});
