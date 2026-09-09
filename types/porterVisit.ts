import { missingPorterPhotoRequirements, PORTER_PHOTO_ERROR, type PorterPhoto, type PorterIssue } from "@/types/porterReporting";
export const VISIT_STATUSES = ["Scheduled", "In Progress", "Completed", "Cancelled"] as const;
export const VISIT_AREA_STATUSES = ["Pending", "Completed", "Unable to Complete"] as const;
export type PorterVisitStatus = (typeof VISIT_STATUSES)[number];
export type PorterVisitAreaStatus = (typeof VISIT_AREA_STATUSES)[number];
export type PorterVisit = {
  id: string; service_plan_id: string; client_id: string; property_id: string; assigned_crew_id: string | null;
  plan_name: string; property_label: string; scheduled_date: string; status: PorterVisitStatus;
  visit_notes: string | null; started_at: string | null; completed_at: string | null; cancelled_at: string | null;
  created_at: string; updated_at: string;
};
export type PorterVisitArea = {
  id: string; visit_id: string; source_plan_area_id: string | null; name: string; description: string | null;
  sort_order: number; is_required: boolean; requires_photo: boolean; status: PorterVisitAreaStatus;
  notes: string | null; completed_at: string | null; created_at: string; updated_at: string;
};
export type PorterVisitWithAreas = PorterVisit & { crew_name: string | null; areas: PorterVisitArea[]; photos?: PorterPhoto[]; issues?: PorterIssue[] };
export type CreatePorterVisitInput = { plan_id: string; scheduled_date: string; assigned_crew_id: string | null; visit_notes: string | null };
export type PorterVisitEdit = Pick<PorterVisit, "scheduled_date" | "assigned_crew_id" | "visit_notes">;
export type PorterVisitMutation =
  | { action: "edit"; data: PorterVisitEdit }
  | { action: "notes"; data: { visit_notes: string | null } }
  | { action: "area"; data: { area_id: string; status: PorterVisitAreaStatus; notes: string | null } }
  | { action: "start" | "complete" | "cancel"; data?: never };

export function validateVisitDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) throw new Error("Choose a valid scheduled date.");
}
export function validateVisitMutation(visit: PorterVisitWithAreas, mutation: PorterVisitMutation, management: boolean) {
  if (["Completed", "Cancelled"].includes(visit.status)) throw new Error("Completed and Cancelled visits are read-only.");
  if ((mutation.action === "edit" || mutation.action === "cancel") && !management) throw new Error("This action requires management access.");
  if ((mutation.action === "edit" || mutation.action === "start") && visit.status !== "Scheduled") throw new Error("This action requires a Scheduled visit.");
  if ((mutation.action === "area" || mutation.action === "complete") && visit.status !== "In Progress") throw new Error("Start the visit first.");
  if (mutation.action === "edit") validateVisitDate(mutation.data.scheduled_date);
  if (mutation.action === "area" && (!visit.areas.some(area => area.id === mutation.data.area_id) || !VISIT_AREA_STATUSES.includes(mutation.data.status))) throw new Error("Invalid service area update.");
  if (mutation.action === "complete" && missingPorterPhotoRequirements(visit.areas, visit.photos ?? [])) throw new Error(PORTER_PHOTO_ERROR);
  if (mutation.action === "complete" && visit.areas.some(area => area.is_required && area.status === "Pending")) throw new Error("Resolve all required Pending service areas before completing.");
}
