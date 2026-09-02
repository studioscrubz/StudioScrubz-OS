import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

function load(path, requireFn = () => ({})) {
  const output = ts.transpileModule(readFileSync(resolve(path), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loadedModule = { exports: {} };
  new Function("exports", "module", "require", output)(loadedModule.exports, loadedModule, requireFn);
  return loadedModule.exports;
}

const pricing = load("lib/pricing/pricingEngine.ts", (name) => name === "@/lib/scheduling/frequency" ? {} : {});
const flat = { id: "flat", addon_name: "Fridge", price: 35, pricing_model: "Flat Rate", pricing_config: {}, description: null, unit_label: null };
const perUnit = { id: "windows", addon_name: "Exterior Windows", price: 8, pricing_model: "Per Unit", pricing_config: { pricing_type: "Per Unit", unit_name: "Window", unit_price: 8 }, description: null, unit_label: "Window" };
assert.equal(pricing.calculateAddons(["Fridge"], [flat])[0].amount, 35);
const calculated = pricing.calculateAddons(["Exterior Windows"], [perUnit], 0, [{ catalogAddonId: "windows", quantity: 12 }]);
assert.deepEqual(calculated[0], { label: "Exterior Windows", amount: 96, catalogAddonId: "windows", description: null, pricingModel: "Per Unit", unitLabel: "Window", quantity: 12, unitName: "Window", unitPrice: 8 });
assert.equal(pricing.calculateAddons(["Exterior Windows"], [perUnit], 0, [{ catalogAddonId: "windows", quantity: 1 }])[0].amount, 8);
for (const quantity of [0, -1, 1.5, undefined]) assert.throws(() => pricing.calculateAddons(["Exterior Windows"], [perUnit], 0, [{ catalogAddonId: "windows", quantity }]), /whole-number quantity/);
const migration = readFileSync(resolve("supabase/migrations/20260901005000_addon_quantity_per_unit_pricing.sql"), "utf8");
assert.match(migration, /pricing_type', 'Flat Price'/);
assert.match(migration, /unit_name/);
assert.match(migration, /unit_price/);
console.log("Add-on quantity pricing tests passed.");
