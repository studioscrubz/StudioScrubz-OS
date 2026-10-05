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
    if (id === "@/lib/pricing/pricingEngine") return { calculateRecurringTotals: ({ subtotal }) => ({ manualDiscount: 0, taxes: 0, finalPrice: subtotal, recurringDiscountAmount: 0, recurringDiscountPercent: 0, recurringPricingRuleId: null, recurringPricingRuleName: null }) };
    if (id === "@/lib/pricing/authoritativePrice") return { withAuthoritativeEstimatePrice: (value) => value };
    throw new Error(`Unexpected runtime import: ${id}`);
  },
});
const { calculateProposal } = target.exports;

const estimate = {
  finalPrice: 1000,
  laborHours: 18,
  crewSize: 3,
  laborCost: 540,
  supplyCost: 100,
  manualDiscount: 0,
  adjustments: [],
  calculatorInput: { frequency: "One-Time" },
};
const base = {
  estimate,
  recurringRules: [],
  serviceName: "Commercial Cleaning",
  serviceDescription: null,
  frequency: "One-Time",
  adjustments: [],
  additionalLabor: 0,
  additionalMaterials: 0,
  manualDiscountPercent: 0,
  scope: [],
  terms: {},
};

test("recommended and active labor plans are distinct and fractional total labor hours are supported", () => {
  const result = calculateProposal({ ...base, laborHoursOverride: 15.5, crewSizeOverride: 4 });
  assert.equal(result.recommendedLaborHours, 18);
  assert.equal(result.recommendedCrewSize, 3);
  assert.equal(result.laborHours, 15.5);
  assert.equal(result.crewRecommendation, 4);
  assert.equal(result.estimatedDuration, 3.9);
  assert.equal(result.laborHoursOverride, 15.5);
  assert.equal(result.crewSizeOverride, 4);
});

test("total crew labor hours change cost once and are never multiplied by crew size", () => {
  const result = calculateProposal({ ...base, laborHoursOverride: 15, crewSizeOverride: 3 });
  assert.equal(result.estimatedProfit, 450);
  assert.equal(result.estimatedDuration, 5);
  assert.equal(result.perVisitTotal, 1000);
});

test("crew and labor override validation rejects invalid planning values", () => {
  for (const crewSizeOverride of [0, -1, 1.5]) assert.throws(() => calculateProposal({ ...base, crewSizeOverride }), /positive whole number/);
  for (const laborHoursOverride of [0, -1, Number.NaN]) assert.throws(() => calculateProposal({ ...base, laborHoursOverride }), /greater than 0/);
  assert.doesNotThrow(() => calculateProposal({ ...base, crewSizeOverride: 1, laborHoursOverride: 0.5 }));
});

test("recommendation changes do not overwrite persisted manual overrides and reset follows recommendation", () => {
  const changedEstimate = { ...estimate, laborHours: 24, crewSize: 4, laborCost: 720 };
  const overridden = calculateProposal({ ...base, estimate: changedEstimate, laborHoursOverride: 15, crewSizeOverride: 2 });
  assert.equal(overridden.recommendedLaborHours, 24);
  assert.equal(overridden.recommendedCrewSize, 4);
  assert.equal(overridden.laborHours, 15);
  assert.equal(overridden.crewRecommendation, 2);
  const reset = calculateProposal({ ...base, estimate: changedEstimate, laborHoursOverride: null, crewSizeOverride: null });
  assert.equal(reset.laborHours, 24);
  assert.equal(reset.crewRecommendation, 4);
});

test("builder persists overrides in result JSON and downstream jobs consume active established fields", () => {
  const builder = readFileSync(new URL("../components/proposals/ProposalBuilder.tsx", import.meta.url), "utf8");
  const jobs = readFileSync(new URL("../supabase/migrations/20260905090000_add_job_scope_snapshots.sql", import.meta.url), "utf8");
  assert.match(builder, /proposal\?\.result\.laborHoursOverride \?\? null/);
  assert.match(builder, /proposal\?\.result\.crewSizeOverride \?\? null/);
  assert.match(builder, /Reset to Recommended/);
  assert.match(builder, /Labor Hours are total crew labor hours/);
  assert.match(jobs, /v_proposal\.result->>'laborHours'/);
  assert.match(jobs, /v_proposal\.result->>'crewRecommendation'/);
});
