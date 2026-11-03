import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const path = new URL("../lib/pricing/residentialCrew.ts", import.meta.url);
const transpiled = ts.transpileModule(readFileSync(path,"utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(transpiled,{ module, exports: module.exports });
const { recommendResidentialCrew } = module.exports;

test("real 2,683 sq ft three-bedroom three-bath job can use two cleaners for roughly eight total hours", () => {
  assert.equal(recommendResidentialCrew(8, 4.5), 2);
  assert.equal(recommendResidentialCrew(8.5, 4.5), 2);
  assert.equal(8.5 / recommendResidentialCrew(8.5,4.5),4.25);
  assert.equal(recommendResidentialCrew(8.5, 3), 3);
});

test("override changes staffing but never sets labor or customer prices", () => {
  assert.equal(recommendResidentialCrew(8.5,4.5,3), 3);
  assert.equal(recommendResidentialCrew(8.5,4.5,2), 2);
  assert.equal(recommendResidentialCrew(8.5,4.5,0), 2);
  assert.equal(recommendResidentialCrew(8.5,4.5,17),2);
  const source = readFileSync(new URL("../lib/pricing/estimates.ts", import.meta.url),"utf8");
  assert.match(source,/const crewSize = recommendResidentialCrew\(/);
  assert.match(source,/const laborCost = laborHours \* workerHourlyPay/);
  assert.doesNotMatch(readFileSync(path,"utf8"), /finalPrice|laborCost|supplyCost/);
});

test("pet hair severity is assessed separately and does not silently add an unvalidated price", () => {
  const ui=readFileSync(new URL("../components/estimates/EstimateBuilder.tsx",import.meta.url),"utf8");
  const types=readFileSync(new URL("../types/estimate.ts",import.meta.url),"utf8");
  assert.match(ui,/Pet-hair condition \(assessment only\)/);
  assert.match(ui,/\["None", "Normal", "Moderate", "Excessive"\]/);
  assert.match(types,/petHairSeverity\?: "None" \| "Normal" \| "Moderate" \| "Excessive"/);
  assert.match(ui,/no unverified extra charge is added/);
});
