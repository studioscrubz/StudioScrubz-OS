import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260924210331_repair_stranded_service_occurrence_job_creation.sql",
  "utf8",
);
const schedule = readFileSync(
  "components/agreements/ScheduleOccurrences.tsx",
  "utf8",
);

test("occurrence Job creation remains management-only, locked, and hardened", () => {
  assert.match(migration, /create or replace function public\.create_job_from_service_occurrence\(p_occurrence_id uuid\)/i);
  assert.match(migration, /security definer\s+set search_path = ''/i);
  assert.match(migration, /caller_role not in \('Master Admin','Administrator','Manager'\)/);
  assert.match(migration, /where id = p_occurrence_id for update/);
  assert.match(migration, /revoke all on function public\.create_job_from_service_occurrence\(uuid\)[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.create_job_from_service_occurrence\(uuid\)[\s\S]*to authenticated/i);
});

test("existing active Jobs remain idempotent and retained Job history cannot duplicate", () => {
  assert.match(migration, /where id = occurrence_row\.job_id and archived_at is null;[\s\S]*if found then return job_row/);
  assert.match(migration, /where service_occurrence_id = occurrence_row\.id and archived_at is null limit 1/);
  assert.match(migration, /retained_job\.id = occurrence_row\.job_id[\s\S]*retained_job\.service_occurrence_id = occurrence_row\.id/);
  assert.match(migration, /has retained Job history and cannot create another Job/);
});

test("only a stranded Job Created occurrence is repaired before Job creation", () => {
  assert.match(migration, /if occurrence_row\.status = 'Job Created' then/);
  assert.match(migration, /set status = 'Scheduled'[\s\S]*job_id is null and status = 'Job Created'/);
  assert.match(migration, /elsif occurrence_row\.status <> 'Scheduled' then[\s\S]*Only a Scheduled occurrence can create a Job/);
  assert.match(migration, /jobs_one_active_per_occurrence_idx|service_occurrence_id = occurrence_row\.id/);
  assert.doesNotMatch(migration, /delete from public\.(?:jobs|service_occurrences)/i);
});

test("Schedule keeps technician request-skipping and separates load from action errors", () => {
  assert.match(schedule, /const canCreateJobs = hasPermission\(profile, "jobs\.create"\)/);
  assert.match(schedule, /async function load\(\) \{\s*if \(!canCreateJobs\) return;/);
  assert.match(schedule, /useEffect\(\(\) => \{\s*if \(!canCreateJobs\) return;/);
  assert.match(schedule, /if \(!canCreateJobs\) return null;/);
  assert.match(schedule, /setLoadError\(message\(cause\)\)/);
  assert.match(schedule, /setActionError\(message\(cause\)\)/);
  assert.match(schedule, /Recurring services could not be loaded: \{loadError\}/);
  assert.match(schedule, /\{actionError\}/);
});
