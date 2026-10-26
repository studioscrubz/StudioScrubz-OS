import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
const gate=readFileSync("supabase/migrations/20261026193500_job_start_requires_crew_lead_gps.sql","utf8");
const responsibility=readFileSync("supabase/migrations/20261026191500_equipment_responsibility_crew_lead_only.sql","utf8");
const panel=readFileSync("components/jobs/EquipmentAssignmentControl.tsx","utf8");
test("job start uses a server-side assigned lead GPS gate",()=>{
 assert.match(gate,/create or replace function private\.require_job_start_gps/);
 assert.match(gate,/c\.employee_id=v_lead/);
 assert.match(gate,/v_check\.result<>'Within Radius'/);
 assert.match(gate,/checked_at < now\(\)-interval '12 hours'/);
 assert.equal((gate.match(/perform private\.require_job_start_gps\(p_job_id\)/g)||[]).length,2);
});
test("equipment responsibility updates require assigned lead",()=>{
 assert.match(responsibility,/public\.current_employee_id\(\)=task\.crew_lead_employee_id/);
 assert.doesNotMatch(responsibility,/public\.has_role\('Master Admin'\)/);
 assert.match(panel,/if \(!canEdit\) return null/);
});
