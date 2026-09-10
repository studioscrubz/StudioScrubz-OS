import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
const target = { exports: {} };
const code = ts.transpileModule(readFileSync(new URL("../lib/pricing/postConstruction.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInNewContext(code, { module: target, exports: target.exports });
const { calculatePostConstructionV2: calculate, calculatePostConstructionEstimate: legacy } = target.exports;
const input = { version: 2, calculatorType: "Post-Construction", totalSquareFeet: 4000, scope: ["Common areas"], estimatedPersonHours: 80, crewSize: 4, workerHourlyPay: 25, plannedProjectDays: 3, workdayHours: 8, suppliesCost: 100, equipmentRentalCost: 200, travelLogisticsCost: 50, disposalDebrisCost: 50, supervisionAdminCost: 100, contingencyCost: 100, desiredMarginPercent: 35 };
test("multi-day project costs and versioned results", () => {
  const r=calculate(input);
  assert.equal(r.version,2); assert.equal(r.totalLaborHours,80);
  assert.equal(r.laborCost,2000); assert.equal(r.nonLaborProjectCosts,600);
  assert.equal(r.totalEstimatedProjectCost,2600); assert.equal(r.recommendedProjectPrice,4000);
  assert.equal(r.approvedProjectPrice,4000); assert.equal(r.projectedGrossProfit,1400);
  assert.equal(r.projectedGrossMarginPercent,35);
  assert.equal(r.estimatedCompletionDays,2.5); assert.equal(r.plannedCrewCapacity,96);
  assert.ok(Math.abs(r.crewUtilizationPercent-83.3333333333)<0.000001);
  assert.notEqual(r.calculatorInput.scope,input.scope);
});
test("9351 sq ft uses total person-hours without charging crew size twice", () => {
  const r=calculate({...input,totalSquareFeet:9351,scope:["6 bedrooms","10 bathrooms"],estimatedPersonHours:180,crewSize:6,workdayHours:10,workerHourlyPay:40});
  assert.equal(r.laborCost,7200); assert.equal(r.estimatedCompletionDays,3);
  assert.equal(r.crewUtilizationPercent,100);
  const largerCrew=calculate({...r.calculatorInput,crewSize:12});
  assert.equal(largerCrew.laborCost,7200); assert.equal(largerCrew.estimatedCompletionDays,1.5);
  assert.equal(largerCrew.crewUtilizationPercent,50);
  assert.equal(calculate({...input,totalSquareFeet:9351}).laborCost,calculate(input).laborCost);
});
test("override controls profit and margin without replacing recommendation", () => {
  const r=calculate({...input,manualProjectPriceOverride:3250});
  assert.equal(r.recommendedProjectPrice,4000); assert.equal(r.approvedProjectPrice,3250);
  assert.equal(r.projectedGrossProfit,650); assert.equal(r.projectedGrossMarginPercent,20);
  assert.equal(calculate({...input,manualProjectPriceOverride:2000}).projectedGrossProfit,-600);
});
test("margin cap, workday compatibility, and invalid crew/hours/costs", () => {
  for(const margin of [-1,70.1,100,NaN,Infinity]) assert.throws(()=>calculate({...input,desiredMarginPercent:margin}));
  for(const margin of [0,70]) assert.doesNotThrow(()=>calculate({...input,desiredMarginPercent:margin}));
  for(const key of ["crewSize","estimatedPersonHours","plannedProjectDays","workdayHours"]) for(const value of [0,-1,NaN,Infinity]) assert.throws(()=>calculate({...input,[key]:value}));
  assert.throws(()=>calculate({...input,crewSize:1.5}));
  assert.throws(()=>calculate({...input,workdayHours:9}));
  for(const workdayHours of [8,10]) assert.doesNotThrow(()=>calculate({...input,workdayHours}));
  for(const key of ["totalSquareFeet","workerHourlyPay","suppliesCost","equipmentRentalCost","travelLogisticsCost","disposalDebrisCost","supervisionAdminCost","contingencyCost"]) for(const value of [-1,NaN,Infinity,undefined]) assert.throws(()=>calculate({...input,[key]:value}));
  for(const price of [0,-1,NaN,Infinity,null,0.001]) assert.throws(()=>calculate({...input,manualProjectPriceOverride:price}));
});
test("finite outputs, zero-cost guard, and explicit version required", () => {
  assert.throws(()=>calculate({...input,version:undefined}));
  assert.throws(()=>calculate({...input,version:1}));
  assert.throws(()=>calculate({...input,estimatedPersonHours:Number.MAX_VALUE}));
  assert.throws(()=>calculate({...input,plannedProjectDays:Number.MAX_VALUE}));
  const free={...input,workerHourlyPay:0,suppliesCost:0,equipmentRentalCost:0,travelLogisticsCost:0,disposalDebrisCost:0,supervisionAdminCost:0,contingencyCost:0};
  assert.throws(()=>calculate(free),/at least one cent/);
  assert.equal(calculate({...free,manualProjectPriceOverride:100}).projectedGrossMarginPercent,100);
  assert.ok(Object.entries(calculate(input)).filter(([,v])=>typeof v==="number").every(([,v])=>Number.isFinite(v)));
});
test("legacy 9351 sq ft calibration retains existing outputs and workday fallback", () => {
  const old={calculatorType:"Post-Construction",division:"Commercial",serviceType:"Post-Construction Cleaning",frequency:"One-Time",squareFeet:9351,floors:2,rooms:6,bathrooms:10,kitchens:2,condition:"Average",dustSeverity:"Average",debrisSeverity:"Average",detailLevel:"Detailed",windowsOrGlassCount:0,cabinetOrDrawerCount:0,applianceInteriorCount:0,stairFlights:0,targetProjectDays:3,workdayHours:10,workerHourlyPay:40,targetProfitMarginPercent:35,additionalDiscountPercent:0,taxRatePercent:0,additionalServices:[]};
  const r=legacy(old);
  assert.equal(r.laborHours,177.7); assert.equal(r.laborCost,7106.76);
  assert.equal(r.supplyCost,233.78); assert.equal(r.crewSize,6);
  assert.equal(legacy({...old,workdayHours:8}).crewSize,8);
  assert.equal(legacy({...old,workdayHours:9}).crewSize,8);
  assert.equal(legacy({...old,targetProfitMarginPercent:90}).finalPrice,legacy({...old,targetProfitMarginPercent:70}).finalPrice);
  assert.equal(r.calculatorInput.version,undefined);
});
