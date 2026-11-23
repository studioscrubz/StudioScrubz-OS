import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
const read=p=>fs.readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("jobs and schedule expose real property bed bath counts without guessing",()=>{
 const helper=read("lib/jobs/roomCounts.ts");
 assert.match(helper,/beds==null\?"Not recorded"/);
 assert.match(helper,/baths==null\?"Not recorded"/);
 const jobs=read("components/jobs/JobsPage.tsx");
 const schedule=read("components/jobs/SchedulePage.tsx");
 for(const src of [jobs,schedule]){
  assert.match(src,/jobBedBathLabel\(job\.property\)/);
  assert.match(src,/\["Bedrooms", job\.property\?\.bedrooms/);
  assert.match(src,/\["Bathrooms", job\.property\?\.bathrooms/);
 }
 assert.match(jobs,/aria-label=\{`View job/);
 assert.match(schedule,/View Full Job/);
});
test("Google calendar events include counts and existing full job link",()=>{
 const src=read("lib/google-calendar/event.ts");
 assert.match(src,/jobBedBathCompact\(p\)/);
 assert.match(src,/jobBedBathLabel\(p\)/);
 assert.match(src,/bedrooms\?:number\|null;bathrooms\?:number\|null/);
 assert.match(src,/View Job:.*jobs\?jobId=/);
});
