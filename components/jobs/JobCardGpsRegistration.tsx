"use client";

import { useEffect, useState } from "react";
import { getCurrentPosition } from "@/lib/geo/currentPosition";
import { getJobsiteGpsSummary, registerJobPropertyGpsByCrewLead } from "@/lib/services/jobsiteGps";

export function JobCardGpsRegistration({ jobId, onRegistered }: { jobId: string; onRegistered?: () => void }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [radius, setRadius] = useState(250);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    getJobsiteGpsSummary(jobId).then(summary => {
      if (active) { setConfigured(summary.configured); setError(null); }
    }).catch(() => {
      if (active) { setConfigured(null); setError("GPS status unavailable. Open Manage Job to check."); }
    });
    return () => { active = false; };
  }, [jobId]);
  if (configured !== false) return null;
  async function register() {
    if (!window.confirm("Register this property's GPS using your current location? Only continue while at the actual job site.")) return;
    setBusy(true);
    setError(null);
    try {
      await registerJobPropertyGpsByCrewLead(jobId, await getCurrentPosition(), radius);
      setConfigured(true);
      onRegistered?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "GPS registration failed.");
    } finally { setBusy(false); }
  }
  return <div className="flex flex-wrap items-center gap-2">
    <label className="text-xs font-semibold text-[#143d1a]">GPS radius
      <select aria-label="Property GPS radius" value={radius} onChange={e => setRadius(Number(e.target.value))} disabled={busy}
        className="ml-1 rounded-md border border-[#143d1a]/30 bg-white px-1 py-1 text-xs">
        <option value={150}>150m</option><option value={250}>250m</option><option value={350}>350m</option><option value={500}>500m</option>
      </select>
    </label>
    <button type="button" onClick={() => void register()} disabled={busy}
      className="rounded-lg border border-[#143d1a] bg-white px-3 py-2 text-xs font-bold text-[#143d1a] disabled:opacity-50">
      {busy ? "Registering GPS…" : "REGISTER PROPERTY GPS"}
    </button>
    <span className="text-xs font-semibold text-amber-800">Required before Start Job</span>
    {error && <p role="alert" className="w-full text-xs font-semibold text-red-700">{error}</p>}
  </div>;
}
