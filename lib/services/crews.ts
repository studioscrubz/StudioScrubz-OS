import {getSupabaseClient} from "@/lib/supabase/client";
import type {Crew,CrewInput,CrewMember,CrewUpdate,CrewWithRelations} from "@/types/crew";
const select="*, crew_lead:employees!crews_crew_lead_id_fkey(*), members:crew_members(*, employee:employees!crew_members_employee_id_fkey(*))";
export async function getCrews():Promise<CrewWithRelations[]>{const{data,error}=await getSupabaseClient().from("crews").select(select).order("crew_name");if(error)throw error;return data as CrewWithRelations[]}
export async function getActiveCrews(){const rows=await getCrews();return rows.filter(c=>c.status==="Active"&&!c.archived_at)}
export async function getCrewById(id:string):Promise<CrewWithRelations>{const{data,error}=await getSupabaseClient().from("crews").select(select).eq("id",id).single();if(error)throw error;return data as CrewWithRelations}
export async function createCrew(input:CrewInput):Promise<Crew>{const{data,error}=await getSupabaseClient().from("crews").insert(input).select().single();if(error)throw error;return data}
export async function updateCrew(id:string,input:CrewUpdate):Promise<Crew>{const{data,error}=await getSupabaseClient().from("crews").update(input).eq("id",id).select().single();if(error)throw error;return data}
export const setCrewLead=(id:string,employeeId:string|null)=>updateCrew(id,{crew_lead_id:employeeId});
export const archiveCrew=(id:string)=>updateCrew(id,{status:"Archived",archived_at:new Date().toISOString()});
export async function getCrewMembers(crewId:string):Promise<CrewMember[]>{const{data,error}=await getSupabaseClient().from("crew_members").select("*, employee:employees!crew_members_employee_id_fkey(*)").eq("crew_id",crewId);if(error)throw error;return data as CrewMember[]}
export async function addCrewMember(crewId:string,employeeId:string):Promise<void>{const{error}=await getSupabaseClient().from("crew_members").insert({crew_id:crewId,employee_id:employeeId});if(error?.code==="23505")throw new Error("This employee is already in the crew.");if(error)throw error}
export async function removeCrewMember(id:string):Promise<void>{const{error}=await getSupabaseClient().from("crew_members").delete().eq("id",id);if(error)throw error}
