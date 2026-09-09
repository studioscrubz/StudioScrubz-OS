export const PORTER_ISSUE_CATEGORIES = ["Maintenance", "Safety", "Damage", "Cleanliness", "Grounds", "Trash Area", "Access", "Pool Area", "Other"] as const;
export const PORTER_ISSUE_SEVERITIES = ["Low", "Medium", "High", "Urgent"] as const;
export type PorterIssueInput = {
  visit_area_id: string | null; category: (typeof PORTER_ISSUE_CATEGORIES)[number];
  severity: (typeof PORTER_ISSUE_SEVERITIES)[number]; title: string; description: string | null;
};
export type PorterIssue = PorterIssueInput & {
  id: string; visit_id: string; status: "Open" | "Acknowledged" | "Resolved";
  reported_by: string | null; reporter_name: string | null; reported_at: string;
  resolved_at: string | null; resolution_notes: string | null; created_at: string; updated_at: string;
};
export type PorterPhoto = {
  id: string; visit_id: string; visit_area_id: string | null; issue_id: string | null;
  storage_path: string; file_name: string | null; mime_type: string; file_size_bytes: number;
  caption: string | null; uploaded_by: string | null; created_at: string; archived_at: string | null;
};
export type PorterPhotoWithUrl = PorterPhoto & { signedUrl: string | null };
export const PORTER_PHOTO_ERROR = "Add required photo evidence and resolve all required-photo service areas before completing this visit.";
export function missingPorterPhotoRequirements(areas: { id: string; requires_photo: boolean; is_required: boolean; status: string }[], photos: Pick<PorterPhoto, "visit_area_id" | "archived_at">[]) {
  return areas.some(area => area.is_required && area.requires_photo && (area.status === "Pending" || !photos.some(photo => photo.visit_area_id === area.id && !photo.archived_at)));
}
export function validatePorterIssue(input: PorterIssueInput) {
  if (!input.title.trim() || !PORTER_ISSUE_CATEGORIES.includes(input.category) || !PORTER_ISSUE_SEVERITIES.includes(input.severity)) throw new Error("Provide an issue title, category, and severity.");
}
