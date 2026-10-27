import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const builder = readFileSync("components/proposals/ProposalBuilder.tsx", "utf8");
const document = readFileSync("components/proposals/ProposalDocument.tsx", "utf8");
const resultType = readFileSync("types/proposal.ts", "utf8");
const publicType = readFileSync("types/publicProposal.ts", "utf8");

test("adjustment descriptions are proposal-specific and persist in the result JSON, without altering pricing", () => {
  assert.match(resultType, /finalPriceAdjustmentLabel\?: string \| null/);
  assert.match(builder, /setAdjustmentLabel/);
  assert.match(builder, /finalPriceAdjustmentLabel: adjustmentLabel\.trim\(\) \|\| null/);
  assert.match(builder, /Final Price Adjustment Label \(customer-facing\)/);
  assert.match(builder, /finalPriceAdjustmentLabel\?\.trim\(\) \|\| "Manual Final Price Adjustment"/);
});

test("customer preview, print, and delivery snapshots use selected description with generic fallback", () => {
  assert.match(publicType, /final_price_adjustment_label\?:string\|null/);
  assert.match(document, /document\.final_price_adjustment_label\?\.trim\(\)\|\|"Final Price Adjustment"/);
  assert.match(document, /final_price_adjustment_label:p\.result\.finalPriceAdjustmentLabel\?\?null/);
  assert.match(document, /final_price_adjustment_label:d\.final_price_adjustment_label/);
  assert.match(document, /value=\{finalPriceAdjustment\}/);
  assert.match(document, /value=\{document\.per_visit_total\}/);
  assert.doesNotMatch(document, /proposal_number==="PROP-20261005-8076-R2"/);
});
