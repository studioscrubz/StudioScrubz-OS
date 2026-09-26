import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const builder = readFileSync(resolve("components/estimates/EstimateBuilder.tsx"), "utf8");

test("Post-Construction V2 recalculates its displayed and persisted total from current state", () => {
  assert.match(
    builder,
    /const calculation = \(\(\) => \{[\s\S]*calculatePostConstructionCatalogEstimate\(\{\.\.\.postConstruction,division\}/
  );
  assert.doesNotMatch(builder, /const calculation = useMemo/);
  assert.match(builder, /currency\(result\.finalPrice\)/);
  assert.match(builder, /estimatePayload\([^;]+result, notes, terms/);
});
