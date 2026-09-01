import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

function load(path, requireFn = () => ({})) {
  const output = ts.transpileModule(readFileSync(resolve(path), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loadedModule = { exports: {} };
  new Function("exports", "module", "require", output)(loadedModule.exports, loadedModule, requireFn);
  return loadedModule.exports;
}

const upkeep = load("lib/pricing/upkeepPlan.ts");
const recurrence = load("lib/scheduling/recurrence.ts");

assert.deepEqual(upkeep.calculateUpkeepPlan(200, 30), { standardCleaningValue: 200, adjustmentPercent: 30, upkeepVisitValue: 140, visitsIncluded: 3, monthlyPackage: 420 });
assert.deepEqual(upkeep.calculateUpkeepPlan(250, 40), { standardCleaningValue: 250, adjustmentPercent: 40, upkeepVisitValue: 150, visitsIncluded: 3, monthlyPackage: 450 });
assert.equal(upkeep.calculateUpkeepPlan(250, 0).monthlyPackage, 750);
assert.throws(() => upkeep.calculateUpkeepPlan(200, 40.01), /0% and 40%/);
assert.throws(() => upkeep.calculateUpkeepPlan(200, -1), /0% and 40%/);
assert.equal(upkeep.calculateUpkeepPlan(199.99, 30).monthlyPackage, 419.98);

const rule = { daysOfWeek: [], intervalWeeks: 1, dayOfMonth: 5, secondDayOfMonth: 15, thirdDayOfMonth: 25, customIntervalDays: null };
const dates = recurrence.generateServiceDates("2024-01-01", "2025-01-31", "Monthly", rule, "2025-01-31", false);
for (const month of ["2024-02", "2024-04", "2024-12", "2025-01"]) assert.equal(dates.filter(date => date.startsWith(month)).length, 3);
assert.equal(dates.filter(date => date.startsWith("2024-")).length, 36);
assert.notEqual(dates.length, recurrence.generateServiceDates("2024-01-01", "2025-01-31", "Twice Monthly", rule, "2025-01-31", false).length);
assert.notEqual(dates.length, recurrence.generateServiceDates("2024-01-01", "2025-01-31", "Custom", { ...rule, customIntervalDays: 10 }, "2025-01-31", false).length);

const migration = readFileSync(resolve("supabase/migrations/20260901004000_add_upkeep_plan_v2.sql"), "utf8");
assert.match(migration, /upkeep_adjustment_percent between 0 and 40/);
assert.match(migration, /third_day_of_month between 1 and 28/);
assert.match(migration, /service_name = 'StudioScrubz Upkeep Plan'/);
assert.match(migration, /billing_type = 'Monthly'/);
assert.match(migration, /third_day_of_month/);
assert.match(migration, /prevent_signed_upkeep_schedule_changes/);
assert.match(migration, /frequency = 'Twice Monthly'\s+and day_of_month is not null\s+and second_day_of_month is not null/);
assert.match(migration, /service_name = 'StudioScrubz Upkeep Plan'\s+and frequency = 'Monthly'\s+and day_of_month is not null\s+and second_day_of_month is not null\s+and third_day_of_month is not null/);

function validTwiceMonthly(firstDay, secondDay, thirdDay = null) {
  return firstDay !== null && secondDay !== null && firstDay >= 1 && firstDay <= 28 && secondDay >= 1 && secondDay <= 28 && firstDay !== secondDay && thirdDay === null;
}
function validUpkeep(firstDay, secondDay, thirdDay) {
  return [firstDay, secondDay, thirdDay].every(day => day !== null && day >= 1 && day <= 28) && new Set([firstDay, secondDay, thirdDay]).size === 3;
}
assert.equal(validTwiceMonthly(null, 15), false);
assert.equal(validTwiceMonthly(5, null), false);
assert.equal(validTwiceMonthly(5, 15), true);
assert.equal(validUpkeep(null, 15, 25), false);
assert.equal(validUpkeep(5, null, 25), false);
assert.equal(validUpkeep(5, 15, null), false);
assert.equal(validUpkeep(5, 15, 25), true);

const proposalPricing = readFileSync(resolve("lib/pricing/proposals.ts"), "utf8");
assert.match(proposalPricing, /upkeepPlan: input\.estimate\?\.upkeepPlan \?\? null/);
assert.match(proposalPricing, /input\.estimate\.upkeepPlan\.monthlyPackage/);
const agreementPricing = readFileSync(resolve("lib/pricing/agreementPricing.ts"), "utf8");
assert.match(agreementPricing, /upkeep_plan:values\.upkeepPlan\?\?null/);
const agreementService = readFileSync(resolve("lib/services/agreements.ts"), "utf8");
assert.match(agreementService, /Upkeep Plan agreements must use Monthly billing/);
assert.match(agreementService, /third_day_of_month: review\.thirdDayOfMonth \?\? null/);
const agreementPage = readFileSync(resolve("components/agreements/AgreementsPage.tsx"), "utf8");
assert.match(agreementPage, /const upkeep=Boolean\(proposal\.result\.upkeepPlan\)/);
assert.match(agreementPage, /frequency:upkeep\?"Monthly":proposal\.frequency/);
assert.match(agreementPage, /day_of_month:upkeep\?null/);
assert.match(agreementPage, /second_day_of_month:null,third_day_of_month:null/);
assert.match(agreementPage, /billing_type:upkeep\?"Monthly":"Per Visit"/);
assert.match(agreementPage, /billing_amount:upkeep\?proposal\.result\.upkeepPlan!\.monthlyPackage:proposal\.result\.perVisitTotal/);
assert.match(agreementPage, /thirdDayOfMonth:nextDraft\.third_day_of_month\?\?null/);
assert.match(agreementPage, /disabled=\{operationalEdit\|\|Boolean\(proposal\?\.result\.upkeepPlan\)\}/);
const publicAgreement = readFileSync(resolve("types/publicAgreement.ts"), "utf8");
assert.match(publicAgreement, /third_day_of_month\?: number \| null/);
assert.equal((migration.match(/'third_day_of_month',a\.third_day_of_month/g) ?? []).length, 2);
assert.equal((migration.match(/create or replace function public\.get_service_agreement_by_token/g) ?? []).length, 1);
assert.equal((migration.match(/create or replace function public\.accept_service_agreement_by_token/g) ?? []).length, 1);
assert.equal((migration.match(/security definer set search_path = ''/g) ?? []).length >= 2, true);
const invoiceAuthorization = readFileSync(resolve("supabase/completed_job_invoice_authorization.sql"), "utf8");
assert.match(invoiceAuthorization, /agreement\.billing_type in \('Weekly', 'Biweekly', 'Monthly', 'Flat Contract'\)/);

console.log("Upkeep Plan tests passed.");
