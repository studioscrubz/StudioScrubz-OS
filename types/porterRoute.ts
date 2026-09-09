import type { PorterVisitStatus, PorterVisitWithAreas } from "@/types/porterVisit";
export const PORTER_ROUTE_STATUSES = ["Planned", "In Progress", "Completed", "Cancelled"] as const;
export type PorterRouteStatus = (typeof PORTER_ROUTE_STATUSES)[number];
export type PorterRoute = {
  id: string; route_date: string; assigned_crew_id: string; route_name: string | null; notes: string | null;
  status: PorterRouteStatus; started_at: string | null; completed_at: string | null; cancelled_at: string | null;
  created_by: string | null; created_at: string; updated_at: string;
};
export type PorterRouteStop = {
  id: string; route_id: string; visit_id: string; stop_order: number; stop_notes: string | null;
  released_at: string | null; created_at: string; updated_at: string;
};
export type RouteVisit = {
  id: string; property_label: string; plan_name: string; status: PorterVisitStatus;
  scheduled_date: string; assigned_crew_id: string | null; visit_notes: string | null;
};
export type PorterRouteWithStops = PorterRoute & { crew_name: string; business_today: string | null; stops: (PorterRouteStop & { visit: RouteVisit | null })[] };
export type RouteStopInput = { visit_id: string; stop_notes: string | null };
export type RouteEdit = { route_name: string | null; notes: string | null; stops: RouteStopInput[] };
export type CreatePorterRouteInput = RouteEdit & { route_date: string; assigned_crew_id: string };
export type RouteMutation = { action: "edit"; data: RouteEdit } | { action: "start" | "complete" | "cancel"; data?: never };
export function routeProgress(route: PorterRouteWithStops) {
  const completed = route.stops.filter(stop => stop.visit?.status === "Completed").length;
  const cancelled = route.stops.filter(stop => stop.visit?.status === "Cancelled").length;
  return { total: route.stops.length, completed, cancelled, remaining: route.stops.length - completed - cancelled };
}
export function eligibleRouteVisits(visits: PorterVisitWithAreas[], routes: PorterRouteWithStops[], date: string, crew: string, routeId?: string) {
  const reserved = new Set(routes.filter(route => route.id !== routeId && route.status !== "Cancelled").flatMap(route => route.stops.map(stop => stop.visit_id)));
  return visits.filter(visit => visit.status === "Scheduled" && visit.scheduled_date === date && visit.assigned_crew_id === crew && !reserved.has(visit.id));
}
export function validateRouteStops(stops: RouteStopInput[]) {
  if (stops.some(stop => !stop.visit_id) || new Set(stops.map(stop => stop.visit_id)).size !== stops.length) throw new Error("Select each visit only once.");
}
export function validateRouteMutation(route: PorterRouteWithStops, mutation: RouteMutation) {
  if (["Completed", "Cancelled"].includes(route.status)) throw new Error("Completed and Cancelled routes are read-only.");
  if (["edit", "start"].includes(mutation.action) && route.status !== "Planned") throw new Error("Route structure can only be edited while Planned.");
  if (mutation.action === "edit") validateRouteStops(mutation.data.stops);
  if (mutation.action === "start" && !route.stops.length) throw new Error("Add at least one stop before starting.");
  if (mutation.action === "complete" && (route.status !== "In Progress" || routeProgress(route).remaining > 0)) throw new Error("Start the route and complete or cancel every Porter Visit before completing the route.");
}
