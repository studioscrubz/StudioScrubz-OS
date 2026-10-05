import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const target = { exports: {} };
const code = ts.transpileModule(readFileSync(new URL("../lib/pricing/proposals.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(code, {
  module: target,
  exports: target.exports,
  require: (id) => {
    if (id === "@/lib/scheduling/frequency") return { estimatedMonthlyTotal: (amount) => amount };
    if (id === "@/lib/pricing/pricingEngine") return { calculateRecurringTotals: ({ subtotal, manualDiscountPercent = 0 }) => {
      const recurringDiscountAmount = subtotal * 0.1;
      const manualDiscount = subtotal * manualDiscountPercent / 100;
      return { manualDiscount, taxes: 0, finalPrice: subtotal - recurringDiscountAmount - manualDiscount, recurringDiscountAmount, recurringDiscountPercent: 10, recurringPricingRuleId: "rule", recurringPricingRuleName: "10%" };
    } };
    if (id === "@/lib/pricing/authoritativePrice") return { withAuthoritativeEstimatePrice: (value) => value };
    throw new Error(`Unexpected runtime import: ${id}`);
  },
});
const { calculateProposal } = target.exports;

const estimate = (overrides = {}) => ({
  finalPrice: 639.27,
  oneTimePrice: 639.27,
  basePrice: 639.27,
  adjustments: [],
  laborHours: 10,
  crewSize: 2,
  laborCost: 300,
  supplyCost: 50,
  recurringDiscount: 0,
  recurringDiscountPercent: 0,
  manualDiscount: 0,
  taxes: 0,
  recurringPricingRuleId: null,
  recurringPricingRuleName: null,
  calculatorInput: { frequency: "One-Time" },
  ...overrides,
});
const input = (overrides = {}) => ({
  estimate: estimate(),
  recurringRules: [],
  serviceName: "Cleaning",
  serviceDescription: null,
  frequency: "One-Time",
  adjustments: [],
  additionalLabor: 0,
  additionalMaterials: 0,
  manualDiscountPercent: 0,
  scope: [],
  terms: {},
  ...overrides,
});
const addon = (id, amount, extra = {}) => ({ id, label: id, amount, catalogAddonId: id, ...extra });
const custom = (id, amount) => ({ id, label: id, amount });

function displayedTotal(result) {
  return Math.round((result.baseEstimateAmount
    + result.adjustments.reduce((sum, item) => sum + item.amount, 0)
    + result.additionalLabor + result.additionalMaterials
    - (result.frequencyDiscount ?? 0)
    - (result.inheritedManualDiscount ?? 0)
    - result.manualDiscount
    + result.taxes) * 100) / 100;
}

test("exact production reproduction reconciles 639.27 plus 80 plus 104 to 823.27", () => {
  const staleInherited = [addon("old-wall", 165), addon("old-window", 104)];
  const result = calculateProposal(input({
    estimate: estimate({ adjustments: staleInherited }),
    adjustments: [addon("Wall Washing", 80), addon("Interior Windows", 104, { quantity: 13, unitPrice: 8 })],
  }));
  assert.equal(result.baseEstimateAmount, 639.27);
  assert.equal(result.perVisitTotal, 823.27);
  assert.equal(displayedTotal(result), result.perVisitTotal);
});

test("zero, flat, multiple, custom, and proposal-only adjustments use one breakdown", () => {
  for (const adjustments of [
    [],
    [addon("flat", 80)],
    [addon("flat", 80), addon("windows", 104, { quantity: 13, unitPrice: 8 })],
    [custom("custom", 25)],
    [addon("new", 40)],
  ]) {
    const result = calculateProposal(input({ adjustments }));
    assert.equal(displayedTotal(result), result.perVisitTotal);
  }
});

test("inherited add-on is charged once and supports unchanged, changed, and removed quantity", () => {
  const inheritedEstimate = estimate({ finalPrice: 200, adjustments: [addon("windows", 8)] });
  assert.equal(calculateProposal(input({ estimate: inheritedEstimate, adjustments: [addon("windows", 8, { quantity: 1, unitPrice: 8 })] })).perVisitTotal, 208);
  assert.equal(calculateProposal(input({ estimate: inheritedEstimate, adjustments: [addon("windows", 64, { quantity: 8, unitPrice: 8 })] })).perVisitTotal, 264);
  assert.equal(calculateProposal(input({ estimate: inheritedEstimate, adjustments: [] })).perVisitTotal, 200);
});

test("inherited and Proposal discounts reconcile in displayed ordering", () => {
  const inherited = estimate({ finalPrice: 850, recurringDiscount: 100, recurringDiscountPercent: 10, manualDiscount: 50 });
  const result = calculateProposal(input({ estimate: inherited, adjustments: [addon("flat", 20)], manualDiscountPercent: 10 }));
  assert.equal(result.baseEstimateAmount, 1000);
  assert.equal(result.manualDiscount, 102);
  assert.equal(result.perVisitTotal, 768);
  assert.equal(displayedTotal(result), result.perVisitTotal);
});

test("catalog-only recurring pricing and saved JSON retain identical arithmetic", () => {
  const result = calculateProposal(input({ estimate: null, catalogBasePrice: 500, adjustments: [addon("flat", 50)], manualDiscountPercent: 5 }));
  assert.equal(result.perVisitTotal, 467.5);
  const reopened = JSON.parse(JSON.stringify(result));
  assert.equal(displayedTotal(reopened), reopened.perVisitTotal);
  assert.equal(JSON.stringify(reopened), JSON.stringify(result));
});

test("UI summary consumes result breakdown and does not preserve an unreconciled stored total", () => {
  const source = readFileSync(new URL("../components/proposals/ProposalBuilder.tsx", import.meta.url), "utf8");
  assert.match(source, /Base Service Price["'], money\(r\.baseEstimateAmount\)/);
  assert.match(source, /Math\.round\(proposal\.result\.perVisitTotal \* 100\)[\s\S]*Math\.round\(calculatedResult\.perVisitTotal \* 100\)/);
  assert.match(source, /Manual Final Price Adjustment/);
});
