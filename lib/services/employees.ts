import {getSupabaseClient} from "@/lib/supabase/client";
import type {Employee,EmployeeDepartment,EmployeeInput,EmployeeUpdate} from "@/types/employee";
export async function getEmployees():Promise<Employee[]>{const{data,error}=await getSupabaseClient().from("employees").select("*").order("last_name");if(error)throw error;return data}
export async function getEmployeeById(id:string):Promise<Employee>{const{data,error}=await getSupabaseClient().from("employees").select("*").eq("id",id).single();if(error)throw error;return data}
export async function getEmployeesByDepartment(departments:EmployeeDepartment[]):Promise<Employee[]>{const{data,error}=await getSupabaseClient().from("employees").select("*").in("department",departments).order("last_name");if(error)throw error;return data}
export async function createEmployee(input:EmployeeInput):Promise<Employee>{for(let i=0;i<5;i++){const{data,error}=await getSupabaseClient().from("employees").insert({...input,employee_number:`EMP-${String(Math.floor(Math.random()*10000)).padStart(4,"0")}`}).select().single();if(!error)return data;if(error.code!=="23505")throw error}throw new Error("A unique employee number could not be generated.")}
export async function updateEmployee(id:string,input:EmployeeUpdate):Promise<Employee>{const{data,error}=await getSupabaseClient().from("employees").update(input).eq("id",id).select().single();if(error)throw error;return data}
export const archiveEmployee=(id:string)=>updateEmployee(id,{employment_status:"Archived",archived_at:new Date().toISOString()});
