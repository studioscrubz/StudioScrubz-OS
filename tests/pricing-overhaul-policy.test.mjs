import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const estimates = readFileSync("lib/pricing/estimates.ts", "utf8");
const engine = readFileSync("lib/pricing/pricingEngine.ts", "utf8");

test("commercial margin protection uses pre-tax revenue and recomputes protected tax", () => {
  assert.match(estimates, /protectedPreTax = Math\.max\(discountedPreTax, minimumFinalPreTax\)/);
  assert.match(estimates, /protectedTaxes =[\s\S]*protectedPreTax \* Math\.max\(0, input\.taxRatePercent/);
  assert.match(estimates, /directCost \/ \(1 - NORMAL_MINIMUM_MARGIN_PERCENT \/ 100\)/);
});

test("custom quote tiers are not ordinary catalog prices", () => {
  assert.match(estimates, /tier\?\.pricing_config\.custom_quote === true[\s\S]*\? 0/);
  assert.match(engine, /tier\.pricing_config\.custom_quote === true[\s\S]*return null/);
});

test("commercial add-on selling floors are not treated as direct supply cost", () => {
  assert.match(estimates, /item\.pricing_config\.supply_cost \?\? 0/);
  assert.doesNotMatch(estimates, /item\.pricing_config\.supply_cost \?\?[\s\S]{0,100}item\.pricing_config\.minimum_price/);
});

test("Light condition cannot lower the customer recommendation", () => {
  assert.match(estimates, /Light: 1/);
  assert.match(estimates, /input\.condition === "Light"[\s\S]*productionRateForCondition\([\s\S]*"Average"/);
});

test("labor cost remains person-hours times pay without a crew-size multiplier", () => {
  assert.match(estimates, /const laborCost = laborHours \* workerHourlyPay/);
  assert.doesNotMatch(estimates, /laborHours \* crewSize \* workerHourlyPay|laborHours \* workerHourlyPay \* crewSize/);
});
