import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {contractorStartAllowed,contractorBookingWindow,contractorTimeMinutes,contractorDateAllowed} from "../lib/contractors/division.ts";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
test("Residential starts 8AM through 6PM, latest completion 8PM Pacific",()=>{
 assert.equal(contractorStartAllowed("Residential","07:59",60),false);
 assert.equal(contractorStartAllowed("Residential","08:00",120),true);
 assert.equal(contractorStartAllowed("Residential","18:00",120),true);
 assert.equal(contractorStartAllowed("Residential","18:00",121),false);
 assert.equal(contractorStartAllowed("Residential","18:15",60),false);
 assert.equal(contractorStartAllowed("Residential","17:45",135),true);
 assert.equal(contractorStartAllowed("Residential","17:45",136),false);
 assert.equal(contractorStartAllowed("Residential","12:00",480),true);
 assert.equal(contractorStartAllowed("Residential","12:00",481),false);
 assert.deepEqual(contractorBookingWindow("Residential"),{open:480,lastStart:1080,close:1200});
 assert.equal(contractorTimeMinutes("18:00"),1080);
 assert.equal(contractorTimeMinutes("25:10"),null);
});
test("Commercial contractor time windows remain unchanged",()=>{
 assert.equal(contractorBookingWindow("Commercial"),null);
 assert.equal(contractorStartAllowed("Commercial","02:15",240),true);
 assert.equal(contractorStartAllowed("Commercial","23:45",120),true);
});
test("Company classification includes existing residential and commercial partners",()=>{
 const migration=read("supabase/migrations/20261119164000_contractor_divisions.sql");
 for(const id of ["a1b0e01c-3990-47e8-9c4f-40c772ce35fd","ee489374-42ce-4134-bee6-190d86be8edd","0ddb8c63-4c5d-4082-93df-9c9b0e105dfa"])assert.ok(migration.includes(id));
 assert.match(migration,/contractor_division text not null default 'Residential'/);
});
test("Booking requests, imported bookings, and calendar enforce company division",()=>{
 const api=read("app/api/contractors/route.ts");
 assert.ok(api.includes('getContractorMonthlyAvailability(params.get("month")??"",building,category.contractor_division as ContractorDivision)'));
 assert.match(api,/contractorStartAllowed\(division,startTime,estimatedMinutes\)/);
 assert.match(api,/if\(type!==division\)/);
 const calendar=read("lib/contractors/availability.ts");
 assert.match(calendar,/contractorStartAllowed\(division,/);
 const ui=read("components/contractors/ContractorPortal.tsx");
 assert.match(ui,/contractorStartAllowed\(contractorDivision,time,estimatedDurationMinutes\)/);
 assert.match(ui,/value=\{contractorDivision\} disabled/);
 const management=read("components/contractors/ContractorManagement.tsx");
 assert.match(management,/{division} Contractors/);
 assert.match(management,/contractor_division:companyEdit\.contractor_division/);
});

test("Residential weekends close after the last open Saturday, and Sundays are always closed",()=>{
 assert.equal(contractorDateAllowed("Residential","2026-11-22"),false);
 assert.equal(contractorDateAllowed("Residential","2026-11-23"),true);
 assert.equal(contractorDateAllowed("Residential","2026-11-21"),true);
 assert.equal(contractorDateAllowed("Residential","2026-11-28"),false);
 assert.equal(contractorDateAllowed("Residential","2026-11-29"),false);
 assert.equal(contractorDateAllowed("Residential","2027-01-02"),false);
 assert.equal(contractorDateAllowed("Commercial","2026-11-28"),true);
 assert.equal(contractorDateAllowed("Commercial","2026-11-22"),true);
 assert.equal(contractorDateAllowed("Residential","2026-02-30"),false);
 assert.equal(contractorDateAllowed("Residential","invalid"),false);
});
test("Weekend restrictions enforced on server, calendar and booking form",()=>{
 const api=read("app/api/contractors/route.ts");
 assert.match(api,/if\(!contractorDateAllowed\(division,date\)\)/);
 const calendar=read("lib/contractors/availability.ts");
 assert.match(calendar,/contractorDateAllowed\(division,date\)/);
 const portal=read("components/contractors/ContractorPortal.tsx");
 assert.match(portal,/Residential bookings are unavailable on this date/);
 assert.match(portal,/!contractorDateAllowed\(contractorDivision,requestedDate\)/);
});
