import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const source=readFileSync(resolve("lib/pricing/weeklyMixedVisits.ts"),"utf8");
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};
new Function("exports","module","require",compiled)(module.exports,module,()=>({}));
const {mixedVisitTotals,withMixedVisitEstimate}=module.exports;
const visits=[
  {day:2,serviceLevel:"Detailed cleaning",scope:"Kitchen, restrooms, floors and deep detail",hours:3.5,price:450},
  {day:3,serviceLevel:"Light maintenance",scope:"Touch points, trash and light floors",hours:2,price:150},
];
const totals=mixedVisitTotals(visits,[2,3],30);
assert.equal(totals.weeklyTotal,600);
assert.equal(totals.monthlyAverage,2600);
assert.equal(totals.averagePerVisit,300);
assert.equal(totals.weeklyHours,5.5);
assert.equal(totals.visitsPerMonth,2*52/12);
assert.throws(()=>mixedVisitTotals(visits,[2],30),/at least two/);
assert.throws(()=>mixedVisitTotals([visits[0],{...visits[1],day:2}],[2,3],30),/separate visit/);
assert.throws(()=>mixedVisitTotals([visits[0],{...visits[1],price:75}],[2,3],30),/25%/);
const input={division:"Commercial",frequency:"Multiple Days Per Week",serviceDaysOfWeek:[2,3],weeklyMixedVisits:visits,workerHourlyPay:30,additionalServices:[],addonSelections:[],additionalDiscountPercent:0,taxRatePercent:0};
const base={serviceName:"Office Cleaning",oneTimePrice:500,basePrice:500,finalPrice:440,recurringDiscount:60,recurringDiscountPercent:12,recurringPricingRuleId:"auto",recurringPricingRuleName:"Multi",manualDiscount:0,totalDiscount:60,taxes:0,laborHours:6,laborCost:180,supplyCost:20,scope:[],calculatorInput:input};
const updated=withMixedVisitEstimate(base,input);
assert.equal(updated.finalPrice,300);
assert.equal(updated.oneTimePrice,300);
assert.equal(updated.monthlyPrice,2600);
assert.equal(updated.weeklyContractTotal,600);
assert.equal(updated.recurringDiscount,0);
assert.equal(updated.recurringPricingRuleId,null);
assert.equal(updated.scope.length,2);
assert.match(updated.scope[0],/Tuesday — Detailed cleaning/);
assert.match(updated.scope[1],/Wednesday — Light maintenance/);
assert.equal(updated.weeklyMixedVisits[1].price,150);
const plain={...input,weeklyMixedVisits:undefined};
assert.equal(withMixedVisitEstimate(base,plain),base);
const get=(path)=>readFileSync(resolve(path),"utf8");
assert.match(get("components/estimates/EstimateBuilder.tsx"),/WeeklyMixedScopeCalculator/);
assert.match(get("components/estimates/EstimateDocument.tsx"),/weekly_contract_total/);
assert.match(get("components/proposals/ProposalDocument.tsx"),/weekly_mixed_visits/);
assert.match(get("components/agreements/AgreementsPage.tsx"),/mixed-scope weekday visits require Weekly Contract/i);
console.log("Mixed-scope StudioScrubz weekly pricing tests passed");
