import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const sql=fs.readFileSync(new URL("../supabase/migrations/20261124023000_fix_roster_calendar_queue_ambiguous_job_id.sql",import.meta.url),"utf8");
test("crew roster calendar trigger avoids ambiguous job_id local variable",()=>{
 assert.match(sql,/v_job_id := case when tg_op='DELETE' then old\.job_id else new\.job_id end/);
 assert.match(sql,/values\(v_job_id,connection_row\.id,'Pending'/);
 assert.match(sql,/on conflict\(job_id\) do update/);
 assert.doesNotMatch(sql,/\bjob_id uuid;/);
});
test("calendar updates remain gated by scheduled job and connected account",()=>{
 assert.match(sql,/job_row\.scheduled_date is null/);
 assert.match(sql,/job_row\.status in \('Completed','Cancelled','Archived'\)/);
 assert.match(sql,/connection_row\.sync_job_changes/);
});
