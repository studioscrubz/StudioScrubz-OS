import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component=readFileSync("components/walkthroughs/PropertyManagementCommonAreasFieldWalkthrough.tsx","utf8");
const commercial=readFileSync("components/walkthroughs/CommercialJanitorialFieldWalkthrough.tsx","utf8");
const migration=readFileSync("supabase/migrations/20260928204100_property_management_common_areas_field_walkthrough.sql","utf8");
const catalog=readFileSync("supabase/service_catalog_settings.sql","utf8");
const sections=["Property Overview","Occupancy / Access","Overall Common-Area Condition","Entry / Lobby","Hallways / Corridors","Stairwells","Elevators","Laundry Rooms","Trash / Refuse Areas","Exterior Common Areas","Amenities","Parking / Garage","Flooring","Glass / Windows","High-Touch / Detail Areas","Pet / Resident Impact","Areas Requiring Extra Attention","Service Frequency Observation","Service Suitability","Expected Labor","Exceptions","Final Confirmation"];

test("PM-COMMON has a dedicated secure guided walkthrough",()=>{
 assert.match(catalog,/PM-COMMON[\s\S]*Apartment Building \/ Complex Cleaning/);
 assert.match(component,/service\?\.trim\(\)===\"Apartment Building \/ Complex Cleaning\"/);
 assert.match(commercial,/isPropertyManagementCommonAreasService[\s\S]*PropertyManagementCommonAreasFieldWalkthrough/);
 let cursor=-1;for(const section of sections){const next=component.indexOf(`"${section}"`);assert.ok(next>cursor,`${section} is ordered`);cursor=next}
 assert.match(component,/StandardResidentialCarryForward/);
 assert.match(component,/Included Add-ons \/ Scope/);
 assert.match(component,/propertyManagementCommonAreasAssessment:[\s\S]*fieldWalkthrough:[\s\S]*answers/);
 assert.match(component,/Upstream window scope/);
 assert.match(component,/reported upstream/);
 assert.match(component,/Before continuing:/);
 assert.match(component,/Previous/);assert.match(component,/Continue/);
 assert.match(component,/technicianConfirmation!==true/);
 assert.match(migration,/if p_complete then/);
 assert.match(migration,/normalized-'propertyManagementCommonAreasAssessment'/);
 assert.match(migration,/walkthrough\.assigned_employee_id is distinct from employee/);
 assert.match(migration,/serviceType',''\)<>\s*'Apartment Building \/ Complex Cleaning'/);
 assert.match(migration,/propertyManagementCommonAreasAssessment/);
 assert.match(migration,/set search_path = ''/);
 assert.doesNotMatch(component,/salesInternalNotes|margin|costAmount|priceAmount/i);
 for(const name of ["Office Cleaning","Barbershop / Salon Cleaning","Gym / Spa Cleaning","Restaurant Cleaning","Recording Studio Cleaning","Tattoo Shop Cleaning","Warehouse Cleaning","Retail Cleaning","Event Venue Cleaning","Other Cleaning"]){assert.ok(commercial.includes(`"${name}"`),`${name} remains base Commercial`)}
});
