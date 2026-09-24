import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const page = read("app/(workspace)/applications/page.tsx");
const legacyPage = read("app/(workspace)/lead-generator-applications/page.tsx");
const management = read("components/recruiting/JobApplicationsPage.tsx");
const sidebar = read("components/layout/Sidebar.tsx");
const permissions = read("lib/auth/permissions.ts");
const types = read("types/jobApplication.ts");
const schema = read("supabase/migrations/20260924142944_lead_generator_applications.sql");

test("Applications is the canonical management route and old bookmarks permanently redirect", () => {
  assert.match(page, /<JobApplicationsPage \/>/);
  assert.match(legacyPage, /permanentRedirect\("\/applications"\)/);
  assert.match(sidebar, /label: "Applications", href: "\/applications"/);
  assert.doesNotMatch(sidebar, /href: "\/lead-generator-applications"/);
});

test("canonical and legacy routes retain the management-only permission", () => {
  assert.match(permissions, /\["\/applications", "jobApplications\.manage"\]/);
  assert.match(permissions, /\["\/lead-generator-applications", "jobApplications\.manage"\]/);
  assert.match(permissions, /const operationalAdmin:[\s\S]*?"jobApplications\.manage"/);
  assert.match(permissions.match(/Manager: new Set\(\[[\s\S]*?\]\)/)?.[0] ?? "", /jobApplications\.manage/);
  assert.doesNotMatch(permissions.match(/Sales: new Set\(\[[\s\S]*?\]\)/)?.[0] ?? "", /jobApplications\.manage/);
});

test("workspace wording, opening category, subtitle, and future filters are present", () => {
  assert.match(management, />Applications<\/h1>/);
  assert.match(management, /Review and manage employment and independent-contractor applications\./);
  for (const category of ["All Applications", "Lead/Sales", "Scrub Tech", "Administration"]) assert.ok(management.includes(category));
  assert.match(management, /"lead-generator":[\s\S]*type: "Lead\/Sales"/);
  assert.match(management, /Lead generation and appointment setting — StudioScrubz management handles final estimates and closing\./);
  assert.match(management, /opening\?\.type === applicationType/);
});

test("existing opening projection is reused without changing constrained persistence behavior", () => {
  assert.match(types, /opening_identifier:string/);
  assert.match(schema, /opening_identifier text not null default 'lead-generator' check \(opening_identifier = 'lead-generator'\)/);
  assert.match(schema, /has_any_role\(array\['Master Admin','Administrator','Manager'\]\)/g);
  assert.match(schema, /job_application_events/);
  assert.match(schema, /revoke all on table public\.job_applications, public\.job_application_events from public, anon, authenticated/);
});
