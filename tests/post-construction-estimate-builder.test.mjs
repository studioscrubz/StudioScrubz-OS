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
