import assert from "node:assert/strict";
import test from "node:test";
import { calculatePostConstructionEstimate } from "./postConstruction.ts";

const calibrationInput = {
  calculatorType: "Post-Construction",
  division: "Commercial",
  serviceType: "Post-Construction Cleaning",
  commercialType: "Post-Construction",
  frequency: "One-Time",
  squareFeet: 9351,
  floors: 2,
  rooms: 6,
  bathrooms: 10,
  restrooms: 10,
  kitchens: 2,
  stations: 0,
  units: 6,
  condition: "Average",
  dustSeverity: "Average",
  debrisSeverity: "Average",
  detailLevel: "Detailed",
  windowsOrGlassCount: 0,
  cabinetOrDrawerCount: 0,
  applianceInteriorCount: 0,
  stairFlights: 0,
  targetProjectDays: 3,
  targetCompletionHours: 0,
  workdayHours: 10,
  workerHourlyPay: 40,
  targetProfitMarginPercent: 35,
  additionalDiscountPercent: 0,
  taxRatePercent: 0,
  additionalServices: [],
};

test("9,351 sq ft calibration lands near 178 labor hours over three 10-hour days", () => {
  const result = calculatePostConstructionEstimate(calibrationInput);
  assert.ok(result.postConstructionBreakdown.baseProductionHours >= 177 && result.postConstructionBreakdown.baseProductionHours <= 179);
  assert.ok(result.laborHours >= 177 && result.laborHours <= 179);
  assert.deepEqual(result.postConstructionBreakdown.adjustments, []);
  assert.ok(result.laborCost >= 7080 && result.laborCost <= 7160);
  assert.equal(result.crewSize, 6);
  assert.equal(result.postConstructionBreakdown.estimatedProjectDays, 3);
});

test("the calibration requires eight workers for eight-hour workdays", () => {
  const result = calculatePostConstructionEstimate({ ...calibrationInput, workdayHours: 8 });
  assert.equal(result.crewSize, 8);
});

test("ordinary bathrooms, kitchens, and floors are neutral under the all-in baseline", () => {
  const ordinary = calculatePostConstructionEstimate(calibrationInput);
  const withoutFixtures = calculatePostConstructionEstimate({ ...calibrationInput, floors: 1, bathrooms: 0, restrooms: 0, kitchens: 0 });
  assert.equal(ordinary.laborHours, withoutFixtures.laborHours);
});

test("heavy scope exceeds average and extreme scope exceeds heavy", () => {
  const average = calculatePostConstructionEstimate(calibrationInput);
  const heavy = calculatePostConstructionEstimate({ ...calibrationInput, condition: "Heavy", dustSeverity: "Heavy", debrisSeverity: "Heavy", detailLevel: "High Detail" });
  const extreme = calculatePostConstructionEstimate({ ...calibrationInput, condition: "Extreme", dustSeverity: "Extreme", debrisSeverity: "Extreme", detailLevel: "High Detail" });
  assert.ok(heavy.laborHours > average.laborHours);
  assert.ok(extreme.laborHours > heavy.laborHours);
  assert.deepEqual(heavy.postConstructionBreakdown.adjustments.map((item) => item.label), ["Heavy overall condition", "Heavy construction dust", "Heavy debris", "High Detail finish work"]);
});

for (const [field, count, expectedIncrease] of [
  ["windowsOrGlassCount", 10, 1.2],
  ["cabinetOrDrawerCount", 20, 1.2],
  ["applianceInteriorCount", 2, 1.5],
]) {
  test(`increasing ${field} adds predictable specialty labor`, () => {
    const baseline = calculatePostConstructionEstimate(calibrationInput);
    const quantified = calculatePostConstructionEstimate({ ...calibrationInput, [field]: count });
    assert.ok(Math.abs((quantified.laborHours - baseline.laborHours) - expectedIncrease) < 0.0001);
  });
}

test("projected margin tracks the selected target before discounts and taxes", () => {
  const result = calculatePostConstructionEstimate({ ...calibrationInput, targetProfitMarginPercent: 42 });
  assert.ok(Math.abs(result.postConstructionBreakdown.projectedMarginPercent - 42) <= 0.1);
});

test("unsafe inputs are clamped without NaN or Infinity", () => {
  const result = calculatePostConstructionEstimate({ ...calibrationInput, squareFeet: -100, targetProjectDays: 0, workdayHours: Number.NaN, workerHourlyPay: Number.POSITIVE_INFINITY, targetProfitMarginPercent: 1000 });
  assert.equal(result.laborHours, 0);
  assert.equal(result.crewSize, 1);
  assert.equal(result.postConstructionBreakdown.projectedMarginPercent, 70);
  assert.deepEqual(findNumbers(result).every(Number.isFinite), true);
});

test("post-construction calculator input survives estimate draft serialization", () => {
  const restored = JSON.parse(JSON.stringify({ version: 1, commercialMode: "post-construction", postConstruction: calibrationInput }));
  assert.deepEqual(restored.postConstruction, calibrationInput);
  assert.equal(calculatePostConstructionEstimate(restored.postConstruction).calculatorInput.calculatorType, "Post-Construction");
});

function findNumbers(value) {
  if (typeof value === "number") return [value];
  if (Array.isArray(value)) return value.flatMap(findNumbers);
  if (value && typeof value === "object") return Object.values(value).flatMap(findNumbers);
  return [];
}
