import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const builder = readFileSync(resolve("components/estimates/EstimateBuilder.tsx"), "utf8");
const estimates = readFileSync(resolve("lib/pricing/estimates.ts"), "utf8");
const postConstruction = readFileSync(resolve("lib/pricing/postConstruction.ts"), "utf8");

test("Estimate Builder detects Post-Construction from the Commercial catalog selection", () => {
  assert.match(builder, /isPostConstructionCatalogService\(selected\)/);
  assert.match(builder, /const postConstructionMode=isPostConstructionCatalogService\(selectedService\)\|\|historicalPostConstructionFallback/);
  assert.match(builder, /postConstructionMode\?calculatePostConstructionCatalogEstimate/);
  assert.match(estimates, /export function calculatePostConstructionCatalogEstimate/);
});

test("Post-Construction UI exposes the approved grouped fields and live breakdown", () => {
  for (const label of ["Project Scope","Site Condition","Specialty / Detail Work","Production Plan","Pricing","Square Feet","Rooms / Bedrooms","Bathrooms / Restrooms","Construction Dust","Construction Debris","Detail Level","Windows / Glass","Cabinets / Drawers","Appliance Interiors","Stair Flights","Target Completion Days","Workday Hours","Worker Hourly Cost","Target Profit Margin %"]) assert.match(readFileSync(resolve("components/estimates/PostConstructionCalculatorFields.tsx"), "utf8"), new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
  assert.match(readFileSync(resolve("components/estimates/PostConstructionBidSummary.tsx"), "utf8"), /Projected Margin/);
});

test("drafts preserve separate generic Commercial and Post-Construction state", () => {
  assert.match(builder, /postConstruction\?: PostConstructionCalculatorInput/);
  assert.match(builder, /setPostConstruction\(parsed\.postConstruction \?\? defaultPostConstruction\)/);
  assert.match(builder, /const draft: EstimateDraft = \{ version: 1, customer, division, residential, commercial, postConstruction/);
});

test("Post-Construction uses dedicated specialty quantities instead of catalog Add-Ons", () => {
  const fields = readFileSync(resolve("components/estimates/PostConstructionCalculatorFields.tsx"), "utf8");
  assert.doesNotMatch(fields, /CatalogAddonPicker/);
  assert.doesNotMatch(estimates, /const addonAdjustments=calculateAddons/);
  assert.match(estimates, /const oneTimePrice=core\.basePrice/);
  assert.match(estimates, /adjustments:\[\],catalogAddons:undefined/);
  for (const field of ["windowsOrGlassCount", "cabinetOrDrawerCount", "applianceInteriorCount", "stairFlights"]) assert.match(postConstruction, new RegExp(field));
});

test("existing Residential and generic Commercial calculators remain routed unchanged", () => {
  assert.match(builder, /calculateResidentialEstimate\(residential,catalog,defaults\?\.upkeep_adjustment_percent \?\? 30\)/);
  assert.match(builder, /calculateCommercialEstimate\(commercial,catalog\)/);
});

test("new Post-Construction estimates use the original automatic quote instead of an incomplete V2 form", () => {
  assert.match(builder, /isPostConstructionInput\(initialInput\) \? initialInput : defaultPostConstruction/);
  assert.match(builder, /postConstruction:\{\.\.\.defaultPostConstruction,taxRatePercent:0,additionalServices:\[\]\}/);
  assert.doesNotMatch(builder, /isPostConstructionInput\(initialInput\) \? initialInput : defaultPostConstructionV2/);
  assert.match(builder, /const incompleteProject = v2Mode/);
  assert.match(builder, /postConstructionMode\?calculatePostConstructionCatalogEstimate/);
});

test("Post-Construction retains both automatic scope pricing and explicitly selected detailed V2 costing", () => {
  const fields = readFileSync(resolve("components/estimates/PostConstructionCalculatorFields.tsx"), "utf8");
  assert.match(fields, /Post-Construction pricing method/);
  assert.match(fields, /Automatic estimate — square footage, condition and scope/);
  assert.match(fields, /Detailed project costing \(V2\)/);
  assert.match(fields, /if \(detailedMode\) return salesSafe/);
  assert.match(fields, /delete legacy\.version/);
  assert.match(fields, /delete legacy\.projectCosting/);
  assert.match(fields, /const oldProject = legacy\.projectCosting/);
  assert.match(fields, /<Group title="Project Scope">/);
  assert.match(fields, /<Group title="Site Condition">/);
  assert.match(fields, /<Group title="Specialty \/ Detail Work">/);
  assert.match(fields, /<ProjectCostFields value=\{value\.projectCosting\}/);
});

test("only the private profitability panel offers a disposal and debris input", () => {
  const fields = readFileSync(resolve("components/estimates/PostConstructionCalculatorFields.tsx"), "utf8");
  const profitability = readFileSync(resolve("components/estimates/ProfitabilityPanel.tsx"), "utf8");
  const builder = readFileSync(resolve("components/estimates/EstimateBuilder.tsx"), "utf8");
  assert.doesNotMatch(fields, /\["disposalDebrisCost",\s*"Disposal \/ debris"\]/);
  assert.match(profitability, /\["disposal", "Disposal and debris"\]/);
  // Preserve the historical V2 cost field and existing customer pricing, without changing old estimates.
  assert.match(builder, /postConstruction\.projectCosting\.disposalDebrisCost/);
});
