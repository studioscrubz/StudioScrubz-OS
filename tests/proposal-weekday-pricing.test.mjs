import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("lib/pricing/proposalWeeklyVisits.ts", "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };
new Function("exports", "module", "require", js)(module.exports, module, require => { throw Error(`Unexpected runtime dependency ${require}`); });
const { recoverWeeklyVisitsFromScope, withProposalWeeklyVisitPrices } = module.exports;
const scope = [
  {id:"old-tue",text:"Tuesday — Deep Scrub, 4 hours, $350.00 per visit. Scope: Downstairs and kitchen"},
  {id:"old-wed",text:"Wednesday — Light Maintenance Scrub, 2 hours, $150.00 per visit. Scope: Downstairs only"},
  {id:"other",text:"Access provided by management"},
];

test("recovers existing distinct Tuesday and Wednesday prices from historical included services", () => {
  assert.deepEqual(recoverWeeklyVisitsFromScope(scope,[2,3]), [
    {day:2,serviceLevel:"Deep Scrub",hours:4,price:350,scope:"Downstairs and kitchen"},
    {day:3,serviceLevel:"Light Maintenance Scrub",hours:2,price:150,scope:"Downstairs only"},
  ]);
  assert.equal(recoverWeeklyVisitsFromScope(scope,[2,4]), null);
});

test("day rates are authoritative while weekly sum remains $500, not $500 per visit", () => {
  const visits = recoverWeeklyVisitsFromScope(scope,[2,3]);
  const base = {scope,serviceDaysOfWeek:[2,3],weeklyMixedVisits:undefined,weeklyContractTotal:undefined,perVisitTotal:500,estimatedProfit:300};
  const next = withProposalWeeklyVisitPrices(base,visits,[2,3]);
  assert.equal(next.weeklyContractTotal,500);
  assert.equal(next.perVisitTotal,250);
  assert.equal(next.manualPerVisitTotal,null);
  assert.equal(next.monthlyTotal,2166.67);
  assert.deepEqual(next.weeklyMixedVisits.map(x=>x.price),[350,150]);
  assert.equal(next.scope[2].text,scope[2].text);
  const changed = withProposalWeeklyVisitPrices(base,[{...visits[0],price:400},visits[1]],[2,3]);
  assert.equal(changed.weeklyContractTotal,550);
  assert.match(changed.scope[0].text,/\$400\.00 per visit/);
  assert.match(changed.scope[1].text,/\$150\.00 per visit/);
});

test("Proposal Builder exposes day-by-day editor and blocks uniform price changes", () => {
  const builder = readFileSync("components/proposals/ProposalBuilder.tsx","utf8");
  assert.match(builder,/WeeklyMixedScopeCalculator/);
  assert.match(builder,/Different service scope and price for each weekday/);
  assert.match(builder,/withProposalWeeklyVisitPrices/);
  assert.match(builder,/mixedVisitTotals\(weeklyMixedVisits/);
  assert.match(builder,/mixedWeeklyMode \? null : manualPrice/);
});
