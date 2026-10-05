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

test("management review does not offer assignment-scoped return to an ineligible profile", () => {
  const page = read("components/walkthroughs/WalkthroughsPage.tsx");
  const modal = read("components/walkthroughs/WalkthroughPricingReviewModal.tsx");
  assert.match(page, /profile\.employee_id !== reviewing\.assigned_employee_id/);
  assert.match(page, /\["Master Admin", "Manager", "Crew Lead"\]\.includes\(profile\.role\)/);
  assert.match(modal, /disabled=\{busy \|\| Boolean\(returnUnavailableReason\)\}/);
  assert.match(page, /restricted to the active employee assigned to execute this walkthrough/);
});

test("RPC failures become safe actionable Error instances", () => {
  const service = read("lib/services/fieldWalkthroughs.ts");
  assert.match(service, /error\.code === "42501"/);
  assert.match(service, /Only the active employee assigned to execute this walkthrough/);
  assert.match(service, /error\.code === "23505"/);
  assert.match(service, /console\.error\("Return walkthrough pricing RPC failed", \{ code: error\.code \}\)/);
  const returnService = service.slice(service.indexOf("export async function returnWalkthroughPricingToAssessment"));
  assert.doesNotMatch(returnService, /throw error/);
});

test("successful return still preserves the same walkthrough workflow", () => {
  const page = read("components/walkthroughs/WalkthroughsPage.tsx");
  assert.match(page, /const id = reviewing\.id/);
  assert.match(page, /await returnWalkthroughPricingToAssessment\(id\)/);
  assert.match(page, /setActive\(rows\.find\(\(item\) => item\.id === id\)/);
  assert.doesNotMatch(page, /createProposal|Approve Pricing.*returnWalkthroughPricingToAssessment/s);
});
