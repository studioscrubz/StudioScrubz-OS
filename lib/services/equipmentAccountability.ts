import { getSupabaseClient } from "@/lib/supabase/client";

type EquipmentAssignmentRow = {
  employee_id: string;
  assigned_at: string;
  assigned_by_user_id: string;
};
type EquipmentRpc = {
  rpc: (
    name: "get_job_equipment_assignments" | "set_job_equipment_responsibility",
    args: { p_job_id: string; p_employee_ids?: string[]; p_reason?: string | null },
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

function client(): EquipmentRpc {
  return getSupabaseClient() as unknown as EquipmentRpc;
}

export async function getJobEquipmentAssignments(jobId: string): Promise<EquipmentAssignmentRow[]> {
  const { data, error } = await client().rpc("get_job_equipment_assignments", { p_job_id: jobId });
  if (error) throw new Error(error.message);
  return (data ?? []) as EquipmentAssignmentRow[];
}

export async function setJobEquipmentResponsibility(jobId: string, employeeIds: string[], reason?: string): Promise<void> {
  const { error } = await client().rpc("set_job_equipment_responsibility", {
    p_job_id: jobId,
    p_employee_ids: employeeIds,
    p_reason: reason?.trim() || null,
  });
  if (error) throw new Error(error.message);
}

type EquipmentAdminRpc = {
  rpc: (name: string, args?: Record<string, unknown>) => Promise<{data: unknown;error: {message:string}|null}>;
};
async function equipmentRpc<T>(name: string,args?: Record<string,unknown>): Promise<T> {
 const {data,error}=await (getSupabaseClient() as unknown as EquipmentAdminRpc).rpc(name,args);
 if(error) throw new Error(error.message);
 return data as T;
}
export type EquipmentException = { exception_id:string; employee_id:string; item_name:string; description:string; reported_at:string };
export type EquipmentCatalogItem = {item_name:string;item_kind:"Equipment"|"Supply"};
export const getEquipmentConfirmation = (jobId:string) => equipmentRpc<boolean>("get_job_equipment_confirmation",{p_job_id:jobId});
export const confirmEquipmentResponsibility = (jobId:string) => equipmentRpc<void>("confirm_job_equipment_responsibility",{p_job_id:jobId});
export const getEquipmentExceptions = (jobId:string) => equipmentRpc<EquipmentException[]>("get_open_job_equipment_exceptions",{p_job_id:jobId});
export const resolveEquipmentException = (id:string,resolution:string) => equipmentRpc<void>("resolve_job_equipment_exception",{p_exception_id:id,p_resolution:resolution});
export const getEquipmentCatalog = (jobId:string) => equipmentRpc<EquipmentCatalogItem[]>("get_job_equipment_catalog",{p_job_id:jobId});
