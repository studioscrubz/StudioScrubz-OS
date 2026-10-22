import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

function loadModule(path) {
  const output = ts.transpileModule(readFileSync(resolve(path), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("exports", "module", "require", output)(module.exports, module, () => ({}));
  return module.exports;
}

const frequency = loadModule("lib/scheduling/frequency.ts");
const recurrence = loadModule("lib/scheduling/recurrence.ts");
const days = [1, 3, 5]; // Monday, Wednesday and Friday

assert.equal(frequency.validServiceWeekdays(days), true);
for (const invalid of [[], [1], [1, 1], [1, 7], [-1, 3], [1.5, 3]]) {
  assert.equal(frequency.validServiceWeekdays(invalid), false);
}
assert.equal(frequency.estimatedVisitsPerMonth("Multiple Days Per Week", null, days), 3 * 52 / 12);
assert.equal(frequency.estimatedMonthlyTotal(150, "Multiple Days Per Week", null, days), 1950);
assert.equal(frequency.estimatedMonthlyTotal(150, "Multiple Days Per Week", null, []), null);
assert.equal(frequency.estimatedVisitsPerMonth("Weekly"), 52 / 12);
assert.equal(frequency.estimatedMonthlyTotal(120, "Custom", 21), 173.81);

const rule = { daysOfWeek: days, intervalWeeks: 1, dayOfMonth: null, secondDayOfMonth: null, customIntervalDays: null };
assert.deepEqual(
  recurrence.generateServiceDates("2026-11-02", "2026-11-13", "Multiple Days Per Week", rule, "2026-11-13", false),
  ["2026-11-02", "2026-11-04", "2026-11-06", "2026-11-09", "2026-11-11", "2026-11-13"],
);
for (const path of [
  "components/estimates/EstimateBuilder.tsx",
  "components/estimates/PostConstructionCalculatorFields.tsx",
  "components/proposals/ProposalBuilder.tsx",
  "components/agreements/AgreementsPage.tsx",
]) {
  assert.match(readFileSync(resolve(path), "utf8"), /Multiple Days Per Week/);
}
assert.match(readFileSync(resolve("components/agreements/AgreementsPage.tsx"), "utf8"), /proposal\.result\.serviceDaysOfWeek/);
assert.match(readFileSync(resolve("lib/pricing/proposals.ts"), "utf8"), /serviceDaysOfWeek/);
console.log("Weekly service day selection tests passed.");
