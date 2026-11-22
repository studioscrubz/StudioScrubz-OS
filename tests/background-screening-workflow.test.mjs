import assert from "node:assert/strict";
import test from "node:test";
import {
  canTransitionScreening,
  isNewW2HireScreeningCleared,
  requiresNewHireScreeningGate,
} from "../lib/backgroundScreening/workflow.mjs";

test("screening cannot be initiated without a conditional offer and consent", () => {
  assert.equal(canTransitionScreening("not_started", "invited", {}), false);
  assert.equal(canTransitionScreening("authorized", "invited", {}), false);
  assert.equal(canTransitionScreening("authorization_pending", "authorized", {writtenAuthorizationRecorded:true}), true);
});

test("no automatic rejection or clearance", () => {
  assert.equal(canTransitionScreening("completed_review_pending", "final_adverse_decision"), false);
  assert.equal(canTransitionScreening("completed_review_pending", "cleared"), false);
  assert.equal(canTransitionScreening("completed_review_pending", "cleared", {humanReviewerApproved:true}), true);
  assert.equal(canTransitionScreening("individualized_review", "pre_adverse_action"), false);
  assert.equal(canTransitionScreening("response_pending", "final_adverse_decision", {humanReviewerApproved:true}), false);
});

test("only reviewed new hires may clear screening gate", () => {
  assert.equal(isNewW2HireScreeningCleared({status:"cleared"}), false);
  assert.equal(isNewW2HireScreeningCleared({status:"cleared",humanReviewerApproved:true}), true);
  assert.equal(requiresNewHireScreeningGate({employmentType:"Part-Time",isNewHire:true}), true);
  assert.equal(requiresNewHireScreeningGate({employmentType:"1099",isNewHire:true}), false);
  assert.equal(requiresNewHireScreeningGate({employmentType:"Part-Time",isNewHire:false}), false);
});
