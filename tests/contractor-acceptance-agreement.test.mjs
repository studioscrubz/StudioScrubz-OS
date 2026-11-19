import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const ui=readFileSync('components/contractors/ContractorManagement.tsx','utf8');
const api=readFileSync('app/api/contractors/route.ts','utf8');
const agreements=readFileSync('components/agreements/AgreementsPage.tsx','utf8');
test('staff manual dispatch confirmation recognizes all created reference formats on both sides',()=>{
 for(const source of [ui,api]){
  const regex=source.match(/\/\^\(brava\|rose\|brava-manual\|contractor\|contractor-manual\):\[a-f0-9\]\{64\}\$\//)?.[0];
  assert.ok(regex);
  const matcher=new RegExp(regex.slice(1,-1));
  for(const prefix of ['brava','rose','brava-manual','contractor','contractor-manual'])assert.equal(matcher.test(prefix+':'+ 'a'.repeat(64)),true);
  assert.equal(matcher.test('unknown:'+ 'a'.repeat(64)),false);
 }
 assert.match(api,/opp.submitted_by!==null/);
 assert.match(api,/input.confirmed!==true\|\|input.amount!==amount\|\|input.scope!==scope/);
 assert.match(api,/eq\("updated_at",opp.updated_at\)/);
});
test('recurring agreement uses existing form and validates client property relationship',()=>{
 assert.match(ui,/hasPermission\(profile,"agreements.manage"\)/);
 assert.match(ui,/Create recurring service agreement/);
 assert.match(agreements,/params.get\("create"\)===\"1\"/);
 assert.match(agreements,/row.id===initialLocation.propertyId&&row.client_id===initialLocation.clientId&&!row.archived_at/);
 assert.match(agreements,/client_id:client.id,property_id:property.id,division:property.property_type/);
});
