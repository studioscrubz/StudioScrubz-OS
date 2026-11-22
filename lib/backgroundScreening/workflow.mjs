/**
 * Background screening status state machine. This is a domain helper only.
 * It does not order a consumer report, collect legal consent, or grant access.
 * Gate all calls behind server-side authorization, record immutable audit events,
 * and use a screening provider for legally required disclosures/authorization.
 */
export const SCREENING_STATES = Object.freeze([
  "not_started",
  "conditional_offer_issued",
  "authorization_pending",
  "authorized",
  "invited",
  "in_progress",
  "completed_review_pending",
  "individualized_review",
  "pre_adverse_action",
  "response_pending",
  "cleared",
  "final_adverse_decision",
  "declined",
  "canceled",
]);

const ALLOWED = Object.freeze({
  not_started: ["conditional_offer_issued"],
  conditional_offer_issued: ["authorization_pending", "canceled"],
  authorization_pending: ["authorized", "declined", "canceled"],
  authorized: ["invited", "canceled"],
  invited: ["in_progress", "canceled"],
  in_progress: ["completed_review_pending", "canceled"],
  completed_review_pending: ["cleared", "individualized_review"],
  individualized_review: ["cleared", "pre_adverse_action"],
  pre_adverse_action: ["response_pending", "cleared"],
  response_pending: ["cleared", "final_adverse_decision"],
  cleared: [],
  final_adverse_decision: [],
  declined: [],
  canceled: [],
});

export function canTransitionScreening(from, to, context = {}) {
  if (!ALLOWED[from]?.includes(to)) return false;
  if (to === "authorized") return context.writtenAuthorizationRecorded === true;
  if (to === "invited") return context.writtenAuthorizationRecorded === true;
  if (to === "cleared") return context.humanReviewerApproved === true;
  if (to === "pre_adverse_action")
    return context.individualizedReviewDocumented === true;
  if (to === "final_adverse_decision")
    return context.requiredNoticesAndResponseCompleted === true &&
      context.humanReviewerApproved === true;
  return true;
}

/** Do not treat a completed background check alone as employment clearance. */
export function isNewW2HireScreeningCleared(record) {
  return record?.status === "cleared" &&
    record?.humanReviewerApproved === true;
}

/**
 * Existing workers are grandfathered for scheduling until screened per a
 * separately approved policy. 1099 workers are outside this W-2 onboarding gate.
 */
export function requiresNewHireScreeningGate({employmentType, isNewHire}) {
  return isNewHire === true &&
    ["Part-Time", "Full-Time", "On-Call", "Temporary"].includes(employmentType);
}
