import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20260924171023_scrub_technician_operational_job_contract.sql", "utf8");
const operationalRpcMigration = readFileSync("supabase/migrations/20260918132217_job_individual_or_crew_assignment.sql", "utf8");
const scheduleOccurrences = readFileSync("components/agreements/ScheduleOccurrences.tsx", "utf8");
const clientsPage = readFileSync("components/clients/ClientsPage.tsx", "utf8");
const propertiesPage = readFileSync("components/properties/PropertiesPage.tsx", "utf8");

test("operational-safe Jobs append the dashboard timestamp without broadening row access", () => {
  assert.match(migration, /create or replace view public\.jobs_operational_safe/);
  assert.match(migration, /job\.assigned_employee_id,job\.assigned_employee_name,job\.on_my_way_initiated_at/);
  assert.match(migration, /where public\.can_access_job_assignment\(job\.assigned_employee_id,job\.assigned_crew_id\)/);
  assert.doesNotMatch(migration, /job\.(?:price|subtotal|total|invoice|payment|payroll)/i);
});

test("existing dashboard RPC consumes the repaired safe projection", () => {
  assert.match(operationalRpcMigration, /create or replace function public\.get_operational_jobs\(p_start date default null,p_end date default null\)/);
  assert.match(operationalRpcMigration, /from public\.jobs_operational_safe j/);
  assert.match(operationalRpcMigration, /'on_my_way_initiated_at',j\.on_my_way_initiated_at/);
});

test("view access remains authenticated-only and reloads PostgREST", () => {
  assert.match(migration, /revoke all on public\.jobs_operational_safe from public, anon, authenticated;/);
  assert.match(migration, /grant select on public\.jobs_operational_safe to authenticated;/);
  assert.match(migration, /notify pgrst,'reload schema';/);
});

test("technicians do not execute the recurring Agreement schedule request", () => {
  assert.match(scheduleOccurrences, /const canCreateJobs = hasPermission\(profile, "jobs\.create"\)/);
  assert.match(scheduleOccurrences, /async function load\(\) \{\s*if \(!canCreateJobs\) return;/);
  assert.match(scheduleOccurrences, /useEffect\(\(\) => \{\s*if \(!canCreateJobs\) return;/);
  assert.match(scheduleOccurrences, /if \(!canCreateJobs\) return null;/);
});

test("technician Client and Property screens remain read-only", () => {
  for (const [source, prefix] of [[clientsPage, "clients"], [propertiesPage, "properties"]]) {
    assert.match(source, new RegExp(`hasPermission\\(profile, "${prefix}\\.create"\\)`));
    assert.match(source, new RegExp(`hasPermission\\(profile, "${prefix}\\.edit"\\)`));
    assert.match(source, new RegExp(`hasPermission\\(profile, "${prefix}\\.archive"\\)`));
  }
  assert.match(clientsPage, /onEdit=\{canEdit \? setFormClient : undefined\}/);
  assert.match(clientsPage, /onArchive=\{canArchive \? handleArchive : undefined\}/);
  assert.match(propertiesPage, /edit=\{canEdit \? setFormProperty : undefined\}/);
  assert.match(propertiesPage, /archive=\{canArchive \? handleArchive : undefined\}/);
});
