import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const service=readFileSync(new URL("../lib/services/timeEntries.ts",import.meta.url),"utf8");
const view=readFileSync(new URL("../components/time/JobLaborSummary.tsx",import.meta.url),"utf8");
const types=readFileSync(new URL("../types/timeEntry.ts",import.meta.url),"utf8");

test("job performance uses saved budget or linked proposal/estimate, never an invented zero",()=>{
  assert.match(service,/originalBudget>0\?originalBudget:null/);
  assert.match(service,/laborEstimateSource="Proposal"/);
  assert.match(service,/laborEstimateSource="Estimate"/);
  assert.match(view,/estimated === null \? "Unavailable"/);
  assert.match(view,/variance === null \? "Unavailable"/);
});
test("financial reconciliation excludes voided payments, includes job direct payments and dedupes invoice links",()=>{
  assert.match(service,/\.is\("voided_at",null\)/);
  assert.match(service,/\.eq\("job_id",jobId\)\.is\("voided_at",null\)/);
  assert.match(service,/new Map<string,number>\(\)/);
  assert.match(service,/collectedRevenue-expenseTotal-labor.actualLaborCost/);
  assert.match(view,/Not net profit or verified gross margin/);
});
test("data-quality warnings and gross-pay protections prevent displaying missing entries as profit",()=>{
  assert.match(view,/laborRecordsMissing/);
  assert.match(view,/paymentsReconciled/);
  assert.match(view,/outstandingBalance/);
  assert.match(view,/hasTime \? money\(data.grossProfit\) : "Unavailable"/);
  assert.match(types,/estimatedLaborHours:number\|null/);
});
