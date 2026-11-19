import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {sameBuilding,bufferMinutesBetween,appointmentConflict,DEFAULT_TRAVEL_BUFFER_MINUTES} from "../lib/scheduling/travelBuffer.ts";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const first={address:"123 Main Street",address_line_2:"Unit 101",city:"Long Beach",state:"CA",zip:"90802"};
const second={...first,address_line_2:"Unit 202"};
const elsewhere={address:"500 Pacific Avenue",city:"Long Beach",state:"CA",zip:"90802"};
test("unit-to-unit same-building appointments never receive an hour travel buffer",()=>{
 assert.equal(DEFAULT_TRAVEL_BUFFER_MINUTES,60);
 assert.equal(sameBuilding(first,second),true);
 assert.equal(bufferMinutesBetween(first,second),0);
 assert.equal(appointmentConflict(
  {start:540,end:660,building:first},
  {start:660,end:780,building:second},
 ),false);
});
test("separate locations require sixty minutes after the earlier service",()=>{
 assert.equal(bufferMinutesBetween(first,elsewhere),60);
 assert.equal(appointmentConflict(
  {start:540,end:660,building:first},
  {start:690,end:810,building:elsewhere},
 ),true);
 assert.equal(appointmentConflict(
  {start:540,end:660,building:first},
  {start:720,end:840,building:elsewhere},
 ),false);
});
test("overlapping jobs conflict even when both are in same building",()=>{
 assert.equal(appointmentConflict(
  {start:540,end:660,building:first},
  {start:650,end:770,building:second},
 ),true);
});
test("missing or conflicting building data never bypasses buffer",()=>{
 assert.equal(sameBuilding(first,{address:"123 Main Street",city:"Pasadena",state:"CA",zip:"91101"}),false);
 assert.equal(sameBuilding(first,{address:"123 Main Street"}),false);
 assert.equal(bufferMinutesBetween(first,null),60);
 assert.equal(sameBuilding(first,{address:"123 Main Street Unit 7",city:"Long Beach",state:"CA",zip:"90802"}),true);
});
test("calendar and crew scheduler both use location-aware travel rule",()=>{
 const month=read("lib/contractors/availability.ts");
 const crew=read("lib/services/jobs.ts");
 const portal=read("components/contractors/ContractorPortal.tsx");
 assert.match(month,/sameBuilding\(building,block\.building\)\?0:DEFAULT_TRAVEL_BUFFER_MINUTES/);
 assert.match(month,/\.select\("scheduled_date,start_time,estimated_duration,property_id"\)/);
 assert.match(crew,/appointmentConflict\(\{start,end,building:current\.property\}/);
 assert.match(portal,/building=\{\{address:address\.street,city:address\.city,state:address\.state,zip:address\.zip\}\}/);
});
