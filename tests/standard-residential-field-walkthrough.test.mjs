import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read=path=>readFileSync(path,"utf8");
const component=read("components/walkthroughs/StandardResidentialFieldWalkthrough.tsx");
const page=read("components/walkthroughs/FieldWalkthroughsPage.tsx");
const migration=read("supabase/migrations/20260928183628_standard_residential_field_walkthrough.sql");
const accessFix=read("supabase/migrations/20260928185819_fix_standard_residential_save_and_master_admin_oversight.sql");
const postConstruction=read("components/walkthroughs/PostConstructionFieldWalkthrough.tsx");
const permissions=read("lib/auth/permissions.ts");

test("Standard Cleaning uses a guided assigned-technician walkthrough with safe carry-forward context",()=>{
  assert.match(component,/service\?\.trim\(\)===\"Standard Cleaning\"/);
  assert.match(page,/isStandardResidentialService\(row\.service\)/);
  for(const label of ["Customer / Property","Service","Bedrooms","Bathrooms","Square Footage","Pets","Current Cleaner / Vendor","Major Concerns / Problem Areas","Property Context","Access Considerations","Customer Notes","Walkthrough Date / Time","Walkthrough Method"])assert.ok(component.includes(label),label);
  assert.match(migration,/'customerNotes', e\.notes/);
  assert.doesNotMatch(component,/basePrice|finalPrice|laborCost|grossMargin|salesNotes|Sales \/ Internal Notes/);
  assert.doesNotMatch(migration,/'salesNotes'/);
});

test("all required and conditional Standard Residential questions are present and gate completion",()=>{
  for(const text of ["Occupied","Vacant","Partially occupied","Areas inaccessible due to clutter","Natural stone","Heavy grease/buildup?","Visible mold/mildew-like buildup?","pet hair level","Management review needed","Significantly above normal","8+ hours","materially affect the service","I have physically reviewed the accessible service areas"])assert.ok(component.includes(text),text);
  for(const key of ["inaccessibleAreas","flooringOther","flooringConditionNotes","extraAttentionOther","specialSurfaceNotes","serviceRecommendationNotes","exceptionNotes","technicianConfirmation"])assert.ok(component.includes(key),key);
  assert.match(page,/standardResidentialCompletionIssues\(\s*measurements,\s*row\.standard_residential_context\s*\)/);
  assert.match(component,/disabled=\{!!missing\.length\|\|current===sections\.length-1\}/);
  assert.match(component,/Previous/);
  assert.match(component,/Continue/);
  assert.match(migration,/if p_complete and coalesce\(walkthrough\.measurements->>'serviceType',''\) = 'Standard Cleaning'/);
});

test("technician observations save separately and Post-Construction remains intact",()=>{
  assert.match(component,/standardResidentialAssessment:\{[\s\S]*fieldWalkthrough:\{answers:/);
  assert.match(migration,/standardResidentialAssessment/);
  assert.match(migration,/jsonb_set\(existing_standard,'\{fieldWalkthrough\}'/);
  assert.match(page,/isPostConstruction\s*\?\s*\(\s*<PostConstructionFieldWalkthrough/);
  assert.match(postConstruction,/postConstructionAssessment/);
  assert.match(migration,/postConstructionAssessment/);
});

test("draft save normalizes unused questionnaire nulls and retains assignment conflict protection",()=>{
  assert.match(accessFix,/jsonb_typeof\(normalized #> '\{postConstructionAssessment,fieldWalkthrough\}'\) = 'null'/);
  assert.match(accessFix,/normalized := normalized - 'postConstructionAssessment'/);
  assert.match(accessFix,/submit_assigned_field_walkthrough_assignment_guarded_20260928\([\s\S]*p_complete/);
  assert.match(migration,/where id = p_id for update/);
  assert.match(migration,/walkthrough\.assigned_employee_id is distinct from employee/);
  assert.match(migration,/if p_complete and coalesce\(walkthrough\.measurements->>'serviceType',''\) = 'Standard Cleaning'/);
});

test("Master Admin can review all assignments while field staff remain assignment-scoped",()=>{
  assert.match(accessFix,/master_admin boolean := public\.is_master_admin\(\)/);
  assert.match(accessFix,/w\.assigned_employee_id is not null[\s\S]*master_admin or w\.assigned_employee_id = employee/);
  assert.match(accessFix,/not master_admin[\s\S]*'Crew Lead', 'Scrub Technician'/);
  assert.match(permissions,/permission === "walkthroughs\.field"[\s\S]*profile\.role === "Master Admin"[\s\S]*\["Manager", "Crew Lead"\]/);
  assert.match(page,/readOnly=\{masterAdmin\s*&&\s*!active\.isAssignedEmployee\}/);
  assert.match(page,/Master Admin review — technician responses are read-only/);
  assert.match(page,/isPostConstruction\s*\?\s*\(\s*<PostConstructionFieldWalkthrough/);
});
