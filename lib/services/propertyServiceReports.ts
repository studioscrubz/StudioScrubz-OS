import { hasPermission } from "@/lib/auth/permissions";
import { getCurrentProfile } from "@/lib/services/auth";
import { deletePorterVisit, getPorterVisit, listPorterVisits } from "@/lib/services/porterVisits";
import { getPropertyServicePlan } from "@/lib/services/propertyServicePlans";
import { getClientById } from "@/lib/services/clients";

async function authorize() {
  if (!hasPermission(await getCurrentProfile(), "porterVisits.manage")) throw new Error("Property Service Report access denied.");
}
export async function listPropertyServiceReports() {
  await authorize();
  return (await listPorterVisits()).filter(visit => visit.status === "Completed")
    .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
}
export async function getPropertyServiceReport(id: string) {
  await authorize();
  const visit = await getPorterVisit(id);
  if (visit.status !== "Completed") throw new Error("Reports are available only for Completed Porter Visits.");
  // Optional current context never replaces the visit's historical labels or areas.
  const [plan, client] = await Promise.allSettled([getPropertyServicePlan(visit.service_plan_id), getClientById(visit.client_id)]);
  return {
    visit,
    currentFrequency: plan.status === "fulfilled" ? plan.value.frequency : null,
    currentClientName: client.status === "fulfilled" ? client.value.company_name || [client.value.first_name, client.value.last_name].filter(Boolean).join(" ") || null : null,
    contextUnavailable: plan.status === "rejected" || client.status === "rejected",
  };
}
export async function deletePropertyServiceReport(id: string): Promise<void> {
  await authorize();
  await deletePorterVisit(id);
}
