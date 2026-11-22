import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {contractorBookingFrequency as frequency} from '../lib/contractors/bookingFrequency.ts';
test('dispatch frequency normalization distinguishes recurring from one-time bookings',()=>{
 for(const [value,expected] of [['weekly','Weekly'],['Bi-weekly','Biweekly'],['Every other week','Biweekly'],['Multiple Days Per Week','Multiple Days Per Week'],['Twice monthly','Twice Monthly'],['Monthly','Monthly'],['Every 4 weeks','Every 4 Weeks'],['One-time','One-Time'],['','One-Time']])assert.equal(frequency(value),expected);
});
test('internal recurring requests can schedule without opening the agreements page',()=>{
 const ui=readFileSync('components/contractors/ContractorManagement.tsx','utf8');const api=readFileSync('app/api/contractors/route.ts','utf8');
 assert.match(api,/bookingFrequency:contractorBookingFrequency\(input.frequency\)/);
 assert.match(api,/if\(action==="scheduleRecurringVisits"\)\{\s*requireInternal\(ctx\)/);
 assert.match(api,/bookingFrequency:existing\[0\].frequency/);
 assert.doesNotMatch(ui,/result.agreementRequired/);
 assert.match(ui,/<ContractorRecurringSchedule/);
 assert.match(api,/if\(action==="agreementSource"\)\{\s*requireInternal\(ctx\)/);
});

test('direct recurring visits are written atomically with one job per date',()=>{
 const migration=readFileSync('supabase/migrations/20261122210000_optional_contractor_schedule.sql','utf8');
 assert.match(migration,/unique index jobs_contractor_schedule_visit_idx/);
 assert.match(migration,/scheduled_date=new.scheduled_date/);
 assert.match(migration,/for update/);
 assert.match(migration,/linked_job_id=first_job/);
 assert.match(migration,/An agreement already covers this request/);
});
