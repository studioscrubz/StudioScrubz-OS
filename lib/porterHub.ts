import type { PorterVisitWithAreas } from "@/types/porterVisit";

export type PorterBusinessClock = {
  date: string;
  time: string;
  timezone: string;
};

export type PorterVisitProgress = {
  addressed: number;
  total: number;
  percent: number;
};

export function getPorterBusinessClock(now: Date, timezone: string): PorterBusinessClock {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}`,
    timezone,
  };
}

export function porterVisitProgress(visit: Pick<PorterVisitWithAreas, "areas">): PorterVisitProgress {
  const total = visit.areas.length;
  const addressed = visit.areas.filter(area => area.status !== "Pending").length;
  return { addressed, total, percent: total ? Math.round((addressed / total) * 100) : 0 };
}

export function isOverduePorterVisit(
  visit: Pick<PorterVisitWithAreas, "status" | "scheduled_date" | "scheduled_start_time">,
  clock: Pick<PorterBusinessClock, "date" | "time">,
) {
  if (visit.status !== "Scheduled") return false;
  if (visit.scheduled_date < clock.date) return true;
  return visit.scheduled_date === clock.date
    && Boolean(visit.scheduled_start_time)
    && visit.scheduled_start_time!.slice(0, 5) < clock.time;
}

export function summarizePorterHub(visits: PorterVisitWithAreas[], clock: PorterBusinessClock) {
  const overdue = visits.filter(visit => isOverduePorterVisit(visit, clock));
  const todayScheduled = visits.filter(visit => visit.status === "Scheduled"
    && visit.scheduled_date === clock.date && !isOverduePorterVisit(visit, clock));
  const inProgress = visits.filter(visit => visit.status === "In Progress");
  const completed = visits.filter(visit => visit.status === "Completed" && visit.scheduled_date === clock.date);
  const activeIssues = visits.flatMap(visit => (visit.issues ?? [])
    .filter(issue => issue.status !== "Resolved")
    .map(issue => ({ visit, issue })));
  const urgentIssues = activeIssues.filter(({ issue }) => issue.severity === "Urgent");
  return { todayScheduled, inProgress, completed, overdue, activeIssues, urgentIssues };
}
