import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync("components/walkthroughs/CommercialJanitorialFieldWalkthrough.tsx", "utf8");
const page = readFileSync("components/walkthroughs/FieldWalkthroughsPage.tsx", "utf8");
const migration = readFileSync("supabase/migrations/20260928202722_commercial_janitorial_field_walkthrough.sql", "utf8");
const catalog = readFileSync("supabase/service_catalog_settings.sql", "utf8");

const services = [
  ["COM-OFFICE", "Office Cleaning"], ["COM-BARBER", "Barbershop / Salon Cleaning"],
  ["COM-GYM", "Gym / Spa Cleaning"], ["COM-RESTAURANT", "Restaurant Cleaning"],
  ["COM-STUDIO", "Recording Studio Cleaning"], ["COM-TATTOO", "Tattoo Shop Cleaning"],
  ["COM-WAREHOUSE", "Warehouse Cleaning"], ["COM-RETAIL", "Retail Cleaning"],
  ["PM-COMMON", "Apartment Building / Complex Cleaning"], ["COM-EVENT", "Event Venue Cleaning"],
  ["COM-OTHER", "Other Cleaning"],
];

const sections = [
  "Facility Type", "Occupancy / Operating Status", "Overall Condition", "Flooring", "Restrooms",
  "Breakroom / Kitchen", "Workspaces / Common Areas", "Entry / Lobby / Reception", "Trash / Waste",
  "Glass / Windows", "Dust / Surfaces", "Specialty / Sensitive Areas", "Access / Security",
  "Areas Requiring Extra Attention", "Service Frequency Observation", "Service Suitability",
  "Expected Labor", "Exceptions", "Final Confirmation",
];

test("Commercial and Janitorial walkthrough uses the existing secure guided architecture", () => {
  for (const [code, name] of services) {
    assert.ok(catalog.includes(code), `catalog contains ${code}`);
    assert.ok(catalog.includes(name), `catalog contains ${name}`);
    assert.ok(component.includes(`"${name}"`), `detects ${name}`);
    assert.ok(migration.includes(`'${name}'`), `RPC permits ${name}`);
  }

  let cursor = -1;
  for (const section of sections) {
    const next = component.indexOf(`"${section}"`);
    assert.ok(next > cursor, `${section} is present in order`);
    cursor = next;
  }

  assert.match(component, /StandardResidentialCarryForward/);
  assert.match(component, /Included Add-ons/);
  assert.match(component, /Upstream window scope/);
  assert.match(component, /commercialJanitorialAssessment:\{[\s\S]*fieldWalkthrough:\{answers:/);
  assert.match(component, /GuidedWalkthroughChoice/);
  assert.doesNotMatch(component, /type="radio"/);
  assert.match(component, /type="number"/);
  assert.match(component, /Before continuing:/);
  assert.match(component, /Previous/);
  assert.match(component, /Continue/);
  assert.match(component, /facilityType==="Other"/);
  assert.match(component, /workspaceClutter==="Yes"/);
  assert.match(component, /unusualWaste==="Yes"\|\|a\.wasteRestrictions==="Yes"/);
  assert.match(component, /technicianConfirmation!==true/);

  assert.match(page, /CommercialJanitorialFieldWalkthrough/);
  assert.match(page, /commercialJanitorialCompletionIssues/);
  assert.match(page, /readOnly=\{masterAdmin\}/);
  assert.match(page, /isStandardResidential[\s\S]*isDeepCleaning[\s\S]*isMoveInOut[\s\S]*isCommercialJanitorial/);

  assert.match(migration, /if p_complete then/);
  assert.match(migration, /normalized-'commercialJanitorialAssessment'/);
  assert.match(migration, /walkthrough\.assigned_employee_id is distinct from employee/);
  assert.match(migration, /walkthrough\.status\s*<>\s*'Scheduled'/);
  assert.match(migration, /commercialJanitorialAssessment/);
  assert.match(migration, /set search_path = ''/);
  assert.doesNotMatch(component, /salesInternalNotes|margin|costAmount|priceAmount/i);
});
