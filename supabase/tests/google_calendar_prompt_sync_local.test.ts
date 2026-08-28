import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// @ts-expect-error Node's direct type-strip runner requires explicit TypeScript extensions.
import { pendingCalendarSkipReason,runPendingJobCalendarSync } from "../../lib/google-calendar/pending.ts";
// @ts-expect-error Node's direct type-strip runner requires explicit TypeScript extensions.
import { requestPendingJobCalendarSync } from "../../lib/google-calendar/client.ts";

const base={queueStatus:"Pending",eventId:null,jobStatus:"Scheduled",connected:true,autoCreateEvents:true,syncJobChanges:true,cancelOnCancellation:true};
let calls=0;
const processed=await runPendingJobCalendarSync(base,async()=>{calls++;return{status:"Synced"}});
assert.equal(processed.processed,true);assert.equal(calls,1);
assert.equal(pendingCalendarSkipReason({...base,queueStatus:null}),"no_queue_work");
assert.equal(pendingCalendarSkipReason({...base,queueStatus:"Unscheduled"}),"unscheduled");
assert.equal(pendingCalendarSkipReason({...base,queueStatus:"Synced"}),"already_synced");
assert.equal(pendingCalendarSkipReason({...base,queueStatus:"Cancelled"}),"already_cancelled");
assert.equal(pendingCalendarSkipReason({...base,autoCreateEvents:false,syncJobChanges:false}),"automatic_sync_disabled");
assert.equal(pendingCalendarSkipReason({...base,queueStatus:"Failed"}),"not_pending");

// A successful first sync persists Synced; the next prompt is a harmless skip.
const second=await runPendingJobCalendarSync({...base,queueStatus:"Synced"},async()=>{calls++;return null});
assert.equal(second.processed,false);assert.equal(calls,1);
// The existing trigger changes Failed back to Pending on a subsequent eligible mutation.
const retried=await runPendingJobCalendarSync({...base,queueStatus:"Pending"},async()=>{calls++;return{status:"Synced"}});
assert.equal(retried.processed,true);assert.equal(calls,2);

const failedRequest=await requestPendingJobCalendarSync("job-test",async()=>{throw new Error("network down")});
assert.deepEqual(failedRequest,{processed:false,skipped:"request_failed"});
let requested="";const successfulRequest=await requestPendingJobCalendarSync("job id",async(input)=>{requested=String(input);return new Response(JSON.stringify({processed:false,skipped:"no_queue_work"}),{status:200,headers:{"content-type":"application/json"}})});
assert.equal(requested,"/api/integrations/google-calendar/jobs/job%20id/process-pending");assert.equal(successfulRequest.processed,false);

const route=readFileSync("app/api/integrations/google-calendar/jobs/[jobId]/process-pending/route.ts","utf8");
assert.match(route,/requireJobAccess\(jobId,"jobs\.edit"\)/);assert.doesNotMatch(route,/CRON_SECRET/);
const migration=readFileSync("supabase/migrations/20260827233857_google_calendar_job_sync.sql","utf8");
assert.match(migration,/on conflict \(job_id\) do update[\s\S]*sync_status=excluded\.sync_status, last_sync_error=null/);
console.log("Prompt Google Calendar queue, retry, failure-isolation, and authorization tests passed.");
