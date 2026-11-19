import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync('components/agreements/AgreementsPage.tsx','utf8');
const helpers=source.slice(source.indexOf('function hasClientSignature('),source.indexOf('function representativeSigningEligible('));
const js=ts.transpileModule(helpers,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const label=new Function(js+'; return agreementSignatureState;')();
test('administratively active unsigned record shows Active, while drafts still require signature',()=>{
 assert.equal(label({status:'Active'}),'Active');assert.equal(label({status:'Draft'}),'Awaiting Client Signature');assert.equal(label({status:'Sent'}),'Awaiting Client Signature');
 assert.match(source,/\["Active", "Fully Signed", "Verbal Acceptance Documented"\].includes\(agreementSignatureState\(agreement\)\) \? "text-green-700"/);
});
test('signed record still shows its actual signature completion state',()=>{
 assert.equal(label({status:'Active',client_signed_at:'2026-11-18',representative_signature:{}}),'Fully Signed');
 assert.equal(label({status:'Accepted',client_signed_at:'2026-11-18'}),'Awaiting StudioScrubz Signature');
});
