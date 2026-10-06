import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration=fs.readFileSync("supabase/migrations/20261006191000_performance_review_workflow_coaching_phase_5.sql","utf8");
const scoring=fs.readFileSync("supabase/migrations/20261006190000_employee_performance_scoring_engine_v1.sql","utf8");
const service=fs.readFileSync("lib/services/employeePerformance.ts","utf8");
const workflow=fs.readFileSync("components/jobs/EmployeePerformanceWorkflow.tsx","utf8");
const reviews=fs.readFileSync("components/jobs/EmployeePerformanceReviews.tsx","utf8");

test("72-hour target is deterministic and never auto-finalizes",()=>{
  assert.match(migration,/calculated_at \+ interval '72 hours'/);
  assert.match(migration,/when r\.status='Finalized' then 'Finalized' when now\(\)>r\.review_due_at then 'Review Overdue' else 'Review Pending'/);
  assert.doesNotMatch(migration,/update public\.employee_performance_reviews[\s\S]{0,200}review_due_at/);
  assert.match(reviews,/The review remains Draft until management finalizes it/);
});

test("finalized reviews remain immutable and revisions are additive",()=>{
  assert.match(scoring,/Finalized performance reviews are immutable/);
  assert.match(scoring,/coalesce\(max\(r\.revision\),0\)\+1/);
  assert.match(migration,/references public\.employee_performance_reviews\(id\) on delete restrict/);
});

test("review receipt is own-finalized, append-only, and dispute-comment protected",()=>{
  assert.match(migration,/response in \('Acknowledged','Disputed'\)/);
  assert.match(migration,/response='Acknowledged' or nullif\(btrim\(employee_comment\),''\) is not null/);
  assert.match(migration,/status='Finalized'/);
  assert.match(migration,/r\.employee_id<>employee/);
  assert.match(migration,/review_id uuid not null unique/);
  assert.doesNotMatch(migration,/update public\.employee_performance_review_responses/);
  assert.match(workflow,/Receipt only; not agreement, admission, or waiver/);
});

test("history uses finalized reviews and never fabricates missing scores",()=>{
  assert.match(workflow,/const finalized=data\.reviews\.filter\(x=>x\.status==="Finalized"\)/);
  assert.match(workflow,/v\.length\?.*:"Insufficient Evidence"/);
  assert.match(workflow,/review_period_days===30/);
  assert.match(workflow,/review_period_days===90/);
  assert.match(workflow,/Year to Date/);
  assert.match(workflow,/Lifetime/);
});

test("trend is deterministic, self-only, and ignores insufficient components",()=>{
  assert.match(service,/measured\.length<2.*"Insufficient Evidence"/);
  assert.match(service,/delta>=2\?"Improving".*delta<=-2\?"Declining".*"Stable"/);
  assert.match(workflow,/evidenceState==="Measured"\?r\.component_scores\[key\]\.points:null/);
  assert.doesNotMatch(workflow,/leaderboard|percentile|ranking/i);
});

test("locked performance bands and independent quality gate are visible",()=>{
  assert.match(service,/score>=90\?"Excellent":score>=80\?"Strong":score>=70\?"Needs Attention":"Performance Review Required"/);
  assert.match(workflow,/Quality Review Required/);
  assert.match(workflow,/performanceBand\(r\.overall_score\)/);
});

test("coaching and PIP require explicit management action and context",()=>{
  assert.match(migration,/has_any_role\(array\['Master Admin','Administrator','Manager'\]\)/);
  assert.match(migration,/summary text not null check\(length\(btrim\(summary\)\) between 3 and 2000\)/);
  assert.match(migration,/expectations text not null check\(length\(btrim\(expectations\)\) between 3 and 2000\)/);
  assert.match(migration,/evidence_context text not null check\(length\(btrim\(evidence_context\)\) between 3 and 2000\)/);
  assert.match(migration,/coaching_type<>'Performance Improvement Plan' or target_review_date is not null/);
  assert.match(workflow,/Explicit Management Action/);
  assert.match(workflow,/Create PIP/);
  assert.match(workflow,/Create Coaching Record/);
  assert.doesNotMatch(migration,/trigger[\s\S]{0,160}create_employee_coaching_record/i);
});

test("coaching responses preserve original management evidence",()=>{
  assert.match(migration,/response in \('Acknowledged','Disputed'\)/);
  assert.match(migration,/c\.employee_id<>employee/);
  assert.match(migration,/coaching_id uuid not null unique/);
  assert.doesNotMatch(migration,/update public\.employee_coaching_records[\s\S]{0,120}p_response/);
  assert.match(migration,/insert into public\.employee_coaching_responses/);
});

test("workflow introduces no payroll, employee-status, job-status, or assignment side effects",()=>{
  assert.doesNotMatch(migration,/update public\.(employees|jobs|time_entries|job_crew_assignments)/i);
  assert.doesNotMatch(migration,/\b(wage|payroll|overtime|compensation)\b/i);
});
