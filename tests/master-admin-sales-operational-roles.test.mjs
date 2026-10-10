import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20261009232854_employee_operational_sales_roles.sql",
  "utf8",
);
const commission = readFileSync(
  "supabase/migrations/20261002151500_lead_representative_commission_ledger_phase_2.sql",
  "utf8",
);
const publicEstimate = readFileSync(
  "lib/services/publicEstimateRequests.ts",
  "utf8",
);
const permissions = readFileSync("lib/auth/permissions.ts", "utf8");

test("the confirmed existing Kris account receives additive roles without identity duplication", () => {
  assert.match(migration, /3383bcb5-d1a3-4a78-8602-9585d7940047/);
  assert.match(migration, /763825e5-9cf1-47a9-b238-bb8348793924/);
  assert.match(migration, /krisg@studioscrubz\.com/);
  assert.match(migration, /profile\.role = 'Master Admin'/);
  assert.match(migration, /'Scrub Technician'/);
  assert.match(migration, /'Sales Representative'/);
  assert.doesNotMatch(migration, /insert into (?:auth\.users|public\.user_profiles|public\.employees)/i);
  assert.doesNotMatch(migration, /update public\.(?:user_profiles|employees)/i);
});

test("displayed department, administrative authorization, and operational roles are independent", () => {
  const helper = migration.match(
    /create or replace function private\.employee_has_operational_role[\s\S]*?\n\$\$;/,
  )?.[0] ?? "";
  assert.match(helper, /employee\.employment_status = 'Active'/);
  assert.match(helper, /employee\.archived_at is null/);
  assert.match(helper, /employee\.department = 'Scrub Technicians'/);
  assert.match(helper, /employee\.department = 'Lead Representative'/);
  assert.match(helper, /employee_operational_roles assignment/);
  assert.match(helper, /assignment\.revoked_at is null/);
  assert.match(helper, /assignment\.effective_at <= transaction_timestamp\(\)/);
  assert.match(permissions, /"Master Admin": new Set\(PERMISSIONS\)/);
  assert.doesNotMatch(migration, /set\s+role\s*=|set\s+department\s*=/i);
});

test("changing displayed department to Sales and back cannot remove technician or Sales eligibility", () => {
  assert.match(migration, /primary key \(employee_id, operational_role\)/);
  assert.match(migration, /private\.employee_has_operational_role\((?:employee|e)\.id, ''Scrub Technician''\)/);
  assert.match(migration, /inspected_count <> 5/);
  assert.match(migration, /private\.employee_has_operational_role\([\s\S]*'Sales Representative'/);
  assert.match(migration, /private\.is_eligible_lead_representative_employee/);
  const currentEligibility = migration.match(
    /create or replace function public\.is_current_lead_representative_eligible\(\)[\s\S]*?\n\$\$;/,
  )?.[0] ?? "";
  assert.match(currentEligibility, /profile\.is_active/);
  assert.match(currentEligibility, /private\.is_eligible_lead_representative_employee\(profile\.employee_id\)/);
  assert.doesNotMatch(currentEligibility, /profile\.role = 'Lead Representative'/);
  assert.doesNotMatch(
    migration.match(/do \$migration\$[\s\S]*?target_employee_id[\s\S]*?\$migration\$;/)?.[0] ?? "",
    /update public\.employees|delete from public\.employee_operational_roles/i,
  );
});

test("Sales selection covers estimates, proposals, prospects, and public estimate requests", () => {
  assert.match(migration, /create or replace function public\.get_lead_representatives/);
  assert.match(migration, /create or replace function public\.validate_estimate_lead_representative/);
  assert.match(migration, /create or replace function public\.get_prospect_assignees/);
  assert.match(migration, /profile\.role = 'Sales'[\s\S]*private\.is_eligible_lead_representative_employee/);
  assert.match(publicEstimate, /rpc\(\s*"get_public_lead_representatives"/);
  assert.match(publicEstimate, /rpc\(\s*"is_public_lead_representative"/);
  assert.match(migration, /to service_role/);
  assert.doesNotMatch(migration, /grant execute[\s\S]*get_public_lead_representatives[\s\S]*to (?:anon|authenticated)/);
});

test("commission calculation, attribution, payout rules, and duplicate prevention remain authoritative", () => {
  assert.match(commission, /'LEAD_REP_2026_10_02'[\s\S]*25\.00[\s\S]*40\.00[\s\S]*25\.00/);
  assert.match(commission, /lead_representative_id/);
  assert.match(commission, /lead_commission_one_initial_per_origin/);
  assert.match(commission, /lead_commission_one_recurring_bonus_per_origin/);
  assert.match(commission, /on conflict \(cleaning_qualification_id, payment_id, source_type\) do nothing/);
  assert.match(migration, /get_lead_commission_payout_management/);
  assert.match(migration, /create_lead_commission_payout_adjustment/);
  assert.doesNotMatch(migration, /insert into public\.lead_commission_ledger/i);
  assert.doesNotMatch(migration, /update public\.lead_commission_ledger/i);
});

test("the assignment is prospective and creates no retroactive commissions", () => {
  assert.match(migration, /effective_at timestamptz not null default transaction_timestamp\(\)/);
  assert.match(migration, /'Sales Representative', transaction_timestamp\(\)/);
  assert.match(migration, /no retroactive commission generation/i);
  assert.doesNotMatch(migration, /from public\.jobs[\s\S]*insert into public\.lead_commission_ledger/i);
});
