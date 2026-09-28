import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component=readFileSync("components/walkthroughs/OfficeCleaningFieldWalkthrough.tsx","utf8");
const commercial=readFileSync("components/walkthroughs/CommercialJanitorialFieldWalkthrough.tsx","utf8");
const migration=readFileSync("supabase/migrations/20260928205000_office_cleaning_field_walkthrough.sql","utf8");
const catalog=readFileSync("supabase/service_catalog_settings.sql","utf8");
const sections=["Office Type / Layout","Occupancy During Service","Overall Condition","Workstations / Desks","Conference Rooms","Reception / Lobby","Breakroom / Kitchen","Restrooms","Flooring","Glass","Trash / Recycling","High-Touch Areas","Sensitive Equipment / Areas","Areas Requiring Extra Attention","Service Frequency Observation","Service Suitability","Expected Labor","Exceptions","Final Confirmation"];

test("COM-OFFICE has a dedicated secure guided walkthrough",()=>{
  assert.match(catalog,/COM-OFFICE[\s\S]*Office Cleaning/);
  assert.match(component,/service\?\.trim\(\)===\"Office Cleaning\"/);
  assert.match(commercial,/isOfficeCleaningService[\s\S]*OfficeCleaningFieldWalkthrough/);
  assert.match(commercial,/isPropertyManagementCommonAreasService[\s\S]*PropertyManagementCommonAreasFieldWalkthrough/);
  let cursor=-1;for(const section of sections){const next=component.indexOf(`"${section}"`);assert.ok(next>cursor,`${section} is ordered`);cursor=next}
  assert.match(component,/StandardResidentialCarryForward/);
  assert.match(component,/Included Add-ons \/ Scope/);
  assert.match(component,/officeCleaningAssessment:[\s\S]*fieldWalkthrough:[\s\S]*answers/);
  assert.match(component,/Upstream window\/glass scope/);
  assert.match(component,/Before continuing:/);
  assert.match(component,/Previous/);assert.match(component,/Continue/);
  assert.match(component,/occupancyLimits===\"Yes\"/);
  assert.match(component,/sensitiveAreas===\"Yes\"/);
  assert.match(component,/technicianConfirmation!==true/);
  assert.match(migration,/if p_complete then/);
  assert.match(migration,/normalized-'officeCleaningAssessment'/);
  assert.match(migration,/walkthrough\.assigned_employee_id is distinct from employee/);
  assert.match(migration,/serviceType',''\)<>\s*'Office Cleaning'/);
  assert.match(migration,/officeCleaningAssessment/);
  assert.match(migration,/set search_path = ''/);
  assert.doesNotMatch(component,/salesInternalNotes|margin|costAmount|priceAmount/i);
  for(const name of ["Barbershop / Salon Cleaning","Gym / Spa Cleaning","Restaurant Cleaning","Recording Studio Cleaning","Tattoo Shop Cleaning","Warehouse Cleaning","Retail Cleaning","Event Venue Cleaning","Other Cleaning"]){assert.ok(commercial.includes(`"${name}"`),`${name} remains base Commercial`)}
});
