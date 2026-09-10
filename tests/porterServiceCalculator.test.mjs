import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
const target = { exports: {} };
const code = ts.transpileModule(readFileSync(new URL("../lib/pricing/porterService.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInNewContext(code, { module: target, exports: target.exports, Date });
const { calculatePorterService: calculate } = target.exports;
const at = "2026-09-09T12:00:00.000Z";
const input = { laborHoursPerVisit: 2, visitsPerWeek: 5, porterHourlyPay: 20, billedHourlyRate: 45, suppliesMonthly: 0, travelMonthly: 0, supervisionAdminMonthly: 0, complexityAdjustmentMonthly: 0 };
test("2 hours x 5 visits x 4.33 produces a versioned deterministic snapshot", () => {
  const result = calculate(input, at);
  assert.equal(result.monthlyHours, 43.3);
  assert.equal(result.baseMonthlyPrice, 1948.5);
  assert.equal(result.recommendedMonthlyPrice, 1948.5);
  assert.equal(result.approvedMonthlyPrice, 1948.5);
  assert.equal(result.version, 1); assert.equal(result.calculatedAt, at);
  assert.notEqual(result.inputs, input);
  assert.deepEqual(result, calculate(input, at));
});
test("manual override changes approved price without replacing recommendation", () => {
  const result = calculate({ ...input, manualMonthlyPriceOverride: 1800 }, at);
  assert.equal(result.approvedMonthlyPrice, 1800);
  assert.equal(result.recommendedMonthlyPrice, 1948.5);
  assert.equal(result.projectedGrossProfit, 934);
  assert.equal(result.projectedGrossMarginPercent, 51.89);
});
test("all adjustments increase price; complexity is not an operating cost", () => {
  const result = calculate({ ...input, suppliesMonthly: 100, travelMonthly: 50, supervisionAdminMonthly: 75, complexityAdjustmentMonthly: 200 }, at);
  assert.equal(result.recommendedMonthlyPrice, 2373.5);
  assert.equal(result.monthlyOperatingCosts, 225);
  assert.equal(result.monthlyLaborCost, 866);
  assert.equal(result.projectedGrossProfit, 1282.5);
  assert.equal(result.projectedGrossMarginPercent, 54.03);
});
test("profit/margin support loss-making overrides and currency rounding", () => {
  const result = calculate({ ...input, manualMonthlyPriceOverride: 500 }, at);
  assert.equal(result.projectedGrossProfit, -366);
  assert.equal(result.projectedGrossMarginPercent, -73.2);
  assert.equal(calculate({ ...input, billedHourlyRate: 40.123 }, at).baseMonthlyPrice, 1737.33);
});
test("invalid, missing and nonfinite inputs fail", () => {
  for (const key of Object.keys(input)) {
    for (const value of [-1, NaN, Infinity, undefined]) assert.throws(() => calculate({ ...input, [key]: value }, at));
  }
  for (const key of ["laborHoursPerVisit", "visitsPerWeek", "billedHourlyRate"]) assert.throws(() => calculate({ ...input, [key]: 0 }, at));
  assert.throws(() => calculate({ ...input, visitsPerWeek: 8 }, at));
  for (const value of [0, -1, NaN, Infinity, null, 0.001]) assert.throws(() => calculate({ ...input, manualMonthlyPriceOverride: value }, at));
  assert.throws(() => calculate(input, "invalid"));
  assert.throws(() => calculate({ ...input, laborHoursPerVisit: Number.MAX_VALUE }, at));
  assert.doesNotThrow(() => calculate({ ...input, porterHourlyPay: 0, visitsPerWeek: 7 }, at));
});
test("migration preserves RPC security/version checks and supports omitted/null snapshots", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20260909233531_property_service_plan_pricing.sql", import.meta.url), "utf8");
  assert.match(sql, /add column pricing_snapshot jsonb/);
  assert.match(sql, /security definer set search_path = ''/);
  assert.match(sql, /auth.uid\(\) is null or not public.has_any_role\(array\['Master Admin','Administrator','Manager'\]\)/);
  assert.match(sql, /where id = p_id for update/);
  assert.match(sql, /p_expected_updated_at is distinct from v_old.updated_at/);
  assert.match(sql, /else v_old.pricing_snapshot end/);
  assert.match(sql, /nullif\(p_plan->'pricing_snapshot','null'::jsonb\)/);
  assert.match(sql, /pricing_snapshot=v_pricing/);
  assert.match(sql, /notes,pricing_snapshot\)/);
  assert.ok(sql.includes("<> trunc((v_pricing->'inputs'->>'visitsPerWeek')::numeric)"));
  const matchCheck = "if v_pricing is not null and (v_pricing->'inputs'->>'visitsPerWeek')::numeric <> cardinality(v_days) then";
  assert.ok(sql.includes(matchCheck));
  assert.ok(sql.indexOf(matchCheck) > sql.indexOf("into v_days from"));
  assert.ok(sql.includes("Porter pricing visits per week must match the selected service days."));
});
test("visits per week accepts only whole service-day counts from 1 through 7", () => {
  for (let days = 1; days <= 7; days++) assert.doesNotThrow(() => calculate({ ...input, visitsPerWeek: days }, at));
  for (const days of [0, 0.5, 1.5, 5.5, 7.1, 8]) assert.throws(() => calculate({ ...input, visitsPerWeek: days }, at));
});
