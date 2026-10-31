import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("Residential, Commercial, High Dusting and both Post-Construction modes use the same finance-only expense-then-price layout", () => {
  const builder = read("components/estimates/EstimateBuilder.tsx");
  const panel = read("components/estimates/ProfitabilityPanel.tsx");
  assert.match(builder, /projectPrice=\{result && !result\.weeklyMixedVisits\?\.length \?/);
  assert.match(builder, /title: postConstructionMode \? "Post-Construction Estimate Price" : "Estimate Price"/);
  assert.match(builder, /canApplyMinimum: !result\.upkeepPlan && result\.weeklyContractTotal == null/);
  assert.match(builder, /projectPrice\.manualPrice|manualPrice: v2Mode && isPostConstructionV2Estimate/);
  assert.match(builder, /profitabilityPriceEditorVisible=\{Boolean\(canViewProfitability && estimateProfitability\)\}/);
  assert.match(builder, /!mixed && !profitabilityPriceEditorVisible/);
  assert.match(builder, /if\(profile\?\.role==="Sales"\)return <SalesEstimateSummary/);
  const expenses = panel.indexOf("Internal expense assumptions (amounts for the quoted period)");
  const prices = panel.indexOf('projectPrice.title ?? "Post-Construction Estimate Price"');
  assert.ok(expenses >= 0 && prices > expenses);
  assert.match(panel, /Use Profitability Minimum/);
  assert.match(panel, /Use Original Calculated Bid/);
  assert.match(panel, /projectPrice\.onChange\(minimum\)/);
  assert.match(panel, /projectPrice\.onChange\(null\)/);
  assert.match(panel, /projectPrice\.canApplyMinimum === false/);
});

test("Porter and Luxury Property Care display monthly financial assumptions before authoritative monthly price controls", () => {
  const parent = read("components/properties/PorterServiceCalculator.tsx");
  const panel = read("components/properties/PorterProfitabilityPanel.tsx");
  const priceEngine = read("lib/pricing/porterService.ts");
  assert.match(parent, /financeAccess = canAccessFinances\(profile\)/);
  assert.match(parent, /!financeAccess \|\| key !== "manualMonthlyPriceOverride"/);
  assert.match(parent, /<PorterProfitabilityPanel pricing=\{result\} onPriceChange=\{next =>/);
  assert.match(parent, /manualMonthlyPriceOverride: next == null \? "" : String\(next\)/);
  const expenses = panel.indexOf("Additional monthly financial assumptions");
  const price = panel.indexOf("Property Service Estimate Price");
  assert.ok(expenses >= 0 && price > expenses);
  assert.match(panel, /Use Profitability Minimum/);
  assert.match(panel, /Use Original Calculated Bid/);
  assert.match(panel, /pricing\.inputs\.manualMonthlyPriceOverride/);
  assert.match(priceEngine, /approvedMonthlyPrice = money\(input\.manualMonthlyPriceOverride \?\? recommendedMonthlyPrice\)/);
  assert.match(parent, /calculatePorterService\(inputs, new Date\(\)\.toISOString\(\)\)/);
});

test("proposals share the internal layout with read-only inherited expenses and authoritative proposal price", () => {
  const proposals = read("components/proposals/ProposalBuilder.tsx");
  const panel = read("components/estimates/ProfitabilityPanel.tsx");
  assert.match(proposals, /canViewProfitability && proposalProfitability && <ProfitabilityPanel/);
  assert.match(proposals, /priceEditable/);
  assert.match(proposals, /title: "Proposal Price"/);
  assert.match(proposals, /artifactLabel: "proposal"/);
  assert.match(proposals, /canApplyMinimum: frequency === "One-Time" && result\.weeklyContractTotal == null && !result\.upkeepPlan/);
  assert.match(proposals, /setPreserveStoredPriceBaseline\(false\);\s*setManualPrice\(amount\)/);
  assert.match(proposals, /!mixedWeeklyMode && \(!canViewProfitability \|\| !proposalProfitability \|\| profile\?\.role === "Sales"\)/);
  assert.match(panel, /read-only here/);
  assert.match(panel, /Current customer \{projectPrice\.artifactLabel \?\? "estimate"\} amount/);
});
