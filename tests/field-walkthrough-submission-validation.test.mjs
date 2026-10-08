import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(path, "utf8");
const page = read("components/walkthroughs/FieldWalkthroughsPage.tsx");
const service = read("lib/services/fieldWalkthroughs.ts");
const moveComponent = read("components/walkthroughs/MoveInOutFieldWalkthrough.tsx");
const moveMigration = read("supabase/migrations/20260928201904_move_in_out_field_walkthrough.sql");
const accessMigration = read("supabase/migrations/20261008010000_master_admin_operational_assignment_override.sql");
const validationMigration = read("supabase/migrations/20261008121500_field_walkthrough_submission_validation.sql");

test("field saves and completion submit the complete reopened measurement snapshot", () => {
  assert.match(page, /useState<FieldMeasurements>\(\{\s*\.\.\.row\.measurements/);
  assert.match(moveComponent, /answers:\{\.\.\.answers,\[key\]:value\}/);
  assert.match(page, /saveAssignedFieldWalkthrough\(\s*row\.id,\s*\{\s*\.\.\.measurements/);
  assert.match(service, /p_measurements:measurements,p_complete:complete/);
  assert.match(moveMigration, /if p_complete then[\s\S]*move_answers \? required_key/);
  assert.match(moveMigration, /jsonb_set\(existing_move, '\{fieldWalkthrough\}', move_field, true\)/);
});

test("Move-In Out storageAreas rejects malformed JSON before array expansion", () => {
  assert.match(validationMigration, /jsonb_typeof\(storage_areas\) not in \('array', 'null'\)/);
  assert.match(validationMigration, /Invalid Move-In \/ Move-Out selection: storageAreas/);
  assert.match(validationMigration, /jsonb_typeof\(storage_areas\) = 'array'[\s\S]*jsonb_array_elements\(storage_areas\)/);
  assert.match(moveMigration, /jsonb_array_elements_text\(move_answers->'storageAreas'\)/);
});

test("all service assessment containers reject unsupported JSON types before legacy JSON iteration", () => {
  for (const key of [
    "postConstructionAssessment",
    "standardResidentialAssessment",
    "deepCleaningAssessment",
    "moveInOutAssessment",
    "commercialJanitorialAssessment",
    "propertyManagementCommonAreasAssessment",
    "officeCleaningAssessment",
    "barbershopSalonAssessment",
    "retailCleaningAssessment",
    "eventVenueCleaningAssessment",
    "warehouseCleaningAssessment",
    "restaurantCleaningAssessment",
  ]) assert.ok(validationMigration.includes(`'${key}'`), key);

  assert.match(validationMigration, /jsonb_typeof\(assessment_payload\) <> 'object'/);
  assert.match(validationMigration, /jsonb_typeof\(field_payload->'answers'\) <> 'object'/);
  assert.match(validationMigration, /using errcode = '22023'/);
});

test("submission authorization remains assignment-scoped with only the Master Admin override", () => {
  assert.match(validationMigration, /if not public\.can_perform_scheduled_walkthrough\(p_id\)/);
  assert.match(accessMigration, /public\.is_master_admin\(\)[\s\S]*public\.has_walkthrough_execution_role\(\)[\s\S]*walkthrough\.assigned_employee_id = public\.current_employee_id\(\)/);
  assert.match(accessMigration, /walkthrough\.status = 'Scheduled'/);
  assert.match(accessMigration, /walkthrough\.archived_at is null/);
  assert.match(accessMigration, /walkthrough\.walkthrough_date is not null/);
  assert.match(accessMigration, /walkthrough\.walkthrough_time is not null/);
});

test("versioned SECURITY DEFINER submitters remain unavailable for direct calls", () => {
  assert.match(validationMigration, /security definer[\s\S]*set search_path = ''/i);
  assert.match(validationMigration, /revoke all on function public\.submit_assigned_field_walkthrough_before_submission_validation_20261008\(uuid, jsonb, boolean\)[\s\S]*from public, anon, authenticated/);
  assert.match(validationMigration, /revoke all on function public\.submit_assigned_field_walkthrough\(uuid, jsonb, boolean\)[\s\S]*from public, anon, authenticated/);
  assert.match(validationMigration, /grant execute on function public\.submit_assigned_field_walkthrough\(uuid, jsonb, boolean\)[\s\S]*to authenticated/);
  assert.match(accessMigration, /inspected_count <> 14[\s\S]*wrapper_count <> 3[\s\S]*rewritten_count <> 11/);
});

test("delegated service validation still rejects service mismatches and incomplete completion snapshots", () => {
  assert.match(moveMigration, /Move-In \/ Move-Out observations require a Move-In \/ Move-Out Cleaning walkthrough/);
  assert.match(moveMigration, /Required Move-In \/ Move-Out answer is missing/);
  assert.match(validationMigration, /perform public\.submit_assigned_field_walkthrough_before_submission_validation_20261008/);
  assert.match(validationMigration, /^begin;[\s\S]*notify pgrst, 'reload schema';\s*\n\s*commit;\s*$/);
});
