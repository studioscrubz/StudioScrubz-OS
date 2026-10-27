import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20261027003242_require_finished_job_photo_before_completion.sql", "utf8");
const jobsPage = readFileSync("components/jobs/JobsPage.tsx", "utf8");
const uploader = readFileSync("components/photos/PhotoUploader.tsx", "utf8");
const photoStorage = readFileSync("lib/services/photoStorage.ts", "utf8");
const jobsService = readFileSync("lib/services/jobs.ts", "utf8");

test("completion requires same-job saved After metadata and its Storage object", () => {
  assert.match(migration, /jsonb_array_elements\(coalesce\(job\.photos, '\[\]'::jsonb\)\)/);
  assert.match(migration, /object\.bucket_id = 'operational-photos'/);
  assert.match(migration, /object\.name = photo->>'storagePath'/);
  assert.match(migration, /job\.id = p_job_id/);
  assert.match(migration, /photo->>'category' = 'After'/);
  assert.match(migration, /'jobs\/' \|\| p_job_id::text \|\| '\/after\/%'/);
  assert.match(migration, /is_valid_operational_photo_path\('jobs', p_job_id/);
  assert.match(migration, /Upload finished-job photos before ending this job\./);
});

test("outer completion guard preserves authorization, equipment clearance, and atomic team completion", () => {
  assert.match(migration, /has_any_role\(array\['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician'\]\)/);
  assert.match(migration, /can_control_job_timer\(job\.assigned_employee_id, job\.assigned_crew_id\)/);
  assert.ok(migration.indexOf("require_finished_job_photo(job.id)") < migration.indexOf("complete_in_progress_job_before_equipment(job.id)"));
  assert.match(migration, /job_equipment_clearances/);
  assert.match(migration, /return public\.complete_in_progress_job_before_equipment\(job\.id\)/);
  assert.doesNotMatch(migration, /update public\.time_entries/i);
  assert.doesNotMatch(migration, /update public\.jobs set status/i);
});

test("a completion transition trigger closes alternate status-write bypasses", () => {
  assert.match(migration, /before update of status on public\.jobs/);
  assert.match(migration, /new\.status = 'Completed' and old\.status is distinct from 'Completed'/);
  assert.match(migration, /perform private\.require_finished_job_photo\(new\.id\)/);
});

test("UI blocks until persisted photos load and reacts to successful upload or deletion", () => {
  assert.match(jobsPage, /hasFinishedPhoto !== true/);
  assert.match(jobsPage, /setHasFinishedPhoto\(photos\.some\(\(photo\) => photo\.category === "After"\)\)/);
  assert.match(jobsPage, /setFinishedPhotoCount\(photos\.filter\(photo => photo\.category === "After"\)\.length\)/);
  assert.match(jobsPage, /Upload finished-job photos before ending this job\./);
  assert.match(jobsPage, /href="#finished-job-photos"/);
  assert.match(uploader, /onPhotosChangedRef\.current\?\.\(items\)/);
  assert.match(uploader, /onPhotosChangedRef\.current\?\.\(next\)/);
});

test("finished photos remain internal unless a user explicitly changes visibility", () => {
  assert.match(photoStorage, /if \(recordType === "walkthroughs"\) return true;\s*return false;/);
});

test("invoice handoff remains after successful database completion", () => {
  const completion = jobsService.match(/export async function completeInProgressJob[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(completion, /rpc\("complete_in_progress_job"/);
  assert.match(completion, /if \(error\) throw/);
  assert.ok(completion.indexOf('if (error) throw') < completion.indexOf("createCompletedJobInvoice"));
});
