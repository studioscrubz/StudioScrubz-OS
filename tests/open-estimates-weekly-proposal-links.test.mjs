import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

function code(path) { return readFileSync(resolve(path), "utf8"); }
const module = { exports: {} };
const js = ts.transpileModule(code("lib/estimates/estimatePriceDisplay.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
new Function("exports", "module", "require", js)(module.exports, module, () => { throw new Error("Unexpected runtime import"); });
const { estimatePriceDisplay, weekdayName } = module.exports;

const jenny = {
  finalPrice: 300,
  weeklyContractTotal: 600,
  weeklyMixedVisits: [
    { day: 2, price: 450, serviceLevel: "Deep Scrub", hours: 4, scope: "Detailed" },
    { day: 3, price: 150, serviceLevel: "Light Maintenance Scrub", hours: 2, scope: "Maintenance" },
  ],
};
const quote = estimatePriceDisplay(jenny);
assert.equal(quote.isWeeklyContract, true);
assert.equal(quote.amount, 600, "Show the contractual weekly total, never the $300 mean");
assert.deepEqual(quote.visits.map(v => v.price), [450, 150]);
assert.equal(weekdayName(quote.visits[0].day), "Tuesday");
assert.equal(weekdayName(quote.visits[1].day), "Wednesday");

assert.equal(estimatePriceDisplay({ ...jenny, weeklyContractTotal: undefined }).amount, 600, "Fallback to sum of separate day prices");
assert.deepEqual(estimatePriceDisplay({ finalPrice: 160, weeklyMixedVisits: undefined }), {
  amount: 160, label: "Final price", visits: [], isWeeklyContract: false,
});
assert.equal(estimatePriceDisplay({ finalPrice: 5584.62 }).amount, 5584.62);

const page = code("components/estimates/OpenEstimatesPage.tsx");
assert.match(page, /estimatePriceDisplay\(item\.result\)/);
assert.match(page, /currency\(price\.amount\)/);
assert.match(page, /weekdayName\(visit\.day\)/);
assert.match(page, /visibleEstimates=\{filtered\}/);
assert.match(page, /estimatePriceDisplay\(b\.result\)\.amount/);

const links = code("components/proposals/ProposalLinkSummary.tsx");
assert.match(links, /visibleIds\.has\(row\.estimate_id\)/);
assert.match(links, /Historical \/ archived revisions/);
assert.match(links, /proposalId=\$\{encodeURIComponent\(row\.id\)\}/);
assert.match(links, /row\.status/);
assert.match(links, /row\.revision_number/);
const service = code("lib/services/proposals.ts");
assert.match(service, /export async function getProposalLinks/);
assert.match(service, /is_current_revision,superseded_at,archived_at/);
const proposalPage = code("components/proposals/OpenProposalsPage.tsx");
assert.match(proposalPage, /search\)\.get\("proposalId"\)/);
assert.match(proposalPage, /getProposalById\(requestedProposalId\)/);
assert.match(proposalPage, /Historical \/ archived proposal — read-only/);
console.log("Open Estimates weekly contract pricing and contextual proposal links passed.");
