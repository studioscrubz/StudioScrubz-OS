import {getSupabaseClient} from "@/lib/supabase/client";
import type {Vehicle,VehicleInput,VehicleUpdate,VehicleWithRelations} from "@/types/vehicle";
const select="*, assigned_employee:employees!vehicles_assigned_employee_id_fkey(*), assigned_crew:crews!vehicles_assigned_crew_id_fkey(*)";
export async function getVehicles():Promise<VehicleWithRelations[]>{const{data,error}=await getSupabaseClient().from("vehicles").select(select).order("created_at",{ascending:false});if(error)throw error;return data as VehicleWithRelations[]}
export async function getActiveVehicles(){const rows=await getVehicles();return rows.filter(x=>x.status==="Active"&&!x.archived_at)}
export async function getVehicleById(id:string):Promise<VehicleWithRelations>{const{data,error}=await getSupabaseClient().from("vehicles").select(select).eq("id",id).single();if(error)throw error;return data as VehicleWithRelations}
export async function createVehicle(input:VehicleInput):Promise<Vehicle>{for(let i=0;i<5;i++){const{data,error}=await getSupabaseClient().from("vehicles").insert({...input,vehicle_number:`VEH-${String(Math.floor(Math.random()*10000)).padStart(4,"0")}`}).select().single();if(!error)return data;if(error.code!=="23505")throw error}throw new Error("A unique vehicle number could not be generated.")}
export async function updateVehicle(id:string,input:VehicleUpdate):Promise<Vehicle>{const{data,error}=await getSupabaseClient().from("vehicles").update(input).eq("id",id).select().single();if(error)throw error;return data}
export const archiveVehicle=(id:string)=>updateVehicle(id,{status:"Archived",archived_at:new Date().toISOString()});
