import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFileSync(resolve(path), "utf8");

function loadWalkthroughPricing() {
  const output = ts.transpileModule(read("lib/pricing/walkthroughPricing.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  const requireFn = (id) => {
    if (id === "@/lib/pricing/estimates") return { isPostConstructionV2Estimate: () => false };
    if (id === "@/lib/pricing/workerHourlyPay") return { MINIMUM_WORKER_HOURLY_PAY: 30 };
    if (id === "@/lib/services/serviceCatalog") return {
      findCatalogService: () => ({ pricing_config: {}, service_code: "RES-STANDARD" }),
      isPostConstructionCatalogService: () => false,
    };
    throw new Error(`Unexpected import: ${id}`);
  };
  new Function("exports", "module", "require", output)(loadedModule.exports, loadedModule, requireFn);
  return loadedModule.exports;
}

const baseWalkthrough = {
  division: "Residential",
  scope: [],
  pricing_review: null,
  measurements: {
    serviceType: "Standard Cleaning",
    frequency: "One-Time",
    overallCondition: "Average",
    squareFeet: 1200,
    bedrooms: 3,
    bathrooms: 2,
    occupied: true,
    pets: "No",
  },
  estimate: {
    frequency: "One-Time",
    service_name: "Standard Cleaning",
    result: {
      serviceName: "Standard Cleaning",
      catalogAddons: [{ id: "old", catalogAddonId: "old", name: "Old Add-On", price: 10 }],
      calculatorInput: { division: "Residential", condition: "Average" },
    },
  },
};

test("saved walkthrough add-on removals override preliminary Estimate add-ons", () => {
  const { mapWalkthroughToCalculatorInput } = loadWalkthroughPricing();
  const input = mapWalkthroughToCalculatorInput({
    ...baseWalkthrough,
    measurements: { ...baseWalkthrough.measurements, catalogAddons: [] },
  }, { services: [], tiers: [], addons: [], addonLinks: [], recurringRules: [] });
  assert.deepEqual(input.addOns, []);
  assert.deepEqual(input.addonSelections, []);
});

test("saved per-unit quantities hydrate into Review Pricing calculator input", () => {
  const { mapWalkthroughToCalculatorInput } = loadWalkthroughPricing();
  const windowSnapshot = { id: "windows", catalogAddonId: "windows", name: "Exterior Windows", price: 8, quantity: 12 };
  const input = mapWalkthroughToCalculatorInput({
    ...baseWalkthrough,
    measurements: { ...baseWalkthrough.measurements, catalogAddons: [windowSnapshot] },
  }, { services: [], tiers: [], addons: [], addonLinks: [], recurringRules: [] });
  assert.deepEqual(input.addOns, ["Exterior Windows"]);
  assert.equal(input.addonSelections[0].quantity, 12);
});

test("Review Pricing preserves quantities through client edits and server recalculation", () => {
  const modal = read("components/walkthroughs/WalkthroughPricingReviewModal.tsx");
  const route = read("app/api/walkthroughs/pricing-review/route.ts");
  assert.match(modal, /snapshots=\{value\.addonSelections\}/g);
  assert.match(modal, /setSnapshots=\{addonSelections=>set\(\{\.\.\.value,addonSelections\}\)\}/g);
  assert.match(route, /addonSelections: addonSelections\(row\.addonSelections\)/g);
  assert.match(route, /calculatorInput = withCanonicalAddonSelections\(calculatorInput, catalog, service\.id\)/);
  assert.match(route, /new Set\(selected\)\.size !== selected\.length/);
  assert.match(route, /quantity \* unitPrice/);
});

test("guided questionnaire answers have no undocumented direct pricing surcharge", () => {
  const mapper = read("lib/pricing/walkthroughPricing.ts");
  assert.doesNotMatch(mapper, /fieldWalkthrough|buildupLevel|laborLevel|serviceDuration/);
  assert.match(mapper, /measurements\.overallCondition/);
  assert.match(mapper, /measurements\.occupied/);
  assert.match(mapper, /measurements\.pets/);
});
