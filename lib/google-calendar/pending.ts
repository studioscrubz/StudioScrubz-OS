export type PendingCalendarState = {
  queueStatus: string | null;
  eventId: string | null;
  jobStatus: string | null;
  connected: boolean;
  autoCreateEvents: boolean;
  syncJobChanges: boolean;
  cancelOnCancellation: boolean;
};
export type PendingCalendarResult = { processed:true; result:unknown } | { processed:false; skipped:string };

export function pendingCalendarSkipReason(state:PendingCalendarState):string|null {
  if (!state.queueStatus) return "no_queue_work";
  if (state.queueStatus === "Unscheduled") return "unscheduled";
  if (state.queueStatus === "Synced" || state.queueStatus === "Warning") return "already_synced";
  if (state.queueStatus === "Cancelled") return "already_cancelled";
  if (state.queueStatus !== "Pending") return "not_pending";
  if (!state.connected) return "not_connected";
  if (state.jobStatus === "Cancelled") return state.cancelOnCancellation || state.syncJobChanges ? null : "automatic_sync_disabled";
  if (state.eventId) return state.syncJobChanges ? null : "automatic_sync_disabled";
  return state.autoCreateEvents || state.syncJobChanges ? null : "automatic_sync_disabled";
}

export async function runPendingJobCalendarSync(state:PendingCalendarState,sync:()=>Promise<unknown>):Promise<PendingCalendarResult>{
  const skipped=pendingCalendarSkipReason(state);
  if(skipped)return{processed:false,skipped};
  return{processed:true,result:await sync()};
}
