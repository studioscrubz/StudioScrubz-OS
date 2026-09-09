import type { PorterVisitWithAreas } from "@/types/porterVisit";

export const PROPERTY_REPORT_STATUSES = ["Completed", "Completed with Open Issues", "Completed with Unresolved Service Areas"] as const;
export function summarizePropertyServiceReport(visit: PorterVisitWithAreas) {
  const photos = (visit.photos ?? []).filter(photo => !photo.archived_at);
  const issues = visit.issues ?? [];
  const documented = (id: string) => photos.some(photo => photo.visit_area_id === id);
  const metrics = {
    totalAreas: visit.areas.length,
    completedAreas: visit.areas.filter(area => area.status === "Completed").length,
    unableAreas: visit.areas.filter(area => area.status === "Unable to Complete").length,
    pendingAreas: visit.areas.filter(area => area.status === "Pending").length,
    requiredAreas: visit.areas.filter(area => area.is_required).length,
    requiredCompleted: visit.areas.filter(area => area.is_required && area.status === "Completed").length,
    photoRequiredAreas: visit.areas.filter(area => area.is_required && area.requires_photo).length,
    photoRequiredDocumented: visit.areas.filter(area => area.is_required && area.requires_photo && documented(area.id)).length,
    evidence: photos.length,
    issues: issues.length,
    openIssues: issues.filter(issue => issue.status === "Open").length,
    acknowledgedIssues: issues.filter(issue => issue.status === "Acknowledged").length,
    resolvedIssues: issues.filter(issue => issue.status === "Resolved").length,
    highUrgentIssues: issues.filter(issue => ["High", "Urgent"].includes(issue.severity)).length,
  };
  const unresolved = metrics.unableAreas > 0 || metrics.pendingAreas > 0 || metrics.photoRequiredDocumented < metrics.photoRequiredAreas;
  const status = unresolved ? PROPERTY_REPORT_STATUSES[2] : metrics.openIssues + metrics.acknowledgedIssues > 0 ? PROPERTY_REPORT_STATUSES[1] : PROPERTY_REPORT_STATUSES[0];
  return { metrics, status };
}
