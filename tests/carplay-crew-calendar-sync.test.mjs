import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
const load=p=>fs.readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("technician roster updates queue Google Calendar changes",()=>{
 const sql=load("supabase/migrations/20261123193000_carplay_crew_roster_calendar_sync.sql");
 assert.match(sql,/job_crew_technicians_queue_calendar_sync/);
 assert.match(sql,/after insert or delete or update of employee_id,crew_id/);
 assert.match(sql,/job_row\.scheduled_date < .*America\/Los_Angeles/);
 assert.match(sql,/job_row\.status in \('Completed','Cancelled','Archived'\)/);
 assert.match(sql,/on conflict\(job_id\) do update/);
});
test("saving a job roster requests prompt Calendar synchronization",()=>{
 const src=load("lib/services/crews.ts");
 const start=src.indexOf("export async function setJobCrewTechnicians");
 assert.ok(start>=0);
 const fn=src.slice(start,src.indexOf("export async function getJobCrewTechnicians",start));
 assert.match(fn,/set_job_crew_technicians/);
 assert.match(fn,/await requestPendingJobCalendarSync\(jobId\)/);
});
test("Calendar setup explains personal views, not sharing company calendar",()=>{
 const src=load("components/settings/GoogleCalendarSettings.tsx");
 assert.match(src,/Apple Calendar &amp; CarPlay/);
 assert.match(src,/do not share the company calendar with technicians/);
});
