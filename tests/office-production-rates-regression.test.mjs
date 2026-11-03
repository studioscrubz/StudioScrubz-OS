import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const estimates = readFileSync("lib/pricing/estimates.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/20261103113833_correct_office_janitorial_production_rates.sql",
  "utf8",
);

test("office production defaults are no longer based on 900 square feet per labor hour", () => {
  assert.match(estimates, /"light_production_rate"\) \|\| 3000/);
  assert.match(estimates, /"heavy_production_rate"\) \|\| 1400/);
  assert.match(estimates, /"average_production_rate"\)[\s\S]*?2200/);
  assert.match(estimates, /input\.squareFeet \/ productionRate/);
});

test("existing customized office production values are preserved by migration", () => {
  assert.match(migration, /WHERE service_code = 'COM-OFFICE'/);
  for (const [key, previous, replacement] of [
    ["production_rate", 900, 2200],
    ["average_production_rate", 900, 2200],
    ["light_production_rate", 1200, 3000],
    ["heavy_production_rate", 650, 1400],
  ]) {
    assert.match(migration, new RegExp(`pricing_config->>'${key}' = '${previous}'`));
    assert.match(migration, new RegExp(`to_jsonb\\(${replacement}\\)`));
    assert.match(migration, new RegExp(`ELSE COALESCE\\(pricing_config->'${key}'`));
  }
});

test("labor and recurring price keep the existing margin floor protection", () => {
  assert.match(estimates, /const laborCost = laborHours \* workerHourlyPay/);
  assert.match(estimates, /protectedPreTax = Math\.max\(discountedPreTax, minimumFinalPreTax\)/);
  assert.match(estimates, /const crewSize = Math\.max\([\s\S]*Math\.ceil\(laborHours \/ Math\.max\(1, availableHoursPerWorker\)\)/);
});
