"use client";

import { useState } from "react";
import { getEstimateApprovalHistory, reviewEstimateApproval, submitEstimateForApproval, type EstimateApprovalHistoryRow } from "@/lib/services/estimates";
import { hasPermission } from "@/lib/auth/permissions";
import type { EstimateWithRelations } from "@/types/estimate";
import type { UserProfile } from "@/types/auth";

export function EstimateApprovalControls({ estimate, profile, onChanged }: {
  estimate: EstimateWithRelations;
  profile: UserProfile | null;
  onChanged: (message: string) => void | Promise<void>;
}) {
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<string|null>(null);
  const [history,setHistory] = useState<EstimateApprovalHistoryRow[]|null>(null);
  const canReview = hasPermission(profile,"estimates.approve");
  const canSubmit = hasPermission(profile,"estimates.edit") || canReview;
  const isActive = !estimate.archived_at && estimate.status === "Open";
  const status = estimate.approval_status ?? "Draft";

  async function submit() {
    setBusy(true);setError(null);
    try { await submitEstimateForApproval(estimate.id); await onChanged("Estimate submitted for Manager approval."); }
    catch(e) { setError(e instanceof Error ? e.message : "Could not submit estimate."); }
    finally { setBusy(false); }
  }
  async function decide(decision:"Approved"|"Changes Requested") {
    const notes = decision === "Changes Requested" ? window.prompt("What needs to be changed? Include enough detail for Sales to revise.") : null;
    if (decision === "Changes Requested" && !notes?.trim()) return;
    if (decision === "Approved" && !window.confirm("Approve this exact estimate pricing version for customer delivery?")) return;
    setBusy(true);setError(null);
    try { await reviewEstimateApproval(estimate.id,decision,notes); await onChanged(decision==="Approved"?"Estimate approved for delivery.":"Changes requested from Sales."); }
    catch(e) { setError(e instanceof Error ? e.message : "Review failed."); }
    finally { setBusy(false); }
  }
  async function toggleHistory() {
    if (history) { setHistory(null);return; }
    setBusy(true);setError(null);
    try { setHistory(await getEstimateApprovalHistory(estimate.id)); }
    catch(e) { setError(e instanceof Error ? e.message : "Could not load review history."); }
    finally { setBusy(false); }
  }
  return <div className="min-w-[170px] space-y-1.5 text-xs">
    <div className="font-bold text-[#143d1a]">{status} · v{estimate.approval_version??1}</div>
    {estimate.approval_notes&&<p className="max-w-52 whitespace-pre-wrap text-amber-800">{estimate.approval_notes}</p>}
    <div className="flex flex-wrap gap-1.5">
      {isActive&&canSubmit&&(status==="Draft"||status==="Changes Requested")&&
        <button disabled={busy} onClick={()=>void submit()} className="rounded border border-[#143d1a] px-2 py-1 font-semibold text-[#143d1a] disabled:opacity-50">Submit for Approval</button>}
      {isActive&&canReview&&status==="Pending Approval"&&<>
        <button disabled={busy} onClick={()=>void decide("Approved")} className="rounded bg-[#143d1a] px-2 py-1 font-semibold text-white disabled:opacity-50">Approve</button>
        <button disabled={busy} onClick={()=>void decide("Changes Requested")} className="rounded border border-amber-400 px-2 py-1 font-semibold text-amber-800 disabled:opacity-50">Request Changes</button>
      </>}
      <button disabled={busy} onClick={()=>void toggleHistory()} className="rounded border border-neutral-200 px-2 py-1 text-neutral-700">History</button>
    </div>
    {history&&<div className="max-w-64 space-y-1 border-t pt-2 text-neutral-600">
      {history.length===0?"No reviews recorded":history.map(row=><p key={row.id} className="whitespace-pre-wrap">{row.action} · v{row.version} · {new Date(row.created_at).toLocaleDateString()} · Reviewer {row.actor_id.slice(0,8)}{row.notes&&` — ${row.notes}`}</p>)}
    </div>}
    {error&&<p role="alert" className="max-w-52 text-red-700">{error}</p>}
  </div>;
}
