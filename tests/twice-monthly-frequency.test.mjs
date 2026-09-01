import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

function loadTypeScriptModule(path, requireFn = () => ({})) {
  const source = readFileSync(resolve(path), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  new Function("exports", "module", "require", output)(loadedModule.exports, loadedModule, requireFn);
  return loadedModule.exports;
}

const frequency = loadTypeScriptModule("lib/scheduling/frequency.ts");
const recurrence = loadTypeScriptModule("lib/scheduling/recurrence.ts");
const pricingEngine = loadTypeScriptModule("lib/pricing/pricingEngine.ts", () => frequency);

assert.equal(frequency.estimatedVisitsPerMonth("Biweekly"), 26 / 12);
assert.equal(frequency.estimatedMonthlyTotal(410.35, "Biweekly"), 889.09);
assert.equal(frequency.estimatedVisitsPerMonth("Twice Monthly"), 2);
assert.equal(frequency.estimatedMonthlyTotal(410.35, "Twice Monthly"), 820.70);
assert.notEqual(frequency.estimatedVisitsPerMonth("Twice Monthly"), frequency.estimatedVisitsPerMonth("Biweekly"));

const twiceMonthlyRule = { daysOfWeek: [], intervalWeeks: 1, dayOfMonth: 5, secondDayOfMonth: 20, customIntervalDays: null };
const fullYear = recurrence.generateServiceDates("2027-01-01", "2027-12-31", "Twice Monthly", twiceMonthlyRule, "2027-12-31", false);
assert.equal(fullYear.length, 24);
for (let month = 1; month <= 12; month += 1) {
  assert.equal(fullYear.filter((date) => date.startsWith(`2027-${String(month).padStart(2, "0")}-`)).length, 2);
}
assert.deepEqual(fullYear.filter((date) => date.startsWith("2027-02-")), ["2027-02-05", "2027-02-20"]);
assert.deepEqual(fullYear.filter((date) => date.startsWith("2027-04-")), ["2027-04-05", "2027-04-20"]);
assert.deepEqual(fullYear.filter((date) => date.startsWith("2027-05-")), ["2027-05-05", "2027-05-20"]);
assert.deepEqual(fullYear.slice(-2), ["2027-12-05", "2027-12-20"]);

const biweekly = recurrence.generateServiceDates(
  "2027-01-04",
  "2028-01-02",
  "Biweekly",
  { ...twiceMonthlyRule, daysOfWeek: [1] },
  "2028-01-02",
  false,
);
assert.equal(biweekly.length, 26);

const recurrenceSource = readFileSync(resolve("lib/scheduling/recurrence.ts"), "utf8");
assert.match(recurrenceSource, /frequency==="Twice Monthly"/);
assert.doesNotMatch(recurrenceSource, /frequency==="Twice Monthly"[^;]*(?:%14|intervalWeeks)/);

const catalogSource = readFileSync(resolve("components/settings/ServiceCatalogPage.tsx"), "utf8");
assert.match(catalogSource, /"Biweekly", "Twice Monthly", "Monthly"/);
const recurringRules = [
  { id: "biweekly", frequency: "Biweekly", service_id: "service", is_active: true },
  { id: "twice-active", frequency: "Twice Monthly", service_id: "service", is_active: true },
  { id: "twice-archived", frequency: "Twice Monthly", service_id: "service", is_active: false },
];
assert.deepEqual(pricingEngine.matchingRecurringRules("Twice Monthly", recurringRules, "service").map((rule) => rule.id), ["twice-active"]);
const pricingEngineSource = readFileSync(resolve("lib/pricing/pricingEngine.ts"), "utf8");
assert.match(pricingEngineSource, /x\.frequency===frequency/);
assert.match(pricingEngineSource, /x\.is_active/);

for (const path of [
  "types/estimate.ts",
  "types/agreement.ts",
  "components/estimates/EstimateBuilder.tsx",
  "components/walkthroughs/WalkthroughPricingReviewModal.tsx",
  "components/proposals/ProposalBuilder.tsx",
]) {
  assert.match(readFileSync(resolve(path), "utf8"), /Twice Monthly/, `${path} must preserve Twice Monthly`);
}

const authoritativeSource = readFileSync(resolve("lib/pricing/authoritativePrice.ts"), "utf8");
assert.match(authoritativeSource, /estimatedMonthlyTotal\(finalPrice, result\.calculatorInput\.frequency\)/);
assert.match(authoritativeSource, /estimatedMonthlyTotal\(perVisitTotal, frequency\)/);

const migration = readFileSync(resolve("supabase/migrations/20260901002039_add_twice_monthly_service_frequency.sql"), "utf8");
assert.match(migration, /frequency = 'Twice Monthly'/);
assert.match(migration, /frequency <> 'Twice Monthly'\s+and second_day_of_month is null/);
assert.match(migration, /day_of_month <> second_day_of_month/);
assert.match(migration, /second_day_of_month between 1 and 28/);

console.log("Twice Monthly frequency tests passed.");
