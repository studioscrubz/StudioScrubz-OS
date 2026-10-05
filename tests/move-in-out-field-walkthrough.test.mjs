import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read=path=>readFileSync(path,"utf8");
const component=read("components/walkthroughs/MoveInOutFieldWalkthrough.tsx");
const page=read("components/walkthroughs/FieldWalkthroughsPage.tsx");
const migration=read("supabase/migrations/20260928201904_move_in_out_field_walkthrough.sql");
const catalog=read("supabase/service_catalog_settings.sql");

test("Move-In / Move-Out uses its canonical service and guided field flow",()=>{
  assert.match(catalog,/\('RES-MOVE','Move-In \/ Move-Out Cleaning','Residential','Move-In \/ Move-Out'/);
  assert.match(component,/service\?\.trim\(\)==="Move-In \/ Move-Out Cleaning"/);
  assert.match(page,/isMoveInOutService\(row\.service\)/);
  assert.match(page,/isMoveInOut\s*\?\s*\(\s*<MoveInOutFieldWalkthrough/);
});

test("all 18 sections, conditional details, context, and completion gate are present",()=>{
  for(const title of ["Property Readiness","Overall Condition","Belongings / Debris","Kitchen","Bathrooms","Cabinets / Storage","Closets","Flooring","Walls / Baseboards / Doors / Trim","Windows / Glass","Dust / Debris","Special Surfaces","Extra Attention","Readiness Check","Service Suitability","Expected Labor","Exceptions","Final Confirmation"])assert.ok(component.includes(`"${title}"`),title);
  for(const key of ["readinessNotes","accessPreventionNotes","storageNotes","closetNotes","flooringNotes","windowAccessNotes","constructionDebrisNotes","specialSurfaceNotes","extraAttentionOther","readinessCheckNotes","serviceSuitabilityNotes","exceptionNotes","technicianConfirmation"])assert.ok(component.includes(key),key);
  assert.match(component,/StandardResidentialCarryForward context=\{context\}/);
  assert.match(component,/Existing oven\/refrigerator add-on status/);
  assert.match(component,/Existing window scope or add-on status/);
  assert.match(component,/disabled=\{!!missing\.length\|\|current===sections\.length-1\}/);
  assert.match(page,/moveInOutCompletionIssues\(\s*measurements,\s*row\.standard_residential_context\s*\)/);
});

test("drafts and nested saves preserve assignment isolation and oversight",()=>{
  assert.match(component,/moveInOutAssessment:\{[\s\S]*fieldWalkthrough:\{answers:/);
  assert.match(migration,/if p_complete then[\s\S]*Required Move-In \/ Move-Out answer is missing/);
  assert.match(migration,/normalized - 'moveInOutAssessment', p_complete/);
  assert.match(migration,/walkthrough\.assigned_employee_id is distinct from employee/);
  assert.match(migration,/get_assigned_field_walkthroughs_deep_phase_20260928\(\)/);
  assert.match(migration,/jsonb_set\(existing_move, '\{fieldWalkthrough\}', move_field, true\)/);
  assert.match(page,/readOnly=\{!activeCanEdit\}/);
  assert.doesNotMatch(component,/basePrice|finalPrice|laborCost|grossMargin|salesNotes|Sales \/ Internal Notes/);
});
