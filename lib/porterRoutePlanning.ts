import type { PorterRouteWithStops } from "@/types/porterRoute";
import type { PorterVisitWithAreas } from "@/types/porterVisit";

export type PorterStartConflict = {
  startTime: string;
  visits: PorterVisitWithAreas[];
};

export type PorterCrewWorkload = {
  crewId: string;
  crewName: string;
  totalScheduled: number;
  routed: number;
  unrouted: PorterVisitWithAreas[];
  routeCount: number;
  duplicateStarts: PorterStartConflict[];
};

type CrewReference = { id: string; crew_name: string };

/**
 * Builds a planning-only view from the same authorized Visit and Route records
 * used by the existing manual route editor. It never changes assignments.
 */
export function buildPorterCrewWorkloads(
  visits: PorterVisitWithAreas[],
  routes: PorterRouteWithStops[],
  crews: CrewReference[],
  serviceDate: string,
): PorterCrewWorkload[] {
  if (!serviceDate) return [];

  const scheduled = visits.filter(visit =>
    visit.status === "Scheduled"
    && visit.scheduled_date === serviceDate
    && Boolean(visit.assigned_worker_crew_id)
    && !visit.assigned_worker_employee_id,
  );
  const activeRoutes = routes.filter(route =>
    route.route_date === serviceDate && route.status !== "Cancelled",
  );
  const routedVisitIds = new Set(activeRoutes.flatMap(route =>
    route.stops.filter(stop => !stop.released_at).map(stop => stop.visit_id),
  ));
  const crewNames = new Map(crews.map(crew => [crew.id, crew.crew_name]));
  for (const route of activeRoutes) crewNames.set(route.assigned_crew_id, route.crew_name);
  for (const visit of scheduled) {
    if (visit.assigned_worker_crew_id && visit.crew_name) {
      crewNames.set(visit.assigned_worker_crew_id, visit.crew_name);
    }
  }

  const crewIds = new Set([
    ...crews.map(crew => crew.id),
    ...scheduled.flatMap(visit => visit.assigned_worker_crew_id ? [visit.assigned_worker_crew_id] : []),
    ...activeRoutes.map(route => route.assigned_crew_id),
  ]);

  return [...crewIds].map(crewId => {
    const crewVisits = scheduled.filter(visit => visit.assigned_worker_crew_id === crewId);
    const byStart = new Map<string, PorterVisitWithAreas[]>();
    for (const visit of crewVisits) {
      if (!visit.scheduled_start_time) continue;
      const start = visit.scheduled_start_time.slice(0, 5);
      byStart.set(start, [...(byStart.get(start) ?? []), visit]);
    }
    return {
      crewId,
      crewName: crewNames.get(crewId) ?? "Assigned crew",
      totalScheduled: crewVisits.length,
      routed: crewVisits.filter(visit => routedVisitIds.has(visit.id)).length,
      unrouted: crewVisits.filter(visit => !routedVisitIds.has(visit.id)),
      routeCount: activeRoutes.filter(route => route.assigned_crew_id === crewId).length,
      duplicateStarts: [...byStart.entries()]
        .filter(([, rows]) => rows.length > 1)
        .map(([startTime, rows]) => ({ startTime, visits: rows }))
        .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    };
  }).sort((a, b) => a.crewName.localeCompare(b.crewName) || a.crewId.localeCompare(b.crewId));
}
