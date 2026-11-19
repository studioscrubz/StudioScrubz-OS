import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const code=ts.transpileModule(readFileSync('lib/pricing/agreementBillingEdit.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const module={exports:{}};new Function('module','exports',code)(module,module.exports);
const allowed=module.exports.canEditContractorBilling;
const agreement={status:'Active',client:{client_type:'Contractor'},proposal_id:null,signing_method:null,client_signed_at:null,representative_signature:null};
const admin={role:'Master Admin',is_active:true};
test('Master Admin may configure unsigned active contractor billing',()=>{assert.equal(allowed(agreement,admin),true);assert.equal(allowed({...agreement,status:'Paused'},admin),true)});
test('signed, proposal-backed, ordinary-client and unauthorized records stay locked',()=>{
 for(const patch of [{signing_method:'physical'},{client_signed_at:'2026-11-18'},{representative_signature:{}},{proposal_id:'proposal'},{client:{client_type:'Residential'}}])assert.equal(allowed({...agreement,...patch},admin),false);
 assert.equal(allowed(agreement,{role:'Manager',is_active:true}),false);assert.equal(allowed(agreement,{...admin,is_active:false}),false);
 const source=readFileSync('lib/services/agreements.ts','utf8');assert.match(source,/if\(invoices.data\?\.length\|\|occurrences.data\?\.length\)/);
});
