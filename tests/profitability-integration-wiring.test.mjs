import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("estimate builder integrates profitability without embedding protected costs in result JSON", () => {
  const source = read("components/estimates/EstimateBuilder.tsx");
  assert.match(source, /canAccessFinances\(profile\)/);
  assert.match(source, /calculateProfitability\(/);
  assert.match(source, /<ProfitabilityPanel/);
  assert.match(source, /saveProfitabilityProjection\(\{ estimateId: estimate\.id/);
  assert.match(source, /saveProfitabilityProjection\(\{ estimateId: created\.id/);
  assert.doesNotMatch(source, /result:\s*\{[^}]*profitability/);
  assert.match(source, /pairHighDustingEstimates/);
  assert.match(source, /HighDustingQuoteCalculator/);
});

test("business settings retains corporate capability and adds protected profitability editor", () => {
  const source = read("components/settings/BusinessSettingsPage.tsx");
  assert.match(source, /<CorporateCapabilitySettings\s*\/>/);
  assert.match(source, /<ProfitabilitySettingsEditor\s*\/>/);
  assert.match(source, /businessSettingsUpdate\(value\)/);
});

test("migration manifest and database types retain old and new features", () => {
  const manifest = read("docs/database-dependency-manifest.md");
  const types = read("types/database.ts");
  assert.match(manifest, /20261029090000_corporate_capability_profile/);
  assert.match(manifest, /20261030090000_integrated_profitability_travel_costing/);
  assert.match(types, /corporate_capability_profile/);
  assert.match(types, /profitability_projections/);
  assert.match(types, /save_profitability_projection/);
});
