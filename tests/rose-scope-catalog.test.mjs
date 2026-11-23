import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const read=path=>fs.readFileSync(new URL("../"+path,import.meta.url),"utf8");
const sql=read("supabase/migrations/20261123150000_rose_company_scope_catalog.sql");
const match=sql.match(/scope_catalog='([\s\S]*?)'::jsonb/);
const catalog=JSON.parse(match[1].replaceAll("''","'"));
test("Rose checklist stores all three service tiers without changing payout rates",()=>{
 assert.deepEqual(catalog.services,["Regular","Deep Cleaning","Move-In / Move-Out"]);
 assert.equal(catalog.areas.length,3);
 assert.deepEqual(catalog.areas.map(a=>a.tasks.length),[23,17,16]);
 assert.deepEqual(catalog.services.map((_,i)=>catalog.areas.reduce((count,area)=>count+area.tasks.filter(t=>t.included[i]).length,0)),[34,45,55]);
 assert.match(sql,/service_types=array\['Standard Cleaning','Deep Cleaning','Move-In \/ Move-Out Cleaning'\]/);
 assert.doesNotMatch(sql,/proposed_rates|negotiated_rates/);
});
test("Scope distinctions and exclusions reflect source checklist",()=>{
 const all=catalog.areas.flatMap(a=>a.tasks);
 const get=name=>all.find(t=>t.task===name)?.included;
 assert.deepEqual(get("Clean inside of refrigerator"),[false,false,true]);
 assert.deepEqual(get("Scrub tile grout"),[false,true,true]);
 assert.deepEqual(get("Vacuum furniture"),[false,true,false]);
 assert.deepEqual(get("Clean countertops"),[true,true,true]);
 assert.match(catalog.notes.join(" " ),/Garage cleaning is excluded/);
 assert.match(catalog.notes.join(" "),/additional charges/);
});
test("Rose scope generated server side for imported and portal opportunities",()=>{
 const route=read("app/api/contractors/route.ts");
 assert.match(route,/contractorServiceScope\(catalog,serviceType\)/);
 assert.match(route,/scope=roseChecklist/);
 assert.match(route,/scope_catalog/);
 const portal=read("components/contractors/ContractorPortal.tsx");
 assert.match(portal,/contractorServiceScope\(roseCatalog,serviceType\)/);
 const admin=read("components/contractors/ContractorManagement.tsx");
 assert.match(admin,/contractorServiceScope\(roseCatalog/);
});
