import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
const read = p => fs.readFileSync(new URL("../"+p, import.meta.url),"utf8");

test("Employee Onboarding follows Background Screening in Team navigation",()=>{
 const s=read("components/layout/Sidebar.tsx");
 const i=s.indexOf('label: "Background Screening"');
 const j=s.indexOf('label: "Employee Onboarding"');
 assert.ok(i>0&&j>i&&j-i<250,"onboarding should follow screening directly");
});

test("New employee assignment requires both screening and approved onboarding",()=>{
 const sql=read("supabase/migrations/20261122190000_employee_onboarding.sql");
 assert.match(sql,/employee_screening_legacy_exemptions/);
 assert.match(sql,/status='cleared'/);
 assert.match(sql,/status='completed'/);
 assert.match(sql,/complete_employee_onboarding/);
 assert.match(sql,/revoke all on public\.employee_onboarding_cases from anon,authenticated/);
 assert.match(sql,/revoke all on function public\.complete_employee_onboarding.*anon,authenticated/);
});

test("Public candidate access requires expiring hashed token; no sensitive-document collection",()=>{
 const s=read("app/api/onboarding/invite/[token]/route.ts");
 const p=read("lib/supabase/proxy.ts");
 assert.match(s,/hashToken\(token\)/);
 assert.match(s,/invite_expires_at/);
 assert.match(p,/onboarding\/invite\//);
 const candidate=read("app/onboarding/invite/[token]/OrientationInvite.tsx");
 assert.doesNotMatch(candidate,/input[^>]+(?:ssn|social_security|bank_account|i9_upload)/i);
 assert.match(candidate,/Do not upload or email sensitive documents/);
});

test("Management endpoints require authorization and prohibit premature activation",()=>{
 const route=read("app/api/employees/onboarding/route.ts");
 const auth=read("lib/onboarding/server.ts");
 assert.match(route,/authorizedHiring\(\)/);
 assert.match(auth,/employee_screening_authorized_reviewers/);
 assert.match(route,/onboardingStepsComplete/);
 assert.match(route,/complete_employee_onboarding/);
 assert.match(route,/employment_status:"Inactive"/);
 assert.match(route,/background screening clearance/i);
});
