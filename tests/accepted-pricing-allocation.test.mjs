import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const source = readFileSync(resolve("lib/pricing/acceptedPricingAllocation.ts"), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const loadedModule = { exports: {} };
new Function("exports", "module", "require", output)(loadedModule.exports, loadedModule, () => ({}));
const { buildAcceptedPricingAllocation, validAcceptedPricingAllocation } = loadedModule.exports;

const windows = { id: "windows", label: "Exterior Windows", amount: 96, catalogAddonId: "windows", quantity: 12, unitName: "Window", unitPrice: 8 };
const calculated = buildAcceptedPricingAllocation({ perVisitTotal: 296, adjustments: [windows] });
assert.deepEqual(calculated, { version: 1, baseServiceAmount: 200, addons: [{ id: "windows", label: "Exterior Windows", pricingType: "Per Unit", quantity: 12, unitName: "Window", unitPrice: 8, lineTotal: 96 }], totalAmount: 296 });
const manual = buildAcceptedPricingAllocation({ perVisitTotal: 275, adjustments: [windows] });
assert.equal(manual.baseServiceAmount, 179);
assert.equal(manual.totalAmount, 275);
assert.throws(() => buildAcceptedPricingAllocation({ perVisitTotal: 80, adjustments: [windows] }), /cannot be less/);
assert.equal(validAcceptedPricingAllocation(manual, 275), true);
assert.equal(validAcceptedPricingAllocation(manual, 280), false);
assert.equal(validAcceptedPricingAllocation({ ...manual, addons: [{ ...manual.addons[0], unitPrice: 10 }] }, 275), false);
const proposals = readFileSync(resolve("lib/services/proposals.ts"), "utf8");
assert.match(proposals, /buildAcceptedPricingAllocation\(proposal\.result\)/);
const agreementPricing = readFileSync(resolve("lib/pricing/agreementPricing.ts"), "utf8");
assert.match(agreementPricing, /accepted_pricing_allocation:values\.acceptedPricingAllocation\?\?null/);
const agreements = readFileSync(resolve("lib/services/agreements.ts"), "utf8");
assert.match(agreements, /validAcceptedPricingAllocation\(p\.result\.acceptedPricingAllocation, billingAmount\)/);
console.log("Accepted pricing allocation tests passed.");
