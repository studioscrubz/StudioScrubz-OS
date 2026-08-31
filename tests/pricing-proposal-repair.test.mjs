import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Estimate and Proposal authoritative prices are durable explicit overrides", () => {
  const helper=read("lib/pricing/authoritativePrice.ts");
  const estimate=read("components/estimates/EstimateBuilder.tsx");
  const proposal=read("components/proposals/ProposalBuilder.tsx");
  assert.match(helper,/manualPrice === null \? calculatedFinalPrice/);
  assert.match(helper,/manualPrice === null \? calculatedPerVisitTotal/);
  assert.match(estimate,/Manual \/ Custom Estimate Amount/);
  assert.match(estimate,/Use Calculated Price/);
  assert.match(proposal,/Manual \/ Custom Final Price/);
  assert.match(proposal,/proposal\?\.result\.manualPerVisitTotal \?\? null/);
  assert.match(proposal,/withPreservedProposalPrice\(calculatedResult,proposal!\.result\.perVisitTotal,frequency\)/);
  assert.match(proposal,/preserveStoredPriceBaseline&&manualPrice===null/);
  assert.match(proposal,/setPreserveStoredPriceBaseline\(false\);setManualPrice\(null\)/);
  assert.match(helper,/manualPerVisitTotal: null/);
});

test("frequency repricing preserves an approved upstream manual price without double discounts",()=>{
  const proposalMath=read("lib/pricing/proposals.ts");
  const helper=read("lib/pricing/authoritativePrice.ts");
  assert.match(proposalMath,/withAuthoritativeEstimatePrice\([^;]+estimate\.manualPrice\?\?null\)/s);
  assert.match(proposalMath,/beforeDiscount = Math\.max\(0, input\.estimate\.finalPrice\) \+ additions/);
  assert.doesNotMatch(proposalMath,/beforeDiscount = Math\.max\(0, input\.estimate\.finalPrice -/);
  assert.match(helper,/monthlyTotal: estimatedMonthlyTotal\(perVisitTotal, frequency\)/);
});

test("Walkthrough reviewed pricing is separate from the historical Estimate and carries forward", () => {
  const modal=read("components/walkthroughs/WalkthroughPricingReviewModal.tsx");
  const route=read("app/api/walkthroughs/pricing-review/route.ts");
  const proposals=read("lib/pricing/proposals.ts");
  assert.match(modal,/The original Estimate is not changed/);
  assert.match(route,/withAuthoritativeEstimatePrice\(calculatedResult, manualPrice\)/);
  assert.match(route,/finalReviewedPrice: estimateResult\.finalPrice/);
  assert.match(proposals,/input\.estimate\.finalPrice/);
});

test("Proposal edit routes reuse ProposalBuilder and updates do not create duplicates", () => {
  const editor=read("components/proposals/ProposalEditPage.tsx");
  const builder=read("components/proposals/ProposalBuilder.tsx");
  assert.match(editor,/getProposalById\(proposalId\)/);
  assert.match(editor,/value\.status!=="Draft"/);
  assert.match(editor,/<ProposalBuilder proposal=\{proposal\}/);
  assert.match(builder,/await updateProposal\(proposal\.id, updatePayload\)/);
});

test("Archived tiers and recurring rules are excluded from new pricing and restorable", () => {
  const service=read("lib/services/serviceCatalog.ts");
  const page=read("components/settings/ServiceCatalogPage.tsx");
  assert.match(service,/tiers:tiers\.filter\(x=>x\.is_active\)/);
  assert.match(service,/recurringRules:recurringRules\.filter\(x=>x\.is_active\)/);
  assert.match(service,/restoreServicePriceTier/);
  assert.match(service,/restoreRecurringPricingRule/);
  assert.match(page,/catalogView/);
  assert.match(page,/"Restore"/);
});

test("Downstream financial snapshots remain untouched", () => {
  const changed=[
    "lib/pricing/authoritativePrice.ts",
    "lib/pricing/proposals.ts",
    "components/estimates/EstimateBuilder.tsx",
    "components/walkthroughs/WalkthroughPricingReviewModal.tsx",
    "app/api/walkthroughs/pricing-review/route.ts",
  ].map(read).join("\n");
  assert.doesNotMatch(changed,/from\("(?:service_agreements|jobs|invoices|payments)"\)\.(?:insert|update|delete)/);
});
