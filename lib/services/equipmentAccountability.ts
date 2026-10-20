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
  if (!employeeIds.length) throw new Error("Select at least one equipment custodian.");
  const { error } = await client().rpc("set_job_equipment_responsibility", {
    p_job_id: jobId,
    p_employee_ids: employeeIds,
    p_reason: reason?.trim() || null,
  });
  if (error) throw new Error(error.message);
}
