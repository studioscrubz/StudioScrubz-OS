import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

function loadTypeScriptModule(path) {
  const output = ts.transpileModule(readFileSync(resolve(path), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("exports", "module", "require", output)(loaded.exports, loaded, () => ({}));
  return loaded.exports;
}

const scope = loadTypeScriptModule("lib/postConstructionScope.ts");
const sharedFields = readFileSync(resolve("components/walkthroughs/PostConstructionScopeFields.tsx"), "utf8");
const assessment = readFileSync(resolve("components/walkthroughs/PostConstructionAssessmentFields.tsx"), "utf8");
const field = readFileSync(resolve("components/walkthroughs/PostConstructionFieldWalkthrough.tsx"), "utf8");
const pricing = readFileSync(resolve("lib/pricing/walkthroughPricing.ts"), "utf8");
const proposal = readFileSync(resolve("components/proposals/ProposalBuilder.tsx"), "utf8");

test("legacy comma-separated post-construction scope round-trips without losing custom entries", () => {
  assert.deepEqual(
    scope.normalizePostConstructionScopeAreas("Kitchen, Bedrooms, Living room, Rooftop deck"),
    ["Kitchen", "Bedrooms", "Living Room / Great Room", "Rooftop deck"],
  );
  assert.deepEqual(scope.normalizePostConstructionScopeAreas(["Bathrooms, Offices", "Other"]), ["Bathrooms", "Office / Study", "Other"]);
});

test("management and field walkthroughs reuse one scope control and persist quantities, custom scope, and exclusions", () => {
  for (const label of ["Rooms / Areas in Scope", "Bedroom Quantity", "Bathroom Quantity", "Other Area in Scope", "Areas Excluded From Scope"]) {
    assert.ok(sharedFields.includes(label), label);
  }
  assert.match(assessment, /<PostConstructionScopeFields/);
  assert.match(assessment, /onBedroomsChange=\{bedrooms=>set\(\{\.\.\.value,bedrooms\}\)\}/);
  assert.match(field, /<PostConstructionScopeFields/);
  assert.match(field, /Object\.hasOwn\(patch, "bedrooms"\)/);
  assert.match(field, /answerFor\(f, s\)/);
  assert.match(field, /field\.answers\?\.includedAreas/);
});

test("scope consistency does not alter pricing formulas or proposal handoff", () => {
  assert.match(pricing, /rooms: measurements\.bedrooms \?\? previous\.rooms/);
  assert.match(pricing, /bathrooms: measurements\.bathrooms \?\? previous\.bathrooms/);
  assert.match(pricing, /scope: walkthrough\.scope\.map\(item => item\.label\)/);
  assert.match(proposal, /pricing_review\?\.estimateResult/);
  assert.doesNotMatch(sharedFields, /price|margin|laborCost|tax/i);
});
