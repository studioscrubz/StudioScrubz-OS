import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20261015201505_mandatory_job_completion_photos.sql", "utf8");
const jobsPage = readFileSync("components/jobs/JobsPage.tsx", "utf8");
const uploader = readFileSync("components/photos/PhotoUploader.tsx", "utf8");
const jobsService = readFileSync("lib/services/jobs.ts", "utf8");
const photoService = readFileSync("lib/services/photoStorage.ts", "utf8");

test("completion counts only distinct saved After-photo metadata backed by private storage", () => {
  assert.match(migration, /count\(distinct photo->>'id'\)/);
  assert.match(migration, /photo->>'category' = 'After'/);
  assert.match(migration, /join storage\.objects object[\s\S]*object\.bucket_id = 'operational-photos'/);
  assert.match(migration, /public\.is_valid_operational_photo_path\('jobs', p_job_id, photo->>'storagePath'\)/);
  assert.match(migration, /if after_count < 3[\s\S]*raise exception 'At least 3 saved After photos/);
});

test("photo validation occurs before attendance, payroll, and Completed mutations", () => {
  const completion = migration.match(/create or replace function public\.complete_in_progress_job\(p_job_id uuid\)([\s\S]*?)\n\$\$;/)?.[1] ?? "";
  const guardAt = completion.indexOf("perform private.require_job_completion_photos(j.id)");
  assert.ok(guardAt >= 0);
  assert.ok(guardAt < completion.indexOf("for p in select * from public.job_crew_presence"));
  assert.ok(guardAt < completion.indexOf("close_job_payroll_entries"));
  assert.ok(guardAt < completion.indexOf("set status='Completed'"));
  assert.match(migration, /create trigger jobs_require_completion_photos[\s\S]*before insert or update of status on public\.jobs/);
});

test("override is Master Admin-only, reasoned, counted, audited, and transaction scoped", () => {
  assert.match(migration, /not public\.has_role\('Master Admin'\)/);
  assert.match(migration, /char_length\(normalized_reason\) < 15/);
  assert.match(migration, /insert into public\.job_completion_photo_overrides\(job_id,administrator_id,reason,after_photo_count\)/);
  assert.match(migration, /values\(job_row\.id,auth\.uid\(\),normalized_reason,after_count\)/);
  assert.doesNotMatch(migration, /current_setting|set_config/);
  assert.match(migration, /pending_job_completion_photo_override_exists/);
  assert.match(migration, /completed_job := public\.complete_in_progress_job\(job_row\.id\)/);
  assert.match(migration, /set completed_at = now\(\)[\s\S]*where id = override_id/);
  assert.ok(
    migration.indexOf("completed_job := public.complete_in_progress_job(job_row.id)") <
      migration.indexOf("set completed_at = now()"),
  );
  assert.match(migration, /on delete restrict/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.job_completion_photo_overrides from public, anon, authenticated/);
});

test("failed override and completion operations are atomic", () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /^commit;/m);
  assert.match(migration, /insert into public\.job_completion_photo_overrides[\s\S]*completed_job := public\.complete_in_progress_job/);
  assert.match(migration, /if not found then[\s\S]*override audit could not be finalized/);
  assert.ok(
    migration.indexOf("perform private.require_job_completion_photos(j.id)") <
      migration.indexOf("perform public.close_job_payroll_entries(j.id,ended)"),
  );
});

test("normal and direct completion paths share database enforcement", () => {
  assert.match(migration, /perform private\.require_job_completion_photos\(j\.id\)/);
  assert.match(migration, /for each row execute function private\.guard_job_completion_photos\(\)/);
  assert.doesNotMatch(migration, /update public\.jobs[\s\S]*where status = 'Completed'/i);
  assert.match(migration, /if tg_op = 'INSERT'[\s\S]*elsif old\.status is distinct from 'Completed'/);
});

test("historical archive restoration uses a private single-use capability", () => {
  assert.match(migration, /create table private\.job_completion_photo_restore_authorizations/);
  assert.match(migration, /revoke all on table private\.job_completion_photo_restore_authorizations from public, anon, authenticated/);
  assert.match(migration, /create or replace function public\.restore_archived_operational_job/);
  assert.match(migration, /has_any_role\(array\['Master Admin','Administrator'\]\)/);
  assert.match(migration, /v_job\.archived_at is null or v_job\.status is distinct from 'Archived'/);
  assert.match(migration, /v_job\.completed_at is null[\s\S]*historically Completed archived Job/);
  assert.match(migration, /insert into private\.job_completion_photo_restore_authorizations[\s\S]*update public\.jobs[\s\S]*status = 'Completed'/);
  assert.match(migration, /delete from private\.job_completion_photo_restore_authorizations[\s\S]*returning true into consumed/);
});

test("archive exception cannot authorize an arbitrary Completed transition", () => {
  assert.match(migration, /old\.status = 'Archived'/);
  assert.match(migration, /old\.archived_at is not null/);
  assert.match(migration, /old\.completed_at is not null/);
  assert.match(migration, /new\.archived_at is null/);
  assert.match(migration, /new\.completed_at is not distinct from old\.completed_at/);
  assert.match(migration, /new\.operational_ended_at is not distinct from old\.operational_ended_at/);
  assert.match(migration, /consume_job_completion_photo_restore_authorization\(new\.id, old\.completed_at\)/);
  assert.match(migration, /end if;\s*perform private\.require_job_completion_photos\(new\.id\)/);
  assert.equal(
    (migration.match(/insert into private\.job_completion_photo_restore_authorizations/g) ?? []).length,
    1,
  );
});

test("UI shows a live counter and routes missing-photo users to the existing uploader", () => {
  assert.match(jobsPage, /Completion Photos: \{afterPhotoCount\} \/ 3/);
  assert.match(jobsPage, /onPhotosChange=\{\(photos\) => setAfterPhotoCount/);
  assert.match(jobsPage, /Go to Photo Uploader/);
  assert.match(jobsPage, /getSavedAfterPhotoCount\(job\.id\)/);
  assert.match(uploader, /onPhotosChangeRef\.current\?\.\(next\)/);
  assert.match(photoService, /export async function getSavedAfterPhotoCount/);
});

test("application override preserves the normal invoice and attention handoff", () => {
  const override = jobsService.match(/export async function completeInProgressJobWithPhotoOverride[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(override, /complete_in_progress_job_with_photo_override/);
  assert.match(override, /createCompletedJobInvoice/);
  assert.match(override, /requestImmediateAttentionPush/);
  assert.match(jobsPage, /role === "Master Admin" && afterPhotoCount < 3/);
  assert.match(jobsPage, /window\.confirm\("Complete this Job without the required three After photos/);
});
