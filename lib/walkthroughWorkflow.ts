import type { ProposalStatus } from "@/types/proposal";
import type {
  AssessmentMethod,
  WalkthroughMeasurements,
  WalkthroughStatus,
} from "@/types/walkthrough";

const RETIRED_PROPOSAL_STATUSES: ReadonlySet<ProposalStatus> = new Set([
  "Sent",
  "Viewed",
  "Accepted",
  "Declined",
  "Expired",
]);

export type ScheduledWalkthrough = {
  walkthrough_date: string | null;
  walkthrough_time: string | null;
};

export function residentialPostConstructionScopeError(input: { division?: string; measurements?: Partial<WalkthroughMeasurements> | null }): string | null {
  const m = input.measurements;
  if (input.division !== "Residential" || !/post[- ]construction/i.test(m?.serviceType ?? "")) return null;
  for (const [key, label, positive] of [["bedrooms", "Bedrooms", false], ["bathrooms", "Bathrooms", false], ["squareFeet", "Total square feet", true], ["floors", "Floors", true], ["kitchenAreas", "Kitchens", false]] as const) {
    const value = m?.[key];
    if (typeof value !== "number" || !Number.isFinite(value) || (positive ? value <= 0 : value < 0)) return label + (positive ? " must be greater than zero before scheduling or pricing Residential Post-Construction." : " must be entered (zero is allowed) before scheduling or pricing Residential Post-Construction.");
  }
  return null;
}

export function assessmentMethod(input: {
  measurements?: Partial<WalkthroughMeasurements> | null;
}): AssessmentMethod {
  return input.measurements?.assessmentMethod ?? "In-Person Walkthrough";
}

export function assessmentReadyForPricing(input: {
  status: WalkthroughStatus;
  measurements?: Partial<WalkthroughMeasurements> | null;
  photos?: unknown[];
}): boolean {
  if (input.status !== "Completed") return false;

  if (assessmentMethod(input) === "In-Person Walkthrough") {
    return true;
  }

  return Boolean(
    input.measurements?.photoSubmittedAt &&
    (input.photos?.length ?? 0) > 0
  );
}

export function assertWalkthroughSchedule(
  input: ScheduledWalkthrough & {
    division?: string;
    status?: WalkthroughStatus;
    measurements?: Partial<WalkthroughMeasurements> | null;
  }
): void {
  if (input.walkthrough_date || (input.status && ["Scheduled", "Completed", "Proposal Ready"].includes(input.status))) {
    const scopeError = residentialPostConstructionScopeError(input);
    if (scopeError) throw new Error(scopeError);
  }
  if (Boolean(input.walkthrough_date) !== Boolean(input.walkthrough_time)) {
    throw new Error(
      "Walkthrough date and time must be scheduled together."
    );
  }

  if (
    assessmentMethod(input) === "In-Person Walkthrough" &&
    input.status &&
    ["Scheduled", "Completed", "Proposal Ready"].includes(input.status) &&
    (!input.walkthrough_date || !input.walkthrough_time)
  ) {
    throw new Error(
      "An in-person walkthrough must have both a scheduled date and scheduled time before entering the Walkthroughs workflow."
    );
  }
}

export function compareWalkthroughSchedule(
  a: ScheduledWalkthrough,
  b: ScheduledWalkthrough
): number {
  const date = (a.walkthrough_date ?? "").localeCompare(
    b.walkthrough_date ?? ""
  );

  return (
    date ||
    (a.walkthrough_time ?? "99:99").localeCompare(
      b.walkthrough_time ?? "99:99"
    )
  );
}

export function isScheduledWalkthrough(
  input: ScheduledWalkthrough
): boolean {
  return Boolean(input.walkthrough_date && input.walkthrough_time);
}

export function proposalRetiresWalkthrough(
  status: ProposalStatus | null | undefined
): boolean {
  return Boolean(status && RETIRED_PROPOSAL_STATUSES.has(status));
}