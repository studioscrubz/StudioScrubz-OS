import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const read=p=>fs.readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("direct customer service descriptions are authorized and contractor isolated",()=>{
 const sql=read("supabase/migrations/20261123201500_direct_customer_service_scope_reference.sql");
 assert.match(sql,/public\.can_access_job\(p_job_id\)/);
 assert.match(sql,/c\.client_type is distinct from 'Contractor'/);
 assert.match(sql,/s\.description/);
 assert.match(sql,/s\.is_active=true/);
 assert.match(sql,/grant execute on function public\.get_direct_customer_service_description\(uuid\) to authenticated/);
 assert.doesNotMatch(sql,/update public\.jobs|update public\.scope_snapshots/i);
});
test("technicians see service descriptions in job and schedule scope panels",()=>{
 const job=read("components/jobs/JobsPage.tsx");
 const schedule=read("components/jobs/SchedulePage.tsx");
 assert.match(job,/<DirectCustomerServiceScope jobId=\{job\.id\}\/>/);
 assert.match(job,/<DirectCustomerServiceScope jobId=\{jobId\}\/>/);
 assert.match(schedule,/<DirectCustomerServiceScope jobId=\{job\.id\}\/>/);
 const component=read("components/jobs/DirectCustomerServiceScope.tsx");
 assert.match(component,/Follow the job's accepted scope and approved changes/);
 assert.doesNotMatch(component,/price|deposit|profit/i);
});
