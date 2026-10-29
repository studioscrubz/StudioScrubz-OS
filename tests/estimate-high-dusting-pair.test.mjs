import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const sql=read("supabase/migrations/20261029193000_estimate_high_dusting_pairs.sql");
const estimate=read("components/estimates/EstimateBuilder.tsx");
const list=read("components/estimates/OpenEstimatesPage.tsx");
const pairs=read("lib/services/estimatePairs.ts");
const calculator=read("components/estimates/HighDustingQuoteCalculator.tsx");
test("only active commercial estimates from the same client and property can be linked",()=>{
 assert.match(sql,/e1.client_id = e2.client_id and e1.property_id = e2.property_id/);
 assert.match(sql,/e1.division='Commercial' and e2.division='Commercial'/);
 assert.match(sql,/e1.archived_at is null and e2.archived_at is null/);
 assert.match(sql,/High Dusting Cleaning/);
 assert.match(sql,/enable row level security/);
 assert.match(sql,/created_by = \(select auth.uid\(\)\)/);
 assert.doesNotMatch(sql,/^\s*(begin|commit|rollback)\s*;/gmi);
});
test("either estimate can initiate a second independent quote with an explicit link",()=>{
 assert.match(estimate,/Also quote high dusting/);
 assert.match(estimate,/Also quote commercial cleaning/);
 assert.match(estimate,/router.push\(`\/estimates\?pairWith=/);
 assert.match(estimate,/pairHighDustingEstimates\(pairWithEstimateId,created.id\)/);
 assert.match(estimate,/getEstimateById\(sourceId\)/);
 assert.match(list,/Linked High Dusting & Cleaning Estimates/);
 assert.match(list,/loadHighDustingPairs/);
 assert.match(pairs,/ignoreDuplicates:true/);
});
test("high dusting calculator is separate from combined janitorial price",()=>{
 assert.match(calculator,/hoursPerCleaner/);
 assert.match(calculator,/equipment/);
 assert.match(calculator,/supplies/);
 assert.match(calculator,/travelAndOverhead/);
 assert.match(calculator,/targetMarginPercent/);
 assert.match(calculator,/Apply Separate Quote/);
 assert.match(estimate,/onHighDustingQuote/);
});
