import { isMasterAdmin } from "@/lib/auth/permissions";
import { getSupabaseClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/services/auth";
import { getEmployees } from "@/lib/services/employees";
import { notifyAttentionRefresh } from "@/lib/attentionEvents";
import { requestImmediateAttentionPush } from "@/lib/push/client";
import type { Crew, CrewInput, CrewUpdate, CrewWithRelations } from "@/types/crew";

const select = "*, crew_lead:employees!crews_crew_lead_id_fkey(*)";

export async function getCrews(): Promise<CrewWithRelations[]> {
  if (await master()) {
    const { data, error } = await getSupabaseClient().from("crews").select(select).order("crew_name");
    if (error) throw error;
    return (data as CrewWithRelations[]).map(crew=>({...crew,members:[]}));
  }
  const client = getSupabaseClient();
  const [{ data: crews, error: crewError }, employees] = await Promise.all([
    client.rpc("get_crew_directory"),
    getEmployees(),
  ]);
  if (crewError) throw crewError;
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  return crews.map((crew) => ({
    ...crew,
    crew_lead: crew.crew_lead_id ? employeeById.get(crew.crew_lead_id) ?? null : null,
    members: [],
  }));
}

export async function getActiveCrews() { return (await getCrews()).filter((crew) => crew.status === "Active" && !crew.archived_at); }
export async function getCrewById(id: string): Promise<CrewWithRelations> {
  const crew = (await getCrews()).find((row) => row.id === id);
  if (!crew) throw new Error("Crew not found or access denied.");
  return crew;
}
export async function createCrew(input:CrewInput):Promise<Crew>{return manageCrew(null,input,false);}
export async function updateCrew(id:string,input:CrewUpdate):Promise<Crew>{return manageCrew(id,{...await getCrewById(id),...input},false);}
export const setCrewLead=(id:string,employeeId:string|null)=>updateCrew(id,{crew_lead_id:employeeId});
export async function archiveCrew(id:string){return manageCrew(id,await getCrewById(id),true);}
async function manageCrew(id: string | null, input: CrewInput | Crew, archive: boolean): Promise<Crew> {
  const { data, error } = await getSupabaseClient().rpc("manage_operational_crew", {
    p_crew_id: id,
    p_crew_name: input.crew_name,
    p_crew_lead_id: input.crew_lead_id,
    p_status: input.status,
    p_notes: input.notes,
    p_archive: archive,
    p_technician_capacity: input.technician_capacity,
  });
  if (error) throw error;
  return data;
}
async function master() { return isMasterAdmin(await getCurrentProfile()); }

export async function setJobCrewTechnicians(jobId: string, employeeIds: string[]): Promise<number> {
  const { data, error } = await getSupabaseClient().rpc("set_job_crew_technicians", { p_job_id: jobId, p_employee_ids: employeeIds });
  if (error) throw error;
  notifyAttentionRefresh();
  void requestImmediateAttentionPush();
  return data as number;
}

export async function getJobCrewTechnicians(jobId: string): Promise<string[]> {
  const { data, error } = await getSupabaseClient().rpc("get_job_crew_technicians", { p_job_id: jobId });
  if (error) throw error;
  return (data as { employee_id: string }[]).map(row => row.employee_id);
}

export async function deleteCrew(id:string):Promise<void>{const {error}=await getSupabaseClient().rpc("delete_operational_crew",{p_crew_id:id});if(error)throw error;}
