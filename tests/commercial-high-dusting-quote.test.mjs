import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
const read = p => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const migration = read("supabase/migrations/20261029180000_commercial_high_dusting_separate_quote.sql");
const calculator = read("lib/server/salesEstimatePricing.ts");
const builder = read("components/estimates/EstimateBuilder.tsx");

test("high dusting has a unique independently quoted catalog service and no invented rate", () => {
 assert.match(migration, /COM-HIGH-DUST/);
 assert.match(migration, /requires_separate_quote/);
 assert.match(migration, /on conflict \(service_code\) do nothing/);
 assert.match(migration, /0, 0, false, true/);
 assert.doesNotMatch(migration, /insert into public\.service_addons|insert into public\.service_addon_links/i);
});
test("high dusting uses normal estimate summary with calculated price", () => {
 assert.match(calculator, /service\.service_code === "COM-HIGH-DUST"/);
 assert.match(calculator, /input\.frequency !== "One-Time"/);
 assert.match(builder, /<HighDustingQuoteCalculator value=\{value\.highDusting/);
 assert.doesNotMatch(builder, /Separate High Dusting Quote Required/);
 assert.doesNotMatch(builder, /Assessed High Dusting Quote/);
 assert.doesNotMatch(builder, /Apply Separate Quote/);
});

test("incomplete high dusting form never reports a missing fixed catalog price", () => {
 assert.match(builder, /selectedService\?\.service_code === "COM-HIGH-DUST" \? "High Dusting estimate"/);
 assert.match(builder, /A preliminary estimate will calculate even if walkthrough height, access and scope details are pending/);
 assert.match(builder, /\{calculation.error && <div className="mb-4"><Alert kind="error" text=\{calculation.error\}/);
});

test("High Dusting calculator previews cost-based estimates and displays incomplete scope warnings", () => {
 const form = read("components/estimates/HighDustingQuoteCalculator.tsx");
 const engine = read("lib/pricing/highDusting.ts");
 const publicRequest = read("lib/services/publicEstimateRequests.ts");
 assert.match(form, /try \{ priceHighDusting\(value\); \}/);
 assert.doesNotMatch(form, /Preliminary High Dusting estimate/);
 assert.doesNotMatch(form, /High Dusting calculated estimate/);
 assert.doesNotMatch(form, /preview\.finalPrice\.toLocaleString/);
 assert.match(form, /pricingError && <p role="alert"/);
 assert.match(form, /Assessment pending:/);
 assert.doesNotMatch(form, /To generate your live Estimate Summary, enter square footage, working height/);
 assert.match(engine, /scopeConfirmed=Boolean/);
 assert.match(engine, /PRELIMINARY ESTIMATE/);
 assert.match(publicRequest, /Complete working height, access method and elevated surface scope before submitting a High Dusting request/);
});

test("High Dusting preliminary pricing produces a numeric quote without unused assessment fields", () => {
 const compiled = ts.transpileModule(read("lib/pricing/highDusting.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
 }).outputText;
 const target = { exports: {} };
 vm.runInNewContext(compiled, { module: target, exports: target.exports });
 const { priceHighDusting, defaultHighDustingInputs } = target.exports;
 const draft = { ...defaultHighDustingInputs, squareFeet: 1000 };
 const quote = priceHighDusting(draft);
 assert.equal(quote.finalPrice, 723.08);
 assert.equal(quote.laborCost, 300);
 assert.match(quote.description, /PRELIMINARY ESTIMATE/);
 assert.match(quote.description, /Not yet assessed/);
 const assessed = priceHighDusting({
  ...draft, workingHeight: "18 ft", scope: "Rafters and vents",
  accessMethods: ["Scissor lift"]
 });
 assert.equal(assessed.finalPrice, quote.finalPrice);
 assert.doesNotMatch(assessed.description, /PRELIMINARY ESTIMATE/);
 assert.throws(() => priceHighDusting({ ...draft, squareFeet: 0 }), /square footage/);
 assert.throws(() => priceHighDusting({ ...draft, targetMarginPercent: 60 }), /margin/);
 assert.throws(() => priceHighDusting({ ...draft, accessMethods: ["Unsafe equipment"] }), /access methods/);
});
