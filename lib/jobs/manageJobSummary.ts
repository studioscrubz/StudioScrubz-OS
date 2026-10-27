import type { JobsiteGpsSummary } from "@/lib/services/jobsiteGps";

/** Match the existing lead-arrival requirement; a manager exception is never verification. */
export function jobGpsStatus(summary: JobsiteGpsSummary | null, leadId: string | null, employeeId: string | null, now: number | null) {
  if (!summary) return "Loading status…";
  if (!summary.configured) return "Setup Required";
  const checks = summary.employeeChecks.filter(check => check.employeeId === leadId);
  if (leadId && leadId === employeeId && summary.lastCheck) checks.push({ ...summary.lastCheck, employeeId: leadId });
  const latest = checks.sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt))[0];
  return latest?.result === "Within Radius" && now !== null && Date.parse(latest.checkedAt) >= now - 12 * 60 * 60 * 1000
    ? "Verified" : "Awaiting Verification";
}
