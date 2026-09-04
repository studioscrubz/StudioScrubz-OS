import type { ProposalStatus } from "@/types/proposal";
import type { AssessmentMethod, WalkthroughMeasurements, WalkthroughStatus } from "@/types/walkthrough";

const RETIRED_PROPOSAL_STATUSES: ReadonlySet<ProposalStatus> = new Set(["Ready for Approval", "Approved", "Sent", "Viewed", "Accepted", "Declined", "Expired"]);

export type ScheduledWalkthrough = {
  walkthrough_date: string | null;
  walkthrough_time: string | null;
};

export function assessmentMethod(input:{measurements?:Partial<WalkthroughMeasurements>|null}):AssessmentMethod{return input.measurements?.assessmentMethod??"In-Person Walkthrough"}

export function assessmentReadyForPricing(input:{status:WalkthroughStatus;measurements?:Partial<WalkthroughMeasurements>|null;photos?:unknown[]}):boolean{return input.status==="Completed"&&(assessmentMethod(input)==="In-Person Walkthrough"||Boolean(input.measurements?.photoSubmittedAt||(input.photos?.length??0)>0))}

export function assertWalkthroughSchedule(input: ScheduledWalkthrough & { status?: WalkthroughStatus; measurements?:Partial<WalkthroughMeasurements>|null }): void {
  if (Boolean(input.walkthrough_date) !== Boolean(input.walkthrough_time)) throw new Error("Walkthrough date and time must be scheduled together.");
  if (assessmentMethod(input)==="In-Person Walkthrough"&&input.status && ["Scheduled", "Completed", "Proposal Ready"].includes(input.status) && (!input.walkthrough_date || !input.walkthrough_time)) throw new Error("An in-person walkthrough must have both a scheduled date and scheduled time before entering the Walkthroughs workflow.");
}

export function compareWalkthroughSchedule(a: ScheduledWalkthrough, b: ScheduledWalkthrough): number {
  const date = (a.walkthrough_date ?? "").localeCompare(b.walkthrough_date ?? "");
  return date || (a.walkthrough_time ?? "99:99").localeCompare(b.walkthrough_time ?? "99:99");
}

export function isScheduledWalkthrough(input: ScheduledWalkthrough): boolean {
  return Boolean(input.walkthrough_date && input.walkthrough_time);
}

export function proposalRetiresWalkthrough(status: ProposalStatus | null | undefined): boolean {
  return Boolean(status && RETIRED_PROPOSAL_STATUSES.has(status));
}
