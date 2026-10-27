import { getSupabaseClient } from "@/lib/supabase/client";
import { withImmediateAttentionPush } from "@/lib/push/client";

type EquipmentAssignmentRow = {
  employee_id: string;
  assigned_at: string;
  assigned_by_user_id: string | null;
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
  await withImmediateAttentionPush(async () => {
    const { error } = await client().rpc("set_job_equipment_responsibility", {
      p_job_id: jobId,
      p_employee_ids: employeeIds,
      p_reason: reason?.trim() || null,
    });
    if (error) throw new Error(error.message);
  });
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

export type EquipmentResponsibilityStatus = "Pending Assignment" | "Assigned" | "Check-Off In Progress" | "Check-Off Complete" | "Return Pending" | "Reconciled";
export type EquipmentResponsibility = {
  task_id:string; crew_id:string|null; crew_lead_employee_id:string|null;
  responsible_employee_id:string|null; responsible_name:string|null;
  status:EquipmentResponsibilityStatus; revision:number; assigned_at:string|null; updated_at:string;
};
export async function getJobEquipmentResponsibility(jobId:string): Promise<EquipmentResponsibility|null> {
  const rows=await equipmentRpc<EquipmentResponsibility[]>("get_job_equipment_responsibility",{p_job_id:jobId});
  return rows[0]??null;
}

export type EquipmentResponsibilityAttention = {
  task_id:string;job_id:string;job_number:string;crew_id:string|null;crew_lead_employee_id:string|null;
  responsible_employee_id:string|null;status:EquipmentResponsibilityStatus;revision:number;assigned_at:string|null;created_at:string;updated_at:string;
};
export const getMyEquipmentResponsibilityTasks = () => equipmentRpc<EquipmentResponsibilityAttention[]>("get_my_equipment_responsibility_tasks");

export type EquipmentNotification = {id:string;job_id:string;event_type:string;created_at:string;details:{handoff?:string;clientName?:string|null;serviceDate?:string|null}};
export const handoffJobEquipment = (jobId:string,fromId:string,toId:string,reason:string) => equipmentRpc<string>("handoff_job_equipment",{p_job_id:jobId,p_from_employee_id:fromId,p_to_employee_id:toId,p_reason:reason});
export const getMyEquipmentNotifications = () => equipmentRpc<EquipmentNotification[]>("get_my_equipment_notifications");
export const acknowledgeEquipmentHandoff = (id:string) => equipmentRpc<void>("acknowledge_equipment_handoff",{p_handoff_id:id});
