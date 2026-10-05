import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const pricingRuleSource = readFileSync(new URL("../lib/pricing/workerHourlyPay.ts", import.meta.url), "utf8");
const target = { exports: {} };
const code = ts.transpileModule(pricingRuleSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(code, { module: target, exports: target.exports });

const { MINIMUM_WORKER_HOURLY_PAY, requireMinimumWorkerHourlyPay } = target.exports;

test("worker hourly pay rule accepts $30 and higher but rejects lower values", () => {
  assert.equal(MINIMUM_WORKER_HOURLY_PAY, 30);
  assert.equal(requireMinimumWorkerHourlyPay(30), 30);
  assert.equal(requireMinimumWorkerHourlyPay(45.5), 45.5);
  assert.throws(() => requireMinimumWorkerHourlyPay(29.99), /at least \$30\.00 per hour/);
  assert.throws(() => requireMinimumWorkerHourlyPay(Number.NaN), /at least \$30\.00 per hour/);
});

test("calculator defaults and reset state use the centralized $30 minimum", () => {
  const estimateBuilder = readFileSync(new URL("../components/estimates/EstimateBuilder.tsx", import.meta.url), "utf8");
  const walkthroughPricing = readFileSync(new URL("../lib/pricing/walkthroughPricing.ts", import.meta.url), "utf8");

  assert.match(estimateBuilder, /defaultCommercial:[\s\S]*?workerHourlyPay: MINIMUM_WORKER_HOURLY_PAY/);
  assert.match(estimateBuilder, /defaultPostConstruction:[\s\S]*?workerHourlyPay: MINIMUM_WORKER_HOURLY_PAY/);
  assert.match(estimateBuilder, /projectCosting:[\s\S]*?workerHourlyPay: MINIMUM_WORKER_HOURLY_PAY/);
  assert.match(walkthroughPricing, /workerHourlyPay: measurements\.workerHourlyPay \?\? MINIMUM_WORKER_HOURLY_PAY/);
});

test("calculator UI shows the minimum error and engines do not clamp entered pay", () => {
  const uiSources = [
    "../components/estimates/EstimateBuilder.tsx",
    "../components/estimates/PostConstructionCalculatorFields.tsx",
    "../components/walkthroughs/WalkthroughPricingReviewModal.tsx",
  ].map(path => readFileSync(new URL(path, import.meta.url), "utf8"));
  const postConstruction = readFileSync(new URL("../lib/pricing/postConstruction.ts", import.meta.url), "utf8");
  const estimates = readFileSync(new URL("../lib/pricing/estimates.ts", import.meta.url), "utf8");

  for (const source of uiSources) {
    assert.match(source, /MINIMUM_WORKER_HOURLY_PAY/);
    assert.match(source, /Minimum worker hourly pay is \$30\.00\/hour\./);
  }
  assert.match(postConstruction, /requireMinimumWorkerHourlyPay\(input\.workerHourlyPay\)/);
  assert.match(estimates, /requireMinimumWorkerHourlyPay\(input\.workerHourlyPay\)/);
  assert.doesNotMatch(postConstruction, /nonnegative\(input\.workerHourlyPay\)/);
  assert.doesNotMatch(estimates, /Math\.max\(0, input\.workerHourlyPay\)/);
});
