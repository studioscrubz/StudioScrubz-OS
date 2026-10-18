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

export type PorterRouteLocation = {
  stopId: string;
  visitId: string;
  label: string;
  address: string | null;
  scheduledStartTime: string | null;
  visitStatus: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type PorterRouteSuggestion = {
  routeId: string;
  routeVersion: string;
  routeDate: string;
  crewId: string;
  stopSetKey: string;
  currentOrder: PorterRouteLocation[];
  suggestedOrder: PorterRouteLocation[];
  unavailable: PorterRouteLocation[];
  lockedStops: PorterRouteLocation[];
  currentStraightLineMiles: number | null;
  suggestedStraightLineMiles: number | null;
  changed: boolean;
  schedulingWarnings: string[];
  method: "nearest_neighbor_straight_line_v1" | "unavailable";
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

function validCoordinates(stop: PorterRouteLocation) {
  return stop.latitude !== null && stop.longitude !== null
    && Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude)
    && Math.abs(stop.latitude) <= 90 && Math.abs(stop.longitude) <= 180;
}

function straightLineMeters(a: PorterRouteLocation, b: PorterRouteLocation) {
  const radians = (value: number) => value * Math.PI / 180;
  const lat1 = radians(a.latitude!);
  const lat2 = radians(b.latitude!);
  const deltaLat = lat2 - lat1;
  const deltaLon = radians(b.longitude! - a.longitude!);
  const haversine = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function routeDistance(stops: PorterRouteLocation[]) {
  return stops.slice(1).reduce((total, stop, index) => total + straightLineMeters(stops[index], stop), 0);
}

function duplicateStartWarnings(stops: PorterRouteLocation[]) {
  const starts = new Map<string, string[]>();
  for (const stop of stops) {
    if (!stop.scheduledStartTime) continue;
    const time = stop.scheduledStartTime.slice(0, 5);
    starts.set(time, [...(starts.get(time) ?? []), stop.label]);
  }
  return [...starts.entries()]
    .filter(([, labels]) => labels.length > 1)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, labels]) => `Duplicate scheduled start at ${time}: ${labels.join(", ")}.`);
}

export function buildPorterRouteSuggestion(route: PorterRouteWithStops, locations: PorterRouteLocation[]): PorterRouteSuggestion {
  const currentStopIds = route.stops.map(stop => stop.id);
  if (new Set(currentStopIds).size !== currentStopIds.length) throw new Error("The route contains duplicate stop identities.");
  const locationByStop = new Map(locations.map(location => [location.stopId, location]));
  const currentOrder = [...route.stops]
    .sort((a, b) => a.stop_order - b.stop_order || a.id.localeCompare(b.id))
    .map(stop => locationByStop.get(stop.id) ?? {
      stopId: stop.id,
      visitId: stop.visit_id,
      label: stop.visit?.property_label ?? "Porter Visit",
      address: null,
      scheduledStartTime: stop.visit?.scheduled_start_time ?? null,
      visitStatus: stop.visit?.status ?? null,
      latitude: null,
      longitude: null,
    });
  const unavailable = currentOrder.filter(stop => !stop.address?.trim() || !validCoordinates(stop));
  const lockedStops = currentOrder.filter(stop => stop.visitStatus === "Completed" || stop.visitStatus === "Cancelled");
  const base = {
    routeId: route.id,
    routeVersion: route.updated_at,
    routeDate: route.route_date,
    crewId: route.assigned_crew_id,
    stopSetKey: [...currentStopIds].sort().join("|"),
    currentOrder,
    unavailable,
    lockedStops,
    schedulingWarnings: duplicateStartWarnings(currentOrder),
  };
  if (route.status !== "Planned" || currentOrder.length < 2 || unavailable.length || lockedStops.length) {
    return { ...base, suggestedOrder: currentOrder, currentStraightLineMiles: null, suggestedStraightLineMiles: null, changed: false, method: "unavailable" };
  }

  const remaining = currentOrder.slice(1).map((stop, index) => ({ stop, currentIndex: index + 1 }));
  const suggestedOrder = [currentOrder[0]];
  while (remaining.length) {
    const previous = suggestedOrder.at(-1)!;
    remaining.sort((a, b) => straightLineMeters(previous, a.stop) - straightLineMeters(previous, b.stop)
      || a.currentIndex - b.currentIndex || a.stop.stopId.localeCompare(b.stop.stopId));
    suggestedOrder.push(remaining.shift()!.stop);
  }
  const currentMeters = routeDistance(currentOrder);
  const suggestedMeters = routeDistance(suggestedOrder);
  return {
    ...base,
    suggestedOrder,
    currentStraightLineMiles: currentMeters / 1609.344,
    suggestedStraightLineMiles: suggestedMeters / 1609.344,
    changed: suggestedOrder.some((stop, index) => stop.stopId !== currentOrder[index]?.stopId),
    method: "nearest_neighbor_straight_line_v1",
  };
}

export function validatePorterRouteSuggestion(route: PorterRouteWithStops, suggestion: PorterRouteSuggestion) {
  if (route.id !== suggestion.routeId || route.route_date !== suggestion.routeDate || route.assigned_crew_id !== suggestion.crewId) throw new Error("The route identity, service date, or crew changed. Generate a new suggestion.");
  if (route.status !== "Planned") throw new Error("Only Planned routes can apply a suggested order.");
  if (route.updated_at !== suggestion.routeVersion) throw new Error("Route changed. Generate a new suggestion before applying.");
  const currentIds = route.stops.map(stop => stop.id);
  const suggestedIds = suggestion.suggestedOrder.map(stop => stop.stopId);
  if (new Set(suggestedIds).size !== suggestedIds.length) throw new Error("The suggested order contains duplicate stops.");
  if ([...currentIds].sort().join("|") !== suggestion.stopSetKey || [...suggestedIds].sort().join("|") !== suggestion.stopSetKey) throw new Error("The route stop set changed. Generate a new suggestion before applying.");
  if (suggestion.method === "unavailable" || suggestion.unavailable.length || suggestion.lockedStops.length) throw new Error("A safe route-order suggestion is not available.");
}
