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

test("one new Post-Construction calculator combines automatic scope pricing and detailed project-wide costs", () => {
  const fields = readFileSync(resolve("components/estimates/PostConstructionCalculatorFields.tsx"), "utf8");
  assert.doesNotMatch(fields, /Post-Construction pricing method/);
  assert.match(fields, /<Group title="Project Scope">/);
  assert.match(fields, /<Group title="Site Condition">/);
  assert.match(fields, /<Group title="Specialty \/ Detail Work">/);
  assert.match(fields, /<Group title="Production Plan">/);
  assert.match(fields, /Project Cost Details \(Full Project\)/);
  for (const label of [
    "Total person-hours (optional override)", "Crew size (optional override)",
    "Supplies (optional override)", "Equipment / rental (full project)",
    "Travel / logistics (additional project expense)",
    "Supervision / admin (full project)", "Contingency (full project)"
  ]) assert.ok(fields.includes(label), label);
  assert.match(fields, /Historical Detailed V2 estimate/);
  assert.match(fields, /<ProjectCostFields parent=\{value\}/);
  assert.match(estimates, /applyPostConstructionCostDetails\(calculatePostConstructionEstimate/);
  assert.match(builder, /postConstruction\.projectExpenses\?\.travelLogisticsCost/);
  assert.match(builder, /postConstruction\.projectExpenses\?\.equipmentRentalCost/);
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

test("restored V2 drafts with blank person-hours generate pricing and expose a scope-derived override", () => {
  const fields = readFileSync(resolve("components/estimates/PostConstructionCalculatorFields.tsx"), "utf8");
  const engine = readFileSync(resolve("lib/pricing/estimates.ts"), "utf8");
  assert.match(engine, /calculatePostConstructionV2\(resolvePostConstructionV2Hours\(input\)\)/);
  assert.match(fields, /calculatePostConstructionV2\(resolvePostConstructionV2Hours\(parent\)\)/);
  assert.match(fields, /Automatically estimated/);
  assert.match(fields, /Enter a nonzero total person-hours value above to override/);
  assert.doesNotMatch(fields, /if \(value\.estimatedPersonHours === 0\) return "Enter estimated total person-hours/);
  assert.match(fields, /if \(value\.estimatedPersonHours === 0 && \(!Number\.isFinite\(value\.totalSquareFeet\)/);
});

test("automatic job expense values are persisted with the estimate and priced without double counting", () => {
  const fields = readFileSync(resolve("components/estimates/PostConstructionCalculatorFields.tsx"), "utf8");
  assert.match(fields, /projectExpenses: \{ \.\.\.details, \[key\]: amount \}/);
  assert.match(builder, /const draft: EstimateDraft = \{ version: 1, customer, division, residential, commercial, postConstruction/);
  assert.match(estimates, /\.\.\.input,\s*serviceCode: resolved.service_code/);
  assert.match(estimates, /pricing.finalPrice - core.laborCost - core.supplyCost/);
  assert.match(estimates, /input.projectExpenses\?\.contingencyCost/);
});

test("sales-safe estimate payload strips new private project cost inputs", () => {
  const service = readFileSync(resolve("lib/services/estimates.ts"), "utf8");
  assert.match(service, /delete input\.projectExpenses/);
  assert.match(service, /delete input\.projectCosting/);
  assert.match(service, /delete input\.workerHourlyPay/);
  assert.match(service, /delete input\.targetProfitMarginPercent/);
  const fields = readFileSync(resolve("components/estimates/PostConstructionCalculatorFields.tsx"), "utf8");
  assert.match(fields, /\{!salesSafe && <UnifiedProjectCosts/);
});

test("Post-Construction manual price and minimum action appear only in finance-restricted Internal Profitability", () => {
  const summary = readFileSync(resolve("components/estimates/PostConstructionBidSummary.tsx"), "utf8");
  const panel = readFileSync(resolve("components/estimates/ProfitabilityPanel.tsx"), "utf8");
  const engine = readFileSync(resolve("lib/pricing/authoritativePrice.ts"), "utf8");
  assert.match(builder, /const estimateProfitability = canViewProfitability/);
  assert.match(builder, /projectPrice=\\{postConstructionMode && result \\?/);
  assert.match(builder, /manualPrice: v2Mode && isPostConstructionV2Estimate\\(postConstruction\\)/);
  assert.match(builder, /onChange: v2Mode/);
  assert.match(builder, /: setManualPrice/);
  assert.match(panel, /projectPrice && editable/);
  assert.match(panel, /Manual \/ Custom Estimate Amount/);
  assert.match(panel, /Use Profitability Minimum/);
  assert.match(panel, /Use Original Calculated Bid/);
  assert.match(panel, /projectPrice\.onChange\(minimum\)/);
  assert.match(panel, /projectPrice\.onChange\(null\)/);
  assert.match(panel, /projection\.recommendedMinimumPrice == null \|\| !Number\.isFinite\(projection\.recommendedMinimumPrice\)/);
  assert.match(panel, /Current customer estimate amount/);
  assert.doesNotMatch(summary, /Use Profitability Minimum/);
  assert.doesNotMatch(summary, /Use Recommended Bid/);
  assert.match(summary, /Final Estimate Amount/);
  assert.match(summary, /if\(profile\?\.role==="Sales"\)return/);
  assert.match(engine, /const finalPrice = manualPrice === null \? calculatedFinalPrice : money\(manualPrice\)/);
  assert.match(builder, /if \(estimateProfitability\) await saveProfitabilityProjection/);
});

test("Post-Construction summary profit and job cost include project expenses already in the quote", () => {
  const summary = readFileSync(resolve("components/estimates/PostConstructionBidSummary.tsx"), "utf8");
  assert.match(summary, /const additionalProjectCosts=/);
  assert.match(summary, /expenses\?\.equipmentRentalCost/);
  assert.match(summary, /expenses\?\.supervisionAdminCost/);
  assert.match(summary, /const jobCost=result\.laborCost\+result\.supplyCost\+additionalProjectCosts/);
  assert.match(summary, /const projectedProfit=finalAmount-jobCost/);
});

test("existing V2 Post-Construction estimates expose the same profitability override and persist using projectCosting", () => {
  const fields = readFileSync(resolve("components/estimates/PostConstructionCalculatorFields.tsx"), "utf8");
  const panel = readFileSync(resolve("components/estimates/ProfitabilityPanel.tsx"), "utf8");
  const engine = readFileSync(resolve("lib/pricing/estimates.ts"), "utf8");
  assert.match(builder, /projectPrice=\{postConstructionMode && result \?/);
  assert.match(builder, /postConstruction\.projectCosting\.manualProjectPriceOverride \?\? null/);
  assert.match(builder, /if \(!isPostConstructionV2Estimate\(previous\)\) return previous/);
  assert.match(builder, /if \(amount == null\) delete projectCosting\.manualProjectPriceOverride/);
  assert.match(builder, /else projectCosting\.manualProjectPriceOverride = amount/);
  assert.match(builder, /return \{ \.\.\.previous, projectCosting \}/);
  assert.match(builder, /calculatedPrice: result\.calculatedFinalPrice \?\? result\.finalPrice/);
  assert.match(panel, /Use Profitability Minimum/);
  assert.match(panel, /Use Original Calculated Bid/);
  assert.doesNotMatch(fields, /<Label text="Manual project price override \(optional\)"\/>/);
  assert.match(fields, /Adjust or restore the final project price under Internal Profitability/);
  assert.match(engine, /manualPrice: project\.calculatorInput\.manualProjectPriceOverride \?\? null/);
  assert.match(engine, /finalPrice: project\.approvedProjectPrice/);
});
