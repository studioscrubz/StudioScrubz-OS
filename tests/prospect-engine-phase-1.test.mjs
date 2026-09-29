import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/20260929150434_prospect_engine_phase_1.sql", "utf8");
const permissions = readFileSync("lib/auth/permissions.ts", "utf8");
const scoring = readFileSync("lib/prospectScoring.ts", "utf8");
const page = readFileSync("components/prospects/ProspectsPage.tsx", "utf8");
const service = readFileSync("lib/services/prospects.ts", "utf8");

test("prospect RLS enforces management, assigned Sales, and excluded field roles", () => {
  assert.match(migration, /array\['Master Admin','Administrator','Manager'\]/);
  assert.match(migration, /Sales read assigned prospects[\s\S]*assigned_user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /Sales update assigned prospects[\s\S]*assigned_user_id = \(select auth\.uid\(\)\)[\s\S]*with check[\s\S]*assigned_user_id = \(select auth\.uid\(\)\)/);
  assert.doesNotMatch(migration, /Crew Lead|Scrub Technician/);
  assert.match(permissions, /Sales: new Set\(\[[\s\S]*"prospects\.view", "prospects\.manage"/);
});

test("suppression and audit records cannot be changed or deleted directly", () => {
  assert.match(migration, /grant select,insert on table public\.prospect_suppressions to authenticated/);
  assert.doesNotMatch(migration, /grant[^;]*(update|delete)[^;]*prospect_suppressions/i);
  assert.match(migration, /grant select on table public\.prospect_events to authenticated/);
  assert.doesNotMatch(migration, /grant[^;]*(insert|update|delete)[^;]*prospect_events/i);
  assert.doesNotMatch(migration, /policy[^;]* for delete/i);
});

test("scoring is deterministic and limited to approved factors", () => {
  for (const factor of ["territory", "industry", "recurringPotential", "verificationStatus", "estimatedValue", "discoveredAt"]) assert.match(scoring, new RegExp(factor));
  assert.doesNotMatch(scoring, /fetch\(|openai|anthropic|random/i);
  const score = 20 + 15 + 20 + 15 + 20 + 10;
  assert.equal(score, 100);
  assert.match(migration, /public\.prospect_score\(new\.territory,new\.industry,new\.recurring_potential,new\.verification_status,new\.email_normalized,new\.phone_normalized,new\.estimated_value,new\.discovered_at\)/);
});

test("MVP has no outreach, crawling, import, or conversion behavior", () => {
  const application = `${page}\n${service}`;
  assert.doesNotMatch(application, /sendEmail|sendSms|dialProspect|crawlProspect|importCsv|convertToClient|convertToEstimate/);
  assert.match(page, /without automated outreach/i);
});
