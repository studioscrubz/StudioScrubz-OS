import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const estimates = readFileSync("components/estimates/EstimateBuilder.tsx", "utf8");
const proposals = readFileSync("components/proposals/ProposalBuilder.tsx", "utf8");
const insights = readFileSync("components/estimates/CommercialLaborInsights.tsx", "utf8");
const engine = readFileSync("lib/pricing/estimates.ts", "utf8");

test("commercial labor explanation uses the same rate resolver as the estimator", () => {
  assert.match(engine, /export function productionRateForCondition\(/);
  assert.match(insights, /productionRateForCondition\(/);
  assert.match(insights, /input\.squareFeet \/ productionRate/);
  assert.match(insights, /laborHours \/ crewSize/);
  assert.match(insights, /Total planned labor/);
});

test("estimate and proposal planners display a shared internal labor explanation", () => {
  assert.match(estimates, /CommercialLaborInsights input=\{value\} service=\{service\} laborHours=\{result\.laborHours\} crewSize=\{result\.crewSize\}/);
  assert.match(proposals, /CommercialLaborInsights input=\{pricingEstimate\.calculatorInput\} service=\{catalogService\} laborHours=\{calculatedResult\.laborHours\} crewSize=\{calculatedResult\.crewRecommendation\}/);
  assert.match(estimates, /!salesSafe && result && service/);
  assert.match(proposals, /profile\?\.role!=="Sales"&&<Panel title="Labor Planning">/);
});

test("readout is explanatory only and does not alter customer prices", () => {
  assert.doesNotMatch(insights, /calculateRecurringTotals|setManualPrice|finalPrice|laborCost|estimatedProfit/);
  assert.match(insights, /Higher production rate means more square feet/);
  assert.match(insights, /These are planning estimates, not verified job times/);
});
