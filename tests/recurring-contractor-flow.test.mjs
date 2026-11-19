import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const code=ts.transpileModule(readFileSync('lib/contractors/bookingFrequency.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const module={exports:{}};new Function('module','exports',code)(module,module.exports);
const frequency=module.exports.contractorBookingFrequency;
test('dispatch frequency normalization distinguishes recurring from one-time bookings',()=>{
 for(const [value,expected] of [['weekly','Weekly'],['Bi-weekly','Biweekly'],['Every other week','Biweekly'],['Multiple Days Per Week','Multiple Days Per Week'],['Twice monthly','Twice Monthly'],['Monthly','Monthly'],['Every 4 weeks','Every 4 Weeks'],['One-time','One-Time'],['','One-Time']])assert.equal(frequency(value),expected);
});
test('internal recurring requests open agreement review and backend preserves every contractor frequency',()=>{
 const ui=readFileSync('components/contractors/ContractorManagement.tsx','utf8');const api=readFileSync('app/api/contractors/route.ts','utf8');
 assert.match(api,/bookingFrequency:contractorBookingFrequency\(input.frequency\)/);
 assert.match(api,/let agreementRequired=contractorBookingFrequency\(input.frequency\)!=="One-Time"/);
 assert.match(api,/bookingFrequency:existing\[0\].frequency/);
 assert.match(ui,/if\(result.agreementRequired\)router.push\(`\/agreements\?contractorOpportunityId=/);
 assert.match(api,/if\(action==="agreementSource"\)\{\s*requireInternal\(ctx\)/);
});
