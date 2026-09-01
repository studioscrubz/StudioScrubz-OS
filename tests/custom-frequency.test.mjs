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

for (const interval of [10, 21, 30]) {
  assert.equal(frequency.validCustomIntervalDays(interval), true);
  assert.equal(frequency.serviceFrequencyLabel("Custom", interval), `Every ${interval} Days`);
  assert.equal(frequency.estimatedVisitsPerMonth("Custom", interval), 365 / interval / 12);
}
for (const interval of [null, 0, -1, 1.5]) assert.equal(frequency.validCustomIntervalDays(interval), false);
assert.equal(frequency.estimatedMonthlyTotal(120, "Custom", 21), 173.81);
assert.notEqual(frequency.estimatedVisitsPerMonth("Custom", 21), frequency.estimatedVisitsPerMonth("Biweekly"));
assert.notEqual(frequency.estimatedVisitsPerMonth("Custom", 21), frequency.estimatedVisitsPerMonth("Twice Monthly"));

const rule = { daysOfWeek: [], intervalWeeks: 1, dayOfMonth: null, secondDayOfMonth: null, customIntervalDays: 21 };
assert.deepEqual(
  recurrence.generateServiceDates("2024-01-31", "2024-04-30", "Custom", rule, "2024-04-30", false),
  ["2024-01-31", "2024-02-21", "2024-03-14", "2024-04-04", "2024-04-25"],
);
assert.deepEqual(
  recurrence.generateServiceDates("2023-12-25", "2024-02-15", "Custom", { ...rule, customIntervalDays: 10 }, "2024-02-15", false),
  ["2023-12-25", "2024-01-04", "2024-01-14", "2024-01-24", "2024-02-03", "2024-02-13"],
);
assert.deepEqual(
  recurrence.generateServiceDates("2024-02-28", "2024-03-31", "Custom", { ...rule, customIntervalDays: 30 }, "2024-03-31", false),
  ["2024-02-28", "2024-03-30"],
);

const agreementService = readFileSync(resolve("lib/services/agreements.ts"), "utf8");
assert.match(agreementService, /Number\.isInteger\(input\.custom_interval_days\)/);
assert.match(agreementService, /Number\.isInteger\(agreement\.custom_interval_days\)/);
const agreementPage = readFileSync(resolve("components/agreements/AgreementsPage.tsx"), "utf8");
assert.match(agreementPage, /custom_interval_days:proposal\.frequency==="Custom"\?proposal\.result\.customIntervalDays\?\?null:null/);
const estimatePage = readFileSync(resolve("components/estimates/EstimateBuilder.tsx"), "utf8");
assert.match(estimatePage, /"Custom"/);
assert.match(estimatePage, /customIntervalDays:v === "Custom" \? value\.customIntervalDays \?\? 1 : null/);
const migration = readFileSync(resolve("supabase/migrations/20260901003000_validate_custom_service_frequency.sql"), "utf8");
assert.match(migration, /frequency = 'Custom' and custom_interval_days is not null and custom_interval_days >= 1/);
assert.match(migration, /frequency <> 'Custom' and custom_interval_days is null/);
assert.doesNotMatch(migration, /validate constraint/);

console.log("Custom frequency tests passed.");
