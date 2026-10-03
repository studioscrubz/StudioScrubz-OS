import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

function load(path, requireFn = () => ({})) {
  const output = ts.transpileModule(readFileSync(resolve(path), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  new Function("exports", "module", "require", output)(loadedModule.exports, loadedModule, requireFn);
  return loadedModule.exports;
}

const { publicAddonSelections } = load("lib/pricing/publicAddons.ts");
const pricing = load("lib/pricing/pricingEngine.ts");

const refrigerator = {
  id: "refrigerator",
  addon_name: "Inside Refrigerator",
  price: 35,
  pricing_model: "Flat Rate",
  pricing_config: {},
  description: null,
  unit_label: null,
};
const oven = {
  id: "oven",
  addon_name: "Inside Oven",
  price: 25,
  pricing_model: "Flat Rate",
  pricing_config: { pricing_type: "Flat Price" },
  description: null,
  unit_label: null,
};
const windows = {
  id: "windows",
  addon_name: "Exterior Windows",
  price: 8,
  pricing_model: "Per Unit",
  pricing_config: { pricing_type: "Per Unit", unit_name: "Window", unit_price: 8 },
  description: null,
  unit_label: "Window",
};
const catalog = [refrigerator, oven, windows];

function addonTotal(names, quantities) {
  const selections = publicAddonSelections(names, quantities, catalog);
  return pricing.calculateAddons(names, catalog, 0, selections)
    .reduce((sum, addon) => sum + addon.amount, 0);
}

assert.equal(addonTotal([]), 0, "zero selected add-ons preserve the base-only calculation");
assert.equal(addonTotal(["Inside Refrigerator"]), 35, "one flat add-on calculates");
assert.equal(addonTotal(["Inside Refrigerator", "Inside Oven"]), 60, "multiple add-ons calculate");
assert.equal(addonTotal(["Exterior Windows"], { "Exterior Windows": 3 }), 24, "per-unit quantities calculate");
assert.equal(addonTotal(["Exterior Windows"]), 8, "legacy public requests default a per-unit add-on to one");
assert.equal(addonTotal(["Inside Oven"]), 25, "removing another add-on recalculates from current selection");

const invalidPrice = { ...refrigerator, id: "invalid", addon_name: "Invalid", price: null };
assert.throws(
  () => publicAddonSelections(["Invalid"], undefined, [invalidPrice]),
  /Pricing is unavailable/,
  "missing pricing fails explicitly instead of producing NaN/null",
);
assert.throws(
  () => publicAddonSelections(["Exterior Windows"], { "Exterior Windows": 0 }, catalog),
  /whole-number quantity/,
);

const serviceSource = readFileSync(resolve("lib/services/publicEstimateRequests.ts"), "utf8");
assert.equal((serviceSource.match(/addonSelections,/g) ?? []).length, 2, "both public calculator divisions pass quantity snapshots");
assert.match(serviceSource, /publicAddonSelections\(input\.addons, input\.addonQuantities, availableAddons\)/);

const componentSource = readFileSync(resolve("components/estimates/PublicEstimateRequest.tsx"), "utf8");
assert.match(componentSource, /addons,addonQuantities,preferredDate/);
assert.match(componentSource, /pricingType===\"Per Unit\"/);

console.log("Public marketing calculator add-on regression tests passed.");
