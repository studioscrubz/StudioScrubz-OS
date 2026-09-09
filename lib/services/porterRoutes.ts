import { getSupabaseClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/services/auth";
import { hasPermission } from "@/lib/auth/permissions";
import { validateVisitDate } from "@/types/porterVisit";
import { validateRouteMutation, validateRouteStops, type CreatePorterRouteInput, type PorterRouteWithStops, type RouteMutation } from "@/types/porterRoute";
async function authorize(manage = false) {
  if (!hasPermission(await getCurrentProfile(), manage ? "porterVisits.manage" : "porterVisits.view")) throw new Error("Porter Route access denied.");
}
export async function listPorterRoutes(): Promise<PorterRouteWithStops[]> {
  await authorize();
  const { data, error } = await getSupabaseClient().rpc("get_porter_routes", {});
  if (error) throw new Error(`Porter Routes could not be loaded: ${error.message}`);
  return data;
}
export async function getPorterRoute(id: string): Promise<PorterRouteWithStops> {
  await authorize();
  const { data, error } = await getSupabaseClient().rpc("get_porter_routes", { p_id: id });
  if (error) throw new Error(`Porter Route could not be loaded: ${error.message}`);
  if (!data[0]) throw new Error("Porter Route not found or access denied.");
  return data[0];
}
export async function createPorterRoute(input: CreatePorterRouteInput) {
  await authorize(true); validateVisitDate(input.route_date); validateRouteStops(input.stops);
  if (!input.assigned_crew_id) throw new Error("Select an active crew.");
  const { data, error } = await getSupabaseClient().rpc("create_porter_route", { p_route_date: input.route_date, p_crew_id: input.assigned_crew_id, p_name: input.route_name, p_notes: input.notes, p_stops: input.stops });
  if (error) throw new Error(`Porter Route could not be created: ${error.message}`);
  return data;
}
export async function mutatePorterRoute(route: PorterRouteWithStops, mutation: RouteMutation) {
  await authorize(true); validateRouteMutation(route, mutation);
  const { data, error } = await getSupabaseClient().rpc("mutate_porter_route", { p_id: route.id, p_expected_updated_at: route.updated_at, p_action: mutation.action, p_data: mutation.data ?? {} });
  if (error) throw new Error(`Porter Route could not be updated: ${error.message}`);
  return data;
}
