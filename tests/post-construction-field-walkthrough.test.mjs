import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync("components/walkthroughs/PostConstructionFieldWalkthrough.tsx", "utf8");
const page = readFileSync("components/walkthroughs/FieldWalkthroughsPage.tsx", "utf8");
const migration = readFileSync("supabase/migrations/20260926051557_technician_post_construction_field_walkthrough.sql", "utf8");
const permissions = readFileSync("lib/auth/permissions.ts", "utf8");

const sections = [
  "Project Overview & Boundaries", "Construction Readiness", "Property Measurements", "Cleaning Standard",
  "Windows & Glass", "Floors & Construction Residue", "Cabinets, Drawers & Closets", "Appliances",
  "Debris & Exclusions", "Specialty Surfaces", "Access, Utilities & Equipment Staging", "Schedule & Deadline",
  "Active Trades & Re-cleaning Responsibility", "Crew & Site Restrictions", "Completion & Sign-Off",
];
const questions = [
  "What type of construction project is this, which areas are affected, and which areas are specifically excluded from cleaning?",
  "What stage is construction in, and when will StudioScrubz have exclusive access to begin cleaning?",
  "What are the property measurements, quantities, and rooms or areas included in the cleaning scope?",
  "Which cleaning level is required, and which horizontal and vertical surfaces must be cleaned?",
  "Are windows or glass included, how many are included, what components or residue require cleaning, and is ladder or special access needed?",
  "Which floor materials are present, and is there paint, grout haze, adhesive, drywall compound, or no construction residue?",
  "Which cabinet, drawer, closet, shelving, or exterior-only storage surfaces are included?",
  "Are appliances excluded, exterior-only, or interior and exterior; which appliance types are included; and is protective film or sticker removal required?",
  "Is the site limited to cleaning waste, does it contain light debris, or does construction debris remain, and who is responsible for removing it?",
  "Which specialty or high-value surfaces and fixtures require special cleaning care?",
  "For parking, stairs or elevator, gate or security, loading, equipment staging, water, electricity, and restroom access, is each available, unavailable, or restricted?",
  "When may cleaning start, when must it be completed, and who or what arrives immediately afterward?",
  "Will other trades be absent, working during cleaning, or returning afterward, and who is responsible for any required re-cleaning?",
  "Which HOA, building-hour, quiet-hour, security, crew-size, or other site restrictions apply?",
  "Who will approve completion, what is their role, and will acceptance use a visual walkthrough, written punch list, photo approval, or another standard?",
];

test("Post-Construction field walkthrough renders all 15 ordered sections and gates completion", () => {
  let cursor = -1;
  for (const section of sections) {
    const next = component.indexOf(`"${section}"`);
    assert.ok(next > cursor, `${section} is present in order`);
    cursor = next;
  }
  for (const question of questions) assert.ok(component.includes(question), `renders: ${question}`);
  assert.match(component, /type="radio"/);
  assert.match(component, /type="checkbox"/);
  assert.match(component, /type="number"/);
  assert.match(component, /type="datetime-local"/);
  assert.match(component, /stage==="Other"/);
  assert.match(component, /specialAccess==="Yes"/);
  assert.match(component, /residuePhotoConfirmed/);
  assert.match(component, /disabled=\{!!missing\.length\|\|current===14\}/);
  assert.match(component, /Before continuing:/);
  assert.match(component, /Previous/);
  assert.match(component, /Continue/);
  assert.match(page, /if\(complete&&isPostConstruction\).*postConstructionCompletionIssues/);
  assert.match(page, /Save Draft/);
  assert.match(migration, /create or replace function public\.get_assigned_field_walkthroughs/);
  assert.match(migration, /create or replace function public\.submit_assigned_field_walkthrough/);
  assert.match(migration, /Only the technician field walkthrough is writable/);
  assert.match(migration, /set search_path = ''/);
  assert.match(permissions, /permission === "walkthroughs\.field"[\s\S]*Boolean\(profile\.employee_id\)[\s\S]*\["Crew Lead", "Scrub Technician"\]/);
  assert.doesNotMatch(permissions, /\["Master Admin", "Crew Lead", "Scrub Technician"\]/);
});
