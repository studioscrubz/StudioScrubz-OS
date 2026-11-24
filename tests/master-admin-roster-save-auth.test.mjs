import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const sql=fs.readFileSync(new URL("../supabase/migrations/20261124020000_master_admin_roster_without_employee_link.sql",import.meta.url),"utf8");

test("Master Admin can save job roster without a linked employee record",()=>{
 assert.match(sql,/auth\.uid\(\) is null or \(v_actor is null and not v_is_master\)/);
 assert.match(sql,/public\.has_any_role\(array\['Master Admin'\]\)/);
 assert.match(sql,/assigned_by_user_id/);
 assert.match(sql,/select p_job_id,c\.id,x,v_actor,auth\.uid\(\)/);
});
test("Crew Lead assignment and capacity rules remain enforced",()=>{
 assert.match(sql,/c\.crew_lead_id is distinct from v_actor/);
 assert.match(sql,/technician_capacity/);
 assert.match(sql,/public\.is_eligible_job_tech/);
 assert.match(sql,/private\.employee_has_operational_role/);
 assert.match(sql,/j\.status not in \('Ready to Schedule','Scheduled','Crew Assigned'\)/);
});
