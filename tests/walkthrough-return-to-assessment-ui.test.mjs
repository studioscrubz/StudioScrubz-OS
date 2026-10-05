import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(path, "utf8");

test("Return to Assessment uses the authenticated browser Supabase client", () => {
  const service = read("lib/services/fieldWalkthroughs.ts");
  const client = read("lib/supabase/client.ts");
  assert.match(service, /getSupabaseClient\(\)\.rpc\("return_walkthrough_pricing_to_assessment"/);
  assert.match(client, /createBrowserClient<Database>/);
  assert.doesNotMatch(service, /createServerClient|service_role|SUPABASE_SECRET/);
});

test("management review enables return only for Master Admin and Administrator", () => {
  const page = read("components/walkthroughs/WalkthroughsPage.tsx");
  const modal = read("components/walkthroughs/WalkthroughPricingReviewModal.tsx");
  assert.match(page, /\["Master Admin", "Administrator"\]\.includes\(profile\.role\)/);
  assert.doesNotMatch(page, /profile\.employee_id !== reviewing\.assigned_employee_id/);
  assert.doesNotMatch(page, /\["Master Admin", "Manager", "Crew Lead"\]/);
  assert.match(modal, /disabled=\{busy \|\| Boolean\(returnUnavailableReason\)\}/);
  assert.match(page, /restricted to Master Admin and Administrator pricing-review authority/);
});

test("RPC failures become safe actionable Error instances", () => {
  const service = read("lib/services/fieldWalkthroughs.ts");
  assert.match(service, /error\.code === "42501"/);
  assert.match(service, /Only an active Master Admin or Administrator/);
  assert.match(service, /error\.code === "23505"/);
  assert.match(service, /console\.error\("Return walkthrough pricing RPC failed", \{ code: error\.code \}\)/);
  const returnService = service.slice(service.indexOf("export async function returnWalkthroughPricingToAssessment"));
  assert.doesNotMatch(returnService, /throw error/);
});

test("forward migration grants management correction authority without execution inheritance", () => {
  const sql = read("supabase/migrations/20261005180000_return_walkthrough_pricing_management_authority.sql");
  assert.match(sql, /\(select auth\.uid\(\)\) is null/);
  assert.match(sql, /has_any_role\(array\['Master Admin', 'Administrator'\]\)/);
  for (const deniedRole of ["Manager", "Crew Lead", "Scrub Technician", "Sales", "Lead Representative"]) {
    assert.doesNotMatch(sql, new RegExp(`array\\[[^\\]]*'${deniedRole}'`));
  }
  assert.doesNotMatch(sql, /has_walkthrough_execution_role|current_employee_id|assigned_employee_id/);
  assert.match(sql, /walkthrough\.status <> 'Completed'/);
  assert.match(sql, /walkthrough\.archived_at is not null/);
  assert.match(sql, /walkthrough\.walkthrough_date is null/);
  assert.match(sql, /walkthrough\.walkthrough_time is null/);
  assert.match(sql, /proposal\.archived_at is null/);
  assert.match(sql, /set status = 'Scheduled',[\s\S]*sales_stage = 'Assessment In Progress'/);
  assert.doesNotMatch(sql, /measurements\s*=|scope\s*=|assigned_employee_id\s*=|insert into public\.proposals/);
  assert.match(sql, /security definer[\s\S]*set search_path = ''/);
  assert.match(sql, /revoke all on function[\s\S]*from public, anon, authenticated/);
  assert.match(sql, /grant execute on function[\s\S]*to authenticated/);
});

test("successful return still preserves the same walkthrough workflow", () => {
  const page = read("components/walkthroughs/WalkthroughsPage.tsx");
  assert.match(page, /await returnWalkthroughPricingToAssessment\(reviewing\.id\)/);
  assert.match(page, /assigned executor can continue corrections from Field Walkthroughs/);
  const callback = page.match(/returnToAssessment=\{async \(\) => \{[\s\S]*?\}\} \/>/)?.[0] ?? "";
  assert.doesNotMatch(callback, /setActive\(/);
  assert.doesNotMatch(page, /createProposal|Approve Pricing.*returnWalkthroughPricingToAssessment/s);
});
