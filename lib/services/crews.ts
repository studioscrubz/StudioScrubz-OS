import { isMasterAdmin } from "@/lib/auth/permissions";
import { getSupabaseClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/services/auth";
import { getEmployees } from "@/lib/services/employees";
import type { Crew, CrewInput, CrewMember, CrewUpdate, CrewWithRelations } from "@/types/crew";

const select = "*, crew_lead:employees!crews_crew_lead_id_fkey(*), members:crew_members(*, employee:employees!crew_members_employee_id_fkey(*))";

export async function getCrews(): Promise<CrewWithRelations[]> {
  if (await master()) {
    const { data, error } = await getSupabaseClient().from("crews").select(select).order("crew_name");
    if (error) throw error;
    return data as CrewWithRelations[];
  }
  const client = getSupabaseClient();
  const [{ data: crews, error: crewError }, { data: members, error: memberError }, employees] = await Promise.all([
    client.from("crew_directory_safe").select("*").order("crew_name"),
    client.from("crew_members_directory_safe").select("id,crew_id,employee_id,created_at"),
    getEmployees(),
  ]);
  if (crewError) throw crewError;
  if (memberError) throw memberError;
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  return crews.map((crew) => ({
    ...crew,
    crew_lead: crew.crew_lead_id ? employeeById.get(crew.crew_lead_id) ?? null : null,
    members: members
      .filter((member) => member.crew_id === crew.id && employeeById.has(member.employee_id))
      .map((member) => ({ ...member, employee: employeeById.get(member.employee_id)! })),
  }));
}

export async function getActiveCrews() { return (await getCrews()).filter((crew) => crew.status === "Active" && !crew.archived_at); }
export async function getCrewById(id: string): Promise<CrewWithRelations> {
  const crew = (await getCrews()).find((row) => row.id === id);
  if (!crew) throw new Error("Crew not found or access denied.");
  return crew;
}
export async function createCrew(input: CrewInput): Promise<Crew> {
  if (await master()) {
    const { data, error } = await getSupabaseClient().from("crews").insert(input).select().single();
    if (error) throw error;
    return data;
  }
  return manageCrew(null, input, false);
}
export async function updateCrew(id: string, input: CrewUpdate): Promise<Crew> {
  if (await master()) {
    const { data, error } = await getSupabaseClient().from("crews").update(input).eq("id", id).select().single();
    if (error) throw error;
    return data;
  }
  const current = await getCrewById(id);
  return manageCrew(id, { ...current, ...input }, false);
}
export const setCrewLead = (id: string, employeeId: string | null) => updateCrew(id, { crew_lead_id: employeeId });
export async function archiveCrew(id: string) {
  if (await master()) return updateCrew(id, { status: "Archived", archived_at: new Date().toISOString() });
  return manageCrew(id, await getCrewById(id), true);
}
export async function getCrewMembers(crewId: string): Promise<CrewMember[]> { return (await getCrewById(crewId)).members; }
export async function addCrewMember(crewId: string, employeeId: string): Promise<void> {
  if (await master()) {
    const { error } = await getSupabaseClient().from("crew_members").insert({ crew_id: crewId, employee_id: employeeId });
    if (error?.code === "23505") throw new Error("This employee is already in the crew.");
    if (error) throw error;
    return;
  }
  const { error } = await getSupabaseClient().rpc("add_operational_crew_member", { p_crew_id: crewId, p_employee_id: employeeId });
  if (error?.code === "23505") throw new Error("This employee is already in the crew.");
  if (error) throw error;
}
export async function removeCrewMember(id: string): Promise<void> {
  if (await master()) {
    const { error } = await getSupabaseClient().from("crew_members").delete().eq("id", id);
    if (error) throw error;
    return;
  }
  const { error } = await getSupabaseClient().rpc("remove_operational_crew_member", { p_member_id: id });
  if (error) throw error;
}

async function manageCrew(id: string | null, input: CrewInput | Crew, archive: boolean): Promise<Crew> {
  const { data, error } = await getSupabaseClient().rpc("manage_operational_crew", {
    p_crew_id: id,
    p_crew_name: input.crew_name,
    p_crew_lead_id: input.crew_lead_id,
    p_status: input.status,
    p_notes: input.notes,
    p_archive: archive,
  });
  if (error) throw error;
  return data;
}
async function master() { return isMasterAdmin(await getCurrentProfile()); }
