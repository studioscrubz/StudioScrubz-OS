import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const target = { exports: {} };
const code = ts.transpileModule(
  readFileSync(new URL("../lib/pricing/pricingEngine.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
vm.runInNewContext(code, {
  module: target,
  exports: target.exports,
  require: (id) => {
    if (id === "@/lib/scheduling/frequency") return { estimatedMonthlyTotal: (amount) => amount };
    throw new Error(`Unexpected runtime import: ${id}`);
  },
});

const { calculateRecurringTotals } = target.exports;
const percentageRule = (percent) => [{
  id: "frequency-rule",
  service_id: "service",
  frequency: "Weekly",
  is_active: true,
  display_order: 0,
  adjustment_type: "Percentage",
  adjustment_value: percent,
  rule_name: `${percent}%`,
}];
const price = (overrides = {}) => calculateRecurringTotals({
  subtotal: 400,
  baseServiceAmount: 350,
  addonTotal: 50,
  frequency: "One-Time",
  rules: [],
  serviceId: "service",
  ...overrides,
});

test("percentage discount applies to base service and add-ons remain full price", () => {
  assert.equal(price({ manualDiscountPercent: 25 }).finalPrice, 312.5);
});

test("recurring discount precedes the additional service discount", () => {
  const result = price({
    subtotal: 450,
    baseServiceAmount: 400,
    frequency: "Weekly",
    rules: percentageRule(10),
    recurringPricingRuleId: "frequency-rule",
    manualDiscountPercent: 5,
  });
  assert.equal(result.recurringDiscountAmount, 40);
  assert.equal(result.manualDiscount, 18);
  assert.equal(result.finalPrice, 392);
});

test("no discount and full discounts preserve purchased add-ons", () => {
  assert.equal(price({ subtotal: 275, baseServiceAmount: 200, addonTotal: 75 }).finalPrice, 275);
  assert.equal(price({ subtotal: 150, baseServiceAmount: 100, manualDiscountPercent: 100 }).finalPrice, 50);
  assert.equal(price({ subtotal: 150, baseServiceAmount: 100, manualDiscountAmount: 150 }).finalPrice, 50);
});

test("tax is calculated after service discounts and add-ons", () => {
  assert.equal(price({ manualDiscountPercent: 25, taxRatePercent: 10 }).taxes, 31.25);
  assert.equal(price({ manualDiscountPercent: 25, taxRatePercent: 10 }).finalPrice, 343.75);
  assert.equal(price({ manualDiscountPercent: 25, fixedTaxes: 7 }).finalPrice, 319.5);
});

test("legacy callers without an add-on split retain prior subtotal behavior", () => {
  assert.equal(calculateRecurringTotals({
    subtotal: 300,
    frequency: "One-Time",
    rules: [],
    serviceId: "service",
  }).finalPrice, 300);
});

test("a historical agreement snapshot remains authoritative at $300", () => {
  const agreementTarget = { exports: {} };
  const agreementCode = ts.transpileModule(
    readFileSync(new URL("../lib/pricing/agreementPricing.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  vm.runInNewContext(agreementCode, {
    module: agreementTarget,
    exports: agreementTarget.exports,
    require: (id) => {
      if (id === "@/lib/pricing/pricingEngine") return { calculateRecurringTotals };
      throw new Error(`Unexpected runtime import: ${id}`);
    },
  });
  const snapshot = {
    source: "Accepted Proposal",
    standard_service_price: 300,
    frequency: "One-Time",
    frequency_discount_label: "One-Time Service Discount",
    frequency_discount_percent: 0,
    frequency_discount_amount: 0,
    price_after_frequency_discount: 300,
    custom_discount_amount: 0,
    taxes: 0,
    final_per_visit_price: 300,
    estimated_monthly_total: null,
    captured_at: "2026-10-12T00:00:00.000Z",
    catalog_addons: [],
  };
  const result = agreementTarget.exports.agreementPricingWithAdditionalDiscount(snapshot, 0);
  assert.equal(result.final_per_visit_price, 300);
  assert.equal(result.standard_service_price, 300);
});
