import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read=path=>readFileSync(path,"utf8");
const component=read("components/walkthroughs/DeepCleaningFieldWalkthrough.tsx");
const standard=read("components/walkthroughs/StandardResidentialFieldWalkthrough.tsx");
const post=read("components/walkthroughs/PostConstructionFieldWalkthrough.tsx");
const page=read("components/walkthroughs/FieldWalkthroughsPage.tsx");
const migration=read("supabase/migrations/20260928200645_deep_cleaning_field_walkthrough.sql");
const catalog=read("supabase/service_catalog_settings.sql");

test("canonical Deep Cleaning service selects the guided questionnaire",()=>{
  assert.match(catalog,/\('RES-DEEP','Deep Cleaning','Residential','Deep Cleaning'/);
  assert.match(component,/service\?\.trim\(\)==="Deep Cleaning"/);
  assert.match(page,/isDeepCleaningService\(row\.service\)/);
  assert.match(page,/isDeepCleaning\s*\?\s*\(\s*<DeepCleaningFieldWalkthrough/);
});

test("Deep Cleaning renders safe carry-forward context and included add-ons",()=>{
  assert.match(component,/StandardResidentialCarryForward context=\{context\}/);
  assert.match(component,/Included Add-ons/);
  assert.match(migration,/get_assigned_field_walkthroughs_standard_phase_20260928/);
  assert.doesNotMatch(component,/basePrice|finalPrice|laborCost|grossMargin|salesNotes|Sales \/ Internal Notes/);
  assert.doesNotMatch(migration,/'salesNotes'|'pricingReview'|'laborCost'|'margin'/);
});

test("required and conditional Deep Cleaning questions gate completion",()=>{
  for(const text of ["Restoration-level attention","Which areas are affected by accumulated buildup?","Heavy grease buildup?","Visible mildew-like buildup?","significant detailed hand cleaning","Heavy dust on vents?","Areas inaccessible due to belongings","pet hair level","Are special cleaning precautions required?","is Deep Cleaning appropriate?","Normal for Deep Cleaning","materially affect service","I have physically reviewed the accessible service areas"])assert.ok(component.includes(text),text);
  for(const key of ["buildupOther","trimAreaNotes","flooringOther","flooringNotes","inaccessibleAreas","specialSurfaceNotes","extraAttentionOther","serviceRecommendationNotes","exceptionNotes","technicianConfirmation"])assert.ok(component.includes(key),key);
  assert.match(component,/disabled=\{!!missing\.length\|\|current===sections\.length-1\}/);
  assert.match(page,/deepCleaningCompletionIssues\(\s*measurements,\s*row\.standard_residential_context\s*\)/);
  assert.match(migration,/if p_complete then[\s\S]*Required Deep Cleaning answer is missing/);
});

test("Deep Cleaning drafts save separately with assignment isolation and Master Admin oversight",()=>{
  assert.match(component,/deepCleaningAssessment:\{[\s\S]*fieldWalkthrough:\{answers:/);
  assert.match(migration,/normalized - 'deepCleaningAssessment',[\s\S]*p_complete/);
  assert.match(migration,/jsonb_set\(existing_deep, '\{fieldWalkthrough\}', deep_field, true\)/);
  assert.match(migration,/walkthrough\.assigned_employee_id is distinct from employee/);
  assert.match(migration,/get_assigned_field_walkthroughs_standard_phase_20260928\(\)/);
  assert.match(page,/readOnly=\{!activeCanEdit\}/);
});

test("Standard Residential and Post-Construction paths remain selected independently",()=>{
  assert.match(standard,/standardResidentialAssessment/);
  assert.match(post,/postConstructionAssessment/);
  assert.match(page,/isPostConstruction\s*\?\s*\(\s*<PostConstructionFieldWalkthrough/);
  assert.match(page,/isStandardResidential\s*\?\s*\(\s*<StandardResidentialFieldWalkthrough/);
  assert.match(migration,/submit_assigned_field_walkthrough_standard_phase_20260928/);
});
