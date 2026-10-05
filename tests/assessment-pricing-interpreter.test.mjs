import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function load() {
  const output = ts.transpileModule(readFileSync("lib/pricing/assessmentPricing.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("exports", "module", "require", output)(mod.exports, mod, () => { throw new Error("unexpected runtime import"); });
  return mod.exports;
}
const { interpretAssessmentPricing } = load();
const withAnswers = answers => ({ standardResidentialAssessment: { fieldWalkthrough: { answers } }, catalogAddons: [] });
const addon = { id: "a1", addon_name: "Window cleaning", description: "", price: 25, pricing_model: "Flat", unit_label: null, pricing_config: { pricing_type: "Flat Price" } };

test("informational answers do not affect pricing interpretation", () => {
  const result = interpretAssessmentPricing(withAnswers({ accessNotes: "Gate code", serviceSuitable: "Yes" }), [addon]);
  assert.equal(result.recommendedCondition, null);
  assert.deepEqual(result.suggestedAddons, []);
  assert.equal(result.laborPlan.minimumHours, null);
});

test("condition findings roll up once using severity and prevalence", () => {
  assert.notEqual(interpretAssessmentPricing(withAnswers({ kitchenCondition: "Severe", bathroomCondition: "Light", dustCondition: "Light" })).recommendedCondition, "Extreme");
  assert.equal(interpretAssessmentPricing(withAnswers({ kitchenCondition: "Severe", bathroomCondition: "Excessive", dustCondition: "Light" })).recommendedCondition, "Extreme");
  assert.equal(interpretAssessmentPricing(withAnswers({ overallCondition: "Moderate", kitchenCondition: "Heavy" })).recommendedCondition, "Average");
});

test("labor mapping uses only explicit duration and crew answers", () => {
  const result = interpretAssessmentPricing(withAnswers({ laborLevel: "Significantly above normal", recommendedCrew: "4+", serviceDuration: "6–8 hours" }));
  assert.deepEqual([result.laborPlan.minimumHours, result.laborPlan.maximumHours, result.laborPlan.minimumCrew, result.laborPlan.crewOpenEnded], [6, 8, 4, true]);
  assert.equal(interpretAssessmentPricing(withAnswers({ laborLevel: "Above normal" })).laborPlan.minimumHours, null);
});

test("catalog findings remain suggestions until explicitly confirmed", () => {
  const pending = interpretAssessmentPricing(withAnswers({ recommendedServices: ["Window cleaning"] }), [addon]);
  assert.equal(pending.suggestedAddons[0].disposition, "Pending");
  const included = interpretAssessmentPricing({ ...withAnswers({ recommendedServices: ["Window cleaning"] }), catalogAddons: [{ catalogAddonId: "a1", name: "Window cleaning", quantity: 3 }] }, [addon], pending);
  assert.equal(included.suggestedAddons[0].disposition, "Included");
});

test("return-to-assessment preserves draft data and never approves or creates a Proposal", () => {
  const sql = readFileSync("supabase/migrations/20261005170000_walkthrough_assessment_live_pricing_state.sql", "utf8");
  const fn = sql.match(/create function public\.return_walkthrough_pricing_to_assessment[\s\S]*?\$\$;/)?.[0] ?? "";
  assert.match(fn, /has_walkthrough_execution_role/);
  assert.match(fn, /assigned_employee_id is distinct from public\.current_employee_id/);
  assert.match(fn, /walkthrough\.status <> 'Completed'/);
  assert.match(fn, /active Proposal already exists/);
  assert.match(fn, /set status = 'Scheduled', sales_stage = 'Assessment In Progress'/);
  assert.doesNotMatch(fn, /insert into public\.proposals|pricing_review|measurements\s*=/);
});

test("forward migration preserves authorization and validates only narrow pricing state", () => {
  const sql = readFileSync("supabase/migrations/20261005170000_walkthrough_assessment_live_pricing_state.sql", "utf8");
  const submit = sql.match(/create function public\.submit_assigned_field_walkthrough\([\s\S]*?\$\$;/)?.[0] ?? "";
  assert.match(submit, /can_perform_scheduled_walkthrough\(p_id\)/);
  assert.match(submit, /submit_assigned_field_walkthrough_before_live_pricing_20261005\(p_id, legacy_measurements, p_complete\)/);
  assert.match(submit, /service\.service_name = walkthrough\.measurements->>'serviceType'/);
  assert.match(submit, /candidate\.is_active and candidate\.archived_at is null/);
  assert.match(submit, /Invalid or duplicate catalog add-on/);
  assert.match(submit, /positive whole number/);
  assert.match(submit, /pricing::text ~\* '\(price\|amount\|wage\|payroll\|margin\|percent\|discount\|cost\)'/);
  assert.match(submit, /Invalid condition evidence/);
  assert.match(submit, /Invalid labor plan/);
  assert.match(submit, /Invalid or unavailable add-on suggestion/);
  assert.match(submit, /jsonb_build_object\('catalogAddons', canonical_addons\)/);
  assert.match(submit, /jsonb_build_object\('assessmentPricing', pricing\)/);
  assert.doesNotMatch(submit, /insert into public\.proposals/);
});

test("UI returns to the same editable walkthrough and saves interpretations for legacy answers", () => {
  const modal = readFileSync("components/walkthroughs/WalkthroughPricingReviewModal.tsx", "utf8");
  const page = readFileSync("components/walkthroughs/WalkthroughsPage.tsx", "utf8");
  const field = readFileSync("components/walkthroughs/FieldWalkthroughsPage.tsx", "utf8");
  assert.match(modal, /Return to Assessment/);
  assert.match(page, /returnWalkthroughPricingToAssessment\(id\)/);
  assert.match(page, /setActive\(rows\.find\(\(item\) => item\.id === id\)/);
  assert.match(field, /currentInterpretation = interpretAssessmentPricing/);
  assert.match(field, /assessmentPricing: currentInterpretation/);
});
