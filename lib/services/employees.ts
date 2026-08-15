import { getSupabaseClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/services/auth";
import { isMasterAdmin } from "@/lib/auth/permissions";
import type { Employee, EmployeeDepartment, EmployeeInput, EmployeeUpdate } from "@/types/employee";

export async function getEmployees(): Promise<Employee[]> {
  const profile = await getCurrentProfile();
  if (isMasterAdmin(profile)) {
    const { data,error }=await getSupabaseClient().from("employees").select("*").order("last_name"); if(error)throw error; return data;
  }
  if (profile?.role === "Sales") {
    const { data,error }=await getSupabaseClient().from("employee_directory_sales_safe").select("*").order("last_name"); if(error)throw error;
    return data.map((row) => safeEmployee({ ...row, hire_date: null, notes: null }));
  }
  const { data,error }=await getSupabaseClient().from("employee_directory_safe").select("*").order("last_name"); if(error)throw error;
  return data.map(safeEmployee);
}
export async function getEmployeeById(id:string):Promise<Employee>{const rows=await getEmployees();const row=rows.find((employee)=>employee.id===id);if(!row)throw new Error("Employee not found or access denied.");return row}
export async function getEmployeesByDepartment(departments:EmployeeDepartment[]):Promise<Employee[]>{return(await getEmployees()).filter((employee)=>departments.includes(employee.department))}
export async function createEmployee(input:EmployeeInput):Promise<Employee>{
  if(isMasterAdmin(await getCurrentProfile())){for(let i=0;i<5;i++){const{data,error}=await getSupabaseClient().from("employees").insert({...input,employee_number:number()}).select().single();if(!error)return data;if(error.code!=="23505")throw error}throw new Error("A unique employee number could not be generated.")}
  const{data,error}=await getSupabaseClient().rpc("admin_operational_create_employee",{p_employee_number:number(),...operationalArgs(input)});if(error)throw error;return safeEmployee(data);
}
export async function updateEmployee(id:string,input:EmployeeUpdate):Promise<Employee>{
  if(isMasterAdmin(await getCurrentProfile())){const{data,error}=await getSupabaseClient().from("employees").update(input).eq("id",id).select().single();if(error)throw error;return data}
  const current=await getEmployeeById(id);const merged={...current,...input};const{data,error}=await getSupabaseClient().rpc("admin_operational_update_employee",{p_employee_id:id,...operationalArgs(merged),p_archive:false});if(error)throw error;return safeEmployee(data);
}
export async function archiveEmployee(id:string){
  if(isMasterAdmin(await getCurrentProfile()))return updateEmployee(id,{employment_status:"Archived",archived_at:new Date().toISOString()});
  const current=await getEmployeeById(id);const{data,error}=await getSupabaseClient().rpc("admin_operational_update_employee",{p_employee_id:id,...operationalArgs(current),p_archive:true});if(error)throw error;return safeEmployee(data);
}
function operationalArgs(input:EmployeeInput|Employee){return{p_first_name:input.first_name,p_last_name:input.last_name,p_preferred_name:input.preferred_name,p_email:input.email,p_phone:input.phone,p_department:input.department,p_job_title:input.job_title,p_employment_status:input.employment_status,p_employment_type:input.employment_type,p_hire_date:input.hire_date,p_notes:input.notes}}
function safeEmployee(row:Omit<Employee,"hourly_rate"|"overtime_rate"|"commission_rate">):Employee{return{...row,hourly_rate:0,overtime_rate:0,commission_rate:0}}
function number(){return`EMP-${String(Math.floor(Math.random()*10000)).padStart(4,"0")}`}
