import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

function loadTypeScript(path, imports = {}) {
  const js = ts.transpileModule(readFileSync(resolve(path), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("exports", "module", "require", js)(module.exports, module, (name) => {
    if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
    return imports[name];
  });
  return module.exports;
}

const frequency = loadTypeScript("lib/scheduling/frequency.ts");
const engine = loadTypeScript("lib/pricing/pricingEngine.ts", {
  "@/lib/scheduling/frequency": frequency,
});
const rule = (id, freq, rate, service_id = null, is_active = true) => ({
  id, rule_name: freq, frequency: freq, adjustment_type: "Percentage",
  adjustment_value: rate, service_id, is_active,
});
const rules = [
  rule("weekly", "Weekly", 10),
  rule("biweekly", "Biweekly", 5),
  rule("daily", "Daily", 15),
  rule("multi", "Multiple Days Per Week", 12),
  rule("archived", "Monthly", 3, null, false),
  rule("special", "Weekly", 8, "specific-service"),
];
assert.equal(engine.serviceFrequencyDiscountLabel("Weekly", rules, "standard-service"), "Weekly — up to 10% off");
assert.equal(engine.serviceFrequencyDiscountLabel("Biweekly", rules, "standard-service"), "Bi-Weekly — Every 2 weeks (26 visits/year) — up to 5% off");
assert.equal(engine.serviceFrequencyDiscountLabel("Daily", rules, "standard-service"), "Daily — up to 15% off");
assert.equal(engine.serviceFrequencyDiscountLabel("Multiple Days Per Week", rules, "standard-service"), "Multiple Days Per Week — up to 12% off");
assert.equal(engine.serviceFrequencyDiscountLabel("Monthly", rules, "standard-service"), "Monthly");
assert.equal(engine.serviceFrequencyDiscountLabel("One-Time", rules, "standard-service"), "One-Time");
assert.equal(engine.serviceFrequencyDiscountLabel("Weekly", rules, "specific-service"), "Weekly — up to 8% off");

const weekly = engine.calculateRecurringTotals({
  subtotal: 200, frequency: "Weekly", rules, serviceId: "standard-service",
});
assert.equal(weekly.recurringDiscountPercent, 10);
assert.equal(weekly.recurringDiscountAmount, 20);
assert.equal(weekly.finalPrice, 180);

const multi = engine.calculateRecurringTotals({
  subtotal: 200, frequency: "Multiple Days Per Week",
  serviceDaysOfWeek: [1, 3, 5], rules, serviceId: "standard-service",
});
assert.equal(multi.recurringDiscountPercent, 12);
assert.equal(multi.recurringDiscountAmount, 24);
assert.equal(multi.finalPrice, 176);
assert.equal(multi.monthlyPrice, 2288);

const builder = readFileSync(resolve("components/estimates/EstimateBuilder.tsx"), "utf8");
assert.match(builder, /serviceFrequencyDiscountLabel/);
assert.match(builder, /Applied recurring savings/);
assert.match(builder, /frequencyLabelsForService/);
const quote = readFileSync(resolve("app/api/public/request-estimate/quote/route.ts"), "utf8");
assert.match(quote, /appliedRecurringDiscount:result.recurringDiscount/);
const publicBuilder = readFileSync(resolve("components/estimates/PublicEstimateRequest.tsx"), "utf8");
assert.match(publicBuilder, /Applied savings/);
console.log("Recurring discount visibility and pricing tests passed.");
