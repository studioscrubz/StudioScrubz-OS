import { getSupabaseClient } from "@/lib/supabase/client";

export type EquipmentCheckpoint = "End Job" | "Final Sign Out";
export type EquipmentItem = { name: string; kind: "Equipment" | "Supply"; status: "Checked" | "Not Needed" | "Missing"; description?: string };
export type EquipmentDraftItem = Omit<EquipmentItem,"status"> & { status:EquipmentItem["status"]|"Pending" };
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

type ChecklistRow = {name:string;kind:"Equipment"|"Supply";status:EquipmentDraftItem["status"];description:string|null;submitted:boolean};
export async function getSavedEquipmentChecklist(jobId:string,checkpoint:EquipmentCheckpoint):Promise<ChecklistRow[]> {
  const {data,error}=await (getSupabaseClient() as unknown as {rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:{message:string}|null}>}).rpc("get_my_job_equipment_checklist",{p_job_id:jobId,p_checkpoint:checkpoint});
  if(error) throw new Error(error.message);
  return (data??[]) as ChecklistRow[];
}
export async function saveEquipmentChecklistProgress(jobId:string,checkpoint:EquipmentCheckpoint,items:EquipmentDraftItem[]):Promise<string> {
  const {data,error}=await (getSupabaseClient() as unknown as {rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:{message:string}|null}>}).rpc("save_job_equipment_checklist_progress",{p_job_id:jobId,p_checkpoint:checkpoint,p_items:items});
  if(error) throw new Error(error.message);
  if(typeof data!=="string") throw new Error("Checklist progress confirmation was not returned.");
  return data;
}

export type PendingEquipmentSignout = { job_id: string; job_number: string };
export async function getPendingEquipmentSignouts(): Promise<PendingEquipmentSignout[]> {
  const rpcClient = getSupabaseClient() as unknown as {
    rpc: (name: "get_my_pending_equipment_signouts") => Promise<{
      data: PendingEquipmentSignout[] | null; error: { message: string } | null;
    }>;
  };
  const { data, error } = await rpcClient.rpc("get_my_pending_equipment_signouts");
  if (error) throw new Error(error.message);
  return data ?? [];
}
