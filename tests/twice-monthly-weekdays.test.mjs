import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(
  readFileSync("lib/scheduling/recurrence.ts", "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText, { module, exports: module.exports });
const { generateServiceDates } = module.exports;
const rule = {
  daysOfWeek: [5], intervalWeeks: 1, dayOfMonth: null,
  secondDayOfMonth: null, customIntervalDays: null, monthlyWeekOrdinals: [2, 4],
};
test("second and fourth Friday yields exactly two visits every month including five-Friday months", () => {
  for (const year of [2026, 2027, 2028]) {
    const dates = Array.from(generateServiceDates(
      `${year}-01-01`, `${year}-12-31`, "Twice Monthly", rule, null, true,
    ));
    assert.equal(dates.length, 24);
    for (let month = 1; month <= 12; month++) {
      const visits = dates.filter(date => Number(date.slice(5, 7)) === month);
      assert.equal(visits.length, 2);
      for (const date of visits) {
        assert.equal(new Date(`${date}T12:00:00Z`).getUTCDay(), 5);
        assert.ok([2, 4].includes(Math.ceil(Number(date.slice(8)) / 7)));
      }
    }
  }
});
test("agreement start and end boundaries are respected", () => {
  assert.deepEqual(Array.from(generateServiceDates(
    "2026-11-27", "2027-01-31", "Twice Monthly", rule, "2026-12-20", false,
  )), ["2026-11-27", "2026-12-11"]);
});
test("legacy calendar-day schedules retain their dates", () => {
  assert.deepEqual(Array.from(generateServiceDates(
    "2026-11-01", "2026-11-30", "Twice Monthly",
    { ...rule, monthlyWeekOrdinals: null, daysOfWeek: [], dayOfMonth: 8, secondDayOfMonth: 22 },
    null, true,
  )), ["2026-11-08", "2026-11-22"]);
});
test("incomplete ordinal schedules never fall back to calendar days", () => {
  assert.equal(generateServiceDates(
    "2026-11-01", "2026-11-30", "Twice Monthly",
    { ...rule, monthlyWeekOrdinals: [], dayOfMonth: null, secondDayOfMonth: null },
    null, true,
  ).length, 0);
});
