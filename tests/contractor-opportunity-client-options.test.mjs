import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const ui=readFileSync('components/contractors/ContractorManagement.tsx','utf8');
const api=readFileSync('app/api/contractors/route.ts','utf8');
test('opportunity dropdown includes LJ and every active company without a name allowlist',()=>{
 const expression=ui.match(/const submissionClients=companies.filter\((.+)\);/)[1];
 const filter=new Function('company',`return ${expression.replace(/^company=>/,'')}`);
 assert.equal(filter({name:'LJ Facility Services LLC',status:'Active'}),true);
 assert.equal(filter({name:'Another Contractor',status:'Active'}),true);
 assert.equal(filter({name:'BRAVA Home Cleaning',status:'Suspended'}),false);
 assert.equal(filter({name:'Rose Company',status:'Archived'}),false);
});
test('generic submissions require staff authorization and active company validation',()=>{
 assert.match(api,/const importing=brava\|\|generic\|\|action===\"importRoseBooking\"/);
 assert.match(api,/if\(importing\)\{\s*requireInternal\(ctx\)/);
 assert.match(api,/if\(company.status!==\"Active\"\)/);
 assert.match(api,/importing&&!manualEntry\?\{status:\"Awaiting Approval\"/);
 assert.match(ui,/createContractorOpportunity/);
 assert.match(ui,/importContractorBooking/);
 assert.match(ui,/propertyType:isBrava\?\"Residential\":submissionPropertyType/);
});
