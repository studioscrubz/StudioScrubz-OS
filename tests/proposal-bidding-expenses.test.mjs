import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const builder = readFileSync(new URL("../components/proposals/ProposalBuilder.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../components/estimates/ProfitabilityPanel.tsx", import.meta.url), "utf8");

test("proposal can revise restricted expense assumptions without modifying linked estimate", () => {
  assert.match(builder, /const \[proposalExpenseOverrides, setProposalExpenseOverrides\]/);
  assert.match(builder, /const \[proposalTravelOverride, setProposalTravelOverride\]/);
  assert.match(builder, /onAdjustmentsChange=\{setProposalExpenseOverrides\}/);
  assert.match(builder, /onTravelChange=\{setProposalTravelOverride\}/);
  assert.match(builder, /expenses\?\.salesCommissions \?\? source\.operatingCosts/);
  assert.match(builder, /expenses\?\.disposal \?\? source\.directCosts/);
  assert.match(builder, /saveProfitabilityProjection\(\{ proposalId: created\.id, projection: proposalProfitability \}\)/);
  assert.match(builder, /saveProfitabilityProjection\(\{ proposalId: proposal\.id, projection: proposalProfitability \}\)/);
  assert.doesNotMatch(builder, /result:\s*\{[^}]*proposalExpenseOverrides/);
});

test("shared profitability price card labels proposals properly", () => {
  assert.match(panel, /Manual \/ Custom Proposal Amount/);
  assert.match(panel, /projectPrice\.artifactLabel === "proposal"/);
  assert.match(builder, /artifactLabel: "proposal"/);
  assert.match(panel, /Internal expense assumptions \(amounts for the quoted period\)/);
});

test("high dusting proposal inherits and preserves the shared multi-select scope", () => {
  assert.match(builder, /import \{ ElevatedSurfaceMultiSelect \}/);
  assert.match(builder, /inheritedElevatedScope/);
  assert.match(builder, /id: "high-dusting-surfaces"/);
  assert.match(builder, /<ElevatedSurfaceMultiSelect/);
  assert.match(builder, /High Dusting Scope/);
});
