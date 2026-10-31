import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function loadProfitability() {
  const source = readFileSync(new URL("../lib/pricing/profitability.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  const defaults = { version: 1, cleanerHourlyWage: 30, employerBurdenRate: .2, targetGrossMarginRate: .35, travelOrigin: "9110 De Soto Ave, Chatsworth, CA 91311", defaultVehiclesPerJob: 1, vehicleOperatingRatePerMile: 0, companyRequiredTravelIsCompensable: true };
  vm.runInNewContext(output, { module, exports: module.exports, require: (id) => {
    if (id === "@/types/profitability") return { defaultProfitabilitySettings: () => defaults };
    throw new Error(`Unexpected import ${id}`);
  } });
  return module.exports;
}

const { calculateProfitability, repriceProfitability, validateManualTravelOverride } = loadProfitability();
const settings = { version: 1, cleanerHourlyWage: 30, employerBurdenRate: .2, targetGrossMarginRate: .35, travelOrigin: "9110 De Soto Ave, Chatsworth, CA 91311", defaultVehiclesPerJob: 1, vehicleOperatingRatePerMile: 0, companyRequiredTravelIsCompensable: true };
const verifiedTravel = (employees = 3) => ({ origin: settings.travelOrigin, destination: "100 Main St, Chatsworth, CA 91311", verification: "Verified", provider: "Geoapify", roundTripMiles: 0, roundTripMinutes: 0, vehicleCount: 1, travelingEmployeeCount: employees, companyRequiredTravelIsCompensable: true, warning: null, calculatedAt: "2026-10-30T00:00:00.000Z" });

test("three cleaners, four hours, $30 wage and 20% burden produces the requested $502 direct cost and $772.31 minimum", () => {
  const result = calculateProfitability({ price: 500, cleanerCount: 3, hoursPerCleaner: 4, settings, travel: verifiedTravel(), otherDirectExpenses: 70 });
  assert.equal(result.estimatedLaborHours, 12);
  assert.equal(result.directCosts.loadedCleaningLabor, 432);
  assert.equal(result.totalEstimatedDirectCost, 502);
  assert.equal(result.grossMarginPercent, -0.4);
  assert.equal(result.recommendedMinimumPrice, 772.31);
  assert.equal(result.differenceToRecommendedMinimum, 272.31);
  assert.equal(result.belowTargetMargin, true);
});

test("one vehicle is shared by multiple cleaners while paid travel labor remains per employee", () => {
  const shared = calculateProfitability({ price: 1000, cleanerCount: 3, hoursPerCleaner: 1, settings: { ...settings, vehicleOperatingRatePerMile: .5 }, travel: { ...verifiedTravel(3), roundTripMiles: 10, roundTripMinutes: 60 } });
  const solo = calculateProfitability({ price: 1000, cleanerCount: 1, hoursPerCleaner: 1, settings: { ...settings, vehicleOperatingRatePerMile: .5 }, travel: { ...verifiedTravel(1), roundTripMiles: 10, roundTripMinutes: 60 } });
  assert.equal(shared.directCosts.vehicleOperating, 5);
  assert.equal(solo.directCosts.vehicleOperating, 5);
  assert.equal(shared.directCosts.compensableTravelLabor, 108);
  assert.equal(solo.directCosts.compensableTravelLabor, 36);
});

test("missing route evidence never silently becomes zero travel cost", () => {
  const result = calculateProfitability({ price: 800, cleanerCount: 1, hoursPerCleaner: 2, settings, travel: { ...verifiedTravel(1), verification: "Unverified", provider: null, roundTripMiles: null, roundTripMinutes: null, warning: "No provider", calculatedAt: null } });
  assert.equal(result.costComplete, false);
  assert.equal(result.totalEstimatedDirectCost, null);
  assert.equal(result.recommendedMinimumPrice, null);
});

test("repricing preserves the cost snapshot and only changes margin outputs", () => {
  const original = calculateProfitability({ price: 800, cleanerCount: 1, hoursPerCleaner: 2, settings, travel: verifiedTravel(1), otherDirectExpenses: 70 });
  const repriced = repriceProfitability(original, 500, "Weekly contract period");
  assert.equal(repriced.periodLabel, "Weekly contract period");
  assert.equal(repriced.totalEstimatedDirectCost, original.totalEstimatedDirectCost);
  assert.equal(repriced.price, 500);
});

test("calculator-specific wage overrides the configured default without changing payroll data", () => {
  const result = calculateProfitability({ price: 500, cleanerCount: 1, hoursPerCleaner: 2, hourlyWage: 42, settings, travel: verifiedTravel(1) });
  assert.equal(result.hourlyWage, 42);
  assert.equal(result.loadedHourlyLaborCost, 50.4);
});

test("proposal-like extra hours and materials increase direct cost without changing customer price", () => {
  const base = calculateProfitability({ price: 700, cleanerCount: 1, hoursPerCleaner: 2, settings, travel: verifiedTravel(1), supplies: 10 });
  const changed = calculateProfitability({ price: 700, cleanerCount: 1, hoursPerCleaner: 4, settings, travel: verifiedTravel(1), supplies: 35 });
  assert.ok(changed.totalEstimatedDirectCost > base.totalEstimatedDirectCost);
  assert.ok(changed.grossProfit < base.grossProfit);
});

test("legacy post-construction driving logistics suppress equivalent automatic travel costs", () => {
  const result = calculateProfitability({ price: 1000, cleanerCount: 2, hoursPerCleaner: 2, settings: { ...settings, vehicleOperatingRatePerMile: .5 }, travel: { ...verifiedTravel(2), roundTripMiles: 10, roundTripMinutes: 60 }, legacyTravelLogisticsCost: 75, legacyTravelIncludesDriving: true });
  assert.equal(result.directCosts.legacyTravelLogistics, 75);
  assert.equal(result.directCosts.vehicleOperating, 0);
  assert.equal(result.directCosts.compensableTravelLabor, 0);
});

test("manual travel requires complete finite nonnegative values and restricts zero travel", () => {
  assert.throws(() => validateManualTravelOverride({ ...verifiedTravel(), roundTripMiles: -1, roundTripMinutes: 10 }));
  assert.throws(() => validateManualTravelOverride({ ...verifiedTravel(), roundTripMiles: null, roundTripMinutes: 10 }));
  assert.throws(() => validateManualTravelOverride({ ...verifiedTravel(), roundTripMiles: 0, roundTripMinutes: 0 }));
  const zero = validateManualTravelOverride({ ...verifiedTravel(), origin: "same", destination: "same", roundTripMiles: 0, roundTripMinutes: 0 });
  assert.equal(zero.miles, 0);
  assert.equal(zero.minutes, 0);
});

test("route endpoint and migration keep provider use server-side, cached, and financially restricted", () => {
  const route = readFileSync(new URL("../app/api/profitability/travel/route.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/20261030090000_integrated_profitability_travel_costing.sql", import.meta.url), "utf8");
  assert.match(route, /hasPermission\(profile, "finances\.view"\)/);
  assert.match(route, /GEOAPIFY_API_KEY/);
  assert.match(route, /profitability_route_cache/);
  assert.match(route, /"Unverified"/);
  assert.doesNotMatch(route, /roundTripMiles:\s*0[;,]/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.profitability_settings/);
  assert.match(migration, /profitability_projections/);
  assert.match(migration, /get_profitability_projection/);
  assert.match(migration, /result = result - 'profitability'/);
  assert.match(migration, /reject_general_profitability_json/);
  assert.match(migration, /approved_pricing_snapshot->'result' \? 'profitability'/);
  assert.match(migration, /client_delivery_snapshot->'result' \? 'profitability'/);
  assert.match(migration, /revoke all on table public\.profitability_settings, public\.profitability_route_cache, public\.profitability_projections/);
  assert.match(migration, /has_any_role\(array\['Master Admin'\]\)/);
  assert.match(migration, /Only Master Admin may change profitability settings/);
  assert.match(migration, /set search_path = ''/);
});

test("profitability Geoapify requests match the supported JSON schema and coordinate order", () => {
  const route = readFileSync(new URL("../app/api/profitability/travel/route.ts", import.meta.url), "utf8");
  const porter = readFileSync(new URL("../app/api/porter-routes/optimize/route.ts", import.meta.url), "utf8");
  assert.match(porter, /url\.searchParams\.set\("format","json"\)/);
  assert.equal((route.match(/url\.searchParams\.set\("format", "json"\)/g) || []).length, 2);
  assert.match(route, /\x60\$\{origin\.latitude\},\$\{origin\.longitude\}\|\$\{target\.latitude\},\$\{target\.longitude\}\x60/);
  assert.doesNotMatch(route, /\x60\$\{origin\.longitude\},\$\{origin\.latitude\}/);
});

test("native PostgreSQL harness includes an external transaction rollback assertion", () => {
  const rollback = readFileSync(new URL("../supabase/tests/profitability_travel_rollback.sql", import.meta.url), "utf8");
  const fixture = readFileSync(new URL("../supabase/tests/profitability_travel_fixture.sql", import.meta.url), "utf8");
  const postgres = readFileSync(new URL("../supabase/tests/profitability_travel_postgres.sql", import.meta.url), "utf8");
  assert.match(rollback, /begin;/);
  assert.match(rollback, /rollback;/);
  assert.match(rollback, /External transaction rollback left profitability objects behind/);
  assert.match(fixture, /'Master Admin'/);
  assert.match(fixture, /'Scrubz Technician'/);
  assert.match(postgres, /Estimate nested snapshot injection/);
  assert.match(postgres, /Proposal nested customer snapshot injection/);
});

test("customer document mappers use explicit public fields and omit profitability", () => {
  const estimateDocument = readFileSync(new URL("../components/estimates/EstimateDocument.tsx", import.meta.url), "utf8");
  const proposalDocument = readFileSync(new URL("../components/proposals/ProposalDocument.tsx", import.meta.url), "utf8");
  assert.match(estimateDocument, /estimateDocumentFromRecord/);
  assert.match(proposalDocument, /proposalDocumentFromRecord/);
  assert.doesNotMatch(estimateDocument, /profitability/);
  assert.doesNotMatch(proposalDocument, /profitability/);
});
