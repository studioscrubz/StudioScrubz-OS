import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync("components/walkthroughs/PostConstructionFieldWalkthrough.tsx", "utf8");
const page = readFileSync("components/walkthroughs/FieldWalkthroughsPage.tsx", "utf8");
const migration = readFileSync("supabase/migrations/20260926051557_technician_post_construction_field_walkthrough.sql", "utf8");

const sections = [
  "Project Overview & Boundaries", "Construction Readiness", "Property Measurements", "Cleaning Standard",
  "Windows & Glass", "Floors & Construction Residue", "Cabinets, Drawers & Closets", "Appliances",
  "Debris & Exclusions", "Specialty Surfaces", "Access, Utilities & Equipment Staging", "Schedule & Deadline",
  "Active Trades & Re-cleaning Responsibility", "Crew & Site Restrictions", "Completion & Sign-Off",
];

test("Post-Construction field walkthrough renders all 15 ordered sections and gates completion", () => {
  let cursor = -1;
  for (const section of sections) {
    const next = component.indexOf(`"${section}"`);
    assert.ok(next > cursor, `${section} is present in order`);
    cursor = next;
  }
  assert.match(component, /POST_CONSTRUCTION_FIELD_SECTIONS\.filter/);
  assert.match(component, /!field\?\.sectionConfirmations/);
  assert.match(component, /!field\?\.answers/);
  assert.match(component, /Unknown \/ Confirm Later/);
  assert.match(page, /if\(complete&&isPostConstruction\).*postConstructionCompletionIssues/);
  assert.match(page, /Save Draft/);
  assert.match(migration, /create or replace function public\.get_assigned_field_walkthroughs/);
  assert.match(migration, /create or replace function public\.submit_assigned_field_walkthrough/);
  assert.match(migration, /Only the technician field walkthrough is writable/);
  assert.match(migration, /set search_path = ''/);
});
