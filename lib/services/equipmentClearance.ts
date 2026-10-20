import { getSupabaseClient } from "@/lib/supabase/client";

export type EquipmentCheckpoint = "End Job" | "Final Sign Out";
export type EquipmentItem = { name: string; kind: "Equipment" | "Supply"; status: "Checked" | "Not Needed" | "Missing"; description?: string };
type ClearanceRpc = {
  rpc: (name: "submit_job_equipment_clearance", args: {
    p_job_id: string; p_checkpoint: EquipmentCheckpoint; p_items: EquipmentItem[];
  }) => Promise<{ data: string | null; error: { message: string } | null }>;
};
export async function submitEquipmentClearance(jobId: string, checkpoint: EquipmentCheckpoint, items: EquipmentItem[]): Promise<string> {
  if (!items.length || items.some(item => !["Checked","Not Needed","Missing"].includes(item.status))) {
    throw new Error("Mark every checklist item before submitting.");
  }
  if (items.some(item => item.status === "Missing" && !item.description?.trim())) {
    throw new Error("Describe each missing item.");
  }
  const client = getSupabaseClient() as unknown as ClearanceRpc;
  const { data, error } = await client.rpc("submit_job_equipment_clearance", {
    p_job_id: jobId, p_checkpoint: checkpoint, p_items: items,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Clearance confirmation was not returned.");
  return data;
}
