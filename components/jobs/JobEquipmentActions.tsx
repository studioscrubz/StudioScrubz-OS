"use client";

import { useCallback, useEffect, useState } from "react";
import { EquipmentClearanceChecklist } from "@/components/jobs/EquipmentClearanceChecklist";
import { acknowledgeEquipmentHandoff } from "@/lib/services/equipmentAccountability";
import {
  getMyPendingJobEquipmentHandoffs,
  getPendingEquipmentSignouts,
  type PendingJobEquipmentHandoff,
} from "@/lib/services/equipmentClearance";

/** Action-only UI: never render routine equipment assignment/release history. */
export function JobEquipmentActions({ jobId }: { jobId: string }) {
  const [pendingSignout, setPendingSignout] = useState(false);
  const [handoffs, setHandoffs] = useState<PendingJobEquipmentHandoff[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const [signouts, pendingHandoffs] = await Promise.all([
      getPendingEquipmentSignouts(),
      getMyPendingJobEquipmentHandoffs(jobId),
    ]);
    setPendingSignout(signouts.some(job => job.job_id === jobId));
    setHandoffs(pendingHandoffs);
    setLoaded(true);
    setError(null);
  }, [jobId]);

  useEffect(() => {
    let mounted = true;
    void refresh().catch(cause => {
      if (mounted) {
        setLoaded(true);
        setError(cause instanceof Error ? cause.message : "Equipment actions could not be loaded.");
      }
    });
    if (new URLSearchParams(window.location.search).get("equipment") === "1") {
      setExpanded(true);
      const timer = window.setTimeout(() => {
        document.getElementById(`job-equipment-actions-${jobId}`)?.scrollIntoView({ block: "center" });
      }, 80);
      return () => { mounted = false; window.clearTimeout(timer); };
    }
    return () => { mounted = false; };
  }, [jobId, refresh]);

  async function acknowledge(handoffId: string) {
    setBusyId(handoffId);
    setError(null);
    try {
      await acknowledgeEquipmentHandoff(handoffId);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Handoff acknowledgment failed.");
    } finally { setBusyId(null); }
  }

  if (!loaded) return null;
  if (!pendingSignout && handoffs.length === 0 && !error) return null;

  return <section id={`job-equipment-actions-${jobId}`} className="mt-2">
    <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)} className="rounded-lg border border-amber-200 bg-amber-50">
      <summary className="cursor-pointer px-3 py-2 text-sm font-bold text-[#143d1a]">
        Equipment &amp; Supplies · {pendingSignout ? "Final sign-out required" : `${handoffs.length} handoff(s) pending`}
      </summary>
      <div className="space-y-3 border-t border-amber-200 p-3">
        {error && <p role="alert" className="text-xs font-semibold text-red-700">{error}</p>}
        {handoffs.map(handoff => <div key={handoff.handoff_id} className="rounded-lg border bg-white p-3">
          <p className="text-sm font-bold text-[#143d1a]">Equipment handoff awaiting acknowledgment</p>
          <p className="mt-1 text-xs text-neutral-600">{handoff.reason}</p>
          <button type="button" disabled={busyId !== null} onClick={() => void acknowledge(handoff.handoff_id)}
            className="mt-2 rounded-lg bg-[#143d1a] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
            {busyId === handoff.handoff_id ? "Acknowledging…" : "Acknowledge Receipt"}
          </button>
        </div>)}
        {pendingSignout && <EquipmentClearanceChecklist jobId={jobId} checkpoint="Final Sign Out" onSubmitted={() => void refresh().catch(cause => setError(cause instanceof Error ? cause.message : "Unable to refresh equipment status."))} />}
      </div>
    </details>
  </section>;
}
