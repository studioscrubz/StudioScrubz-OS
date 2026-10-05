import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("field assessment editability uses the authoritative execution predicate", async () => {
  const [page, service] = await Promise.all([
    read("components/walkthroughs/FieldWalkthroughsPage.tsx"),
    read("lib/services/fieldWalkthroughs.ts"),
  ]);

  assert.match(service, /rpc\("can_perform_scheduled_walkthrough", \{ p_id: id \}\)/);
  assert.match(page, /const canEdit = await canPerformScheduledWalkthrough\(row\.id\)/);
  assert.match(page, /readOnly=\{!activeCanEdit\}/);
  assert.doesNotMatch(page, /readOnly=\{masterAdmin\s*&&\s*!active\.isAssignedEmployee\}/);
  assert.match(page, /<fieldset disabled=\{busy \|\| readOnly\}/);
});

test("the execution predicate preserves role, assignment, and lifecycle boundaries", async () => {
  const migration = await read("supabase/migrations/20261005142308_master_admin_walkthrough_execution_access.sql");
  const role = migration.match(/create or replace function public\.has_walkthrough_execution_role[\s\S]*?\$\$;/)?.[0] ?? "";
  const performer = migration.match(/create or replace function public\.can_perform_scheduled_walkthrough[\s\S]*?\$\$;/)?.[0] ?? "";

  assert.match(role, /profile\.role in \('Master Admin', 'Manager', 'Crew Lead'\)/);
  assert.doesNotMatch(role, /Scrub Technician/);
  assert.match(performer, /assigned_employee_id = public\.current_employee_id\(\)/);
  assert.match(performer, /status = 'Scheduled'/);
  assert.match(performer, /archived_at is null/);
  assert.match(performer, /walkthrough_date is not null/);
  assert.match(performer, /walkthrough_time is not null/);
});

test("assessment answers remain controlled and hydrate from the saved walkthrough", async () => {
  const [page, choice] = await Promise.all([
    read("components/walkthroughs/FieldWalkthroughsPage.tsx"),
    read("components/walkthroughs/GuidedWalkthroughChoice.tsx"),
  ]);

  assert.match(page, /useState<FieldMeasurements>\(\{[\s\S]*\.\.\.row\.measurements/);
  assert.match(page, /measurements=\{measurements\}/);
  assert.match(page, /onChange=\{changeMeasurements\}/);
  assert.match(choice, /aria-pressed=\{isSelected\}/);
  assert.match(choice, /onClick=\{\(\) =>[\s\S]*nextGuidedWalkthroughSelection/);
  assert.match(page, /currentInterpretation = interpretAssessmentPricing/);
  assert.match(page, /saveAssignedFieldWalkthrough\([\s\S]*assessmentPricing: currentInterpretation/);
});
