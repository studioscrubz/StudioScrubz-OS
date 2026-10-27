"use client";

import { useCallback, useEffect, useState } from "react";
import { getCurrentPosition } from "@/lib/geo/currentPosition";
import {
  approveJobsiteGpsException,
  getJobsiteGpsSummary,
  registerJobPropertyGpsByCrewLead,
  verifyJobsiteArrival,
  type JobsiteGpsSummary,
} from "@/lib/services/jobsiteGps";

type AssignedEmployee = { id: string; name: string };
type Props = {
  jobId: string;
  propertyId: string | null;
  employeeId: string | null;
  management: boolean;
  isAssignedCrewLead: boolean;
  assigned: boolean;
  assignedEmployees: AssignedEmployee[];
};

export function JobsiteGpsVerification({ jobId, propertyId, employeeId, management, isAssignedCrewLead, assigned, assignedEmployees }: Props) {
  const [summary, setSummary] = useState<JobsiteGpsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [radius, setRadius] = useState("250");
  const [exceptionEmployee, setExceptionEmployee] = useState("");
  const [exceptionReason, setExceptionReason] = useState("");
  const refresh = useCallback(async () => {
    try { setSummary(await getJobsiteGpsSummary(jobId)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Job-site verification unavailable."); }
  }, [jobId]);
  useEffect(() => {
    let live = true;
    getJobsiteGpsSummary(jobId)
      .then(result => {
        if (live) { setSummary(result); setError(null); }
      })
      .catch(error => {
        if (live) setError(error instanceof Error ? error.message : "Job-site verification unavailable.");
      });
    return () => { live = false; };
  }, [jobId]);

  if (!management && (!assigned || !employeeId)) return null;

  async function verify() {
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await verifyJobsiteArrival(jobId, await getCurrentPosition());
      setNotice(result.result === "Within Radius"
        ? `GPS arrival matches the configured job site (${Math.round(result.distanceMeters)} m from the reference).`
        : `You are outside the configured site radius (${Math.round(result.distanceMeters)} m away). Contact your manager if needed.`);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "GPS check failed."); }
    finally { setBusy(false); }
  }

  async function configure() {
    if (!propertyId) return setError("This job has no linked property.");
    if (!window.confirm("Set this property's job-site location from your CURRENT device GPS? Only do this while physically on site.")) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await registerJobPropertyGpsByCrewLead(jobId, await getCurrentPosition(), Number(radius));
      setNotice("Job-site reference saved. This location is shared by jobs at the same property.");
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Property GPS setup failed."); }
    finally { setBusy(false); }
  }

  async function exception() {
    setBusy(true); setError(null); setNotice(null);
    try {
      if (!exceptionEmployee || exceptionReason.trim().length < 15) throw new Error("Choose an assigned employee and provide at least 15 characters explaining the exception.");
      await approveJobsiteGpsException(jobId, exceptionEmployee, exceptionReason.trim());
      setExceptionReason("");
      setNotice("Management exception saved to an immutable audit record. It is not a verified GPS arrival.");
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Exception could not be saved."); }
    finally { setBusy(false); }
  }

  return <section className="mt-2 rounded-lg border border-[#143d1a]/15 bg-[#f6f8f5] p-3" aria-label="Job-site GPS verification">
    <h3 className="font-extrabold text-[#143d1a]">Job-site GPS arrival</h3>
    <details className="mt-1 text-xs text-neutral-600"><summary className="cursor-pointer font-medium">How GPS verification works</summary><p className="mt-1">GPS is requested only when you tap Verify. No background tracking; the arrival record stores distance, accuracy and time, not exact coordinates. The assigned Crew Lead must verify onsite arrival before starting. This does not start jobs or change payroll.</p></details>
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {!summary ? <p className="mt-3 text-sm text-neutral-600">Loading job-site verification…</p> : <>
      <p className="mt-3 text-sm font-semibold">
        {summary.configured ? `Location configured · ${summary.radiusMeters} m radius` : "Job-site reference not configured — Job Start blocked"}
      </p>
      {!summary.configured && <p role="alert" className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs font-semibold text-amber-950">Register property GPS onsite, then verify Crew Lead arrival before START JOB. A manager exception does not register GPS.</p>}
      {summary.lastCheck && <p className="mt-2 text-sm">Your last check: <strong>{summary.lastCheck.result}</strong> · {Math.round(summary.lastCheck.distanceMeters)} m from property reference · accuracy ±{Math.round(summary.lastCheck.accuracyMeters)} m</p>}
      {assigned && employeeId && summary.configured && <button type="button" disabled={busy} className="mt-3 rounded-lg bg-[#143d1a] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50" onClick={() => void verify()}>
        {busy ? "Checking…" : "Verify my arrival using GPS"}
      </button>}
      {(management || isAssignedCrewLead) && <>
        {isAssignedCrewLead && !summary.configured && <div className="mt-4 rounded-lg border border-[#143d1a]/15 bg-white p-3">
          <p className="text-sm font-bold text-[#143d1a]">Crew Lead: register property GPS</p>
          <p className="mt-1 text-xs text-neutral-600">Use your device at the actual property. This avoids paid address geocoding and prevents guessing coordinates.</p>
          <label className="mt-3 block text-sm font-semibold">Allowed radius
            <select className="mt-1 block rounded border px-3 py-2" value={radius} onChange={e => setRadius(e.target.value)}>
              <option value="150">150 meters</option>
              <option value="250">250 meters</option>
              <option value="350">350 meters</option>
              <option value="500">500 meters</option>
            </select>
          </label>
          <button type="button" disabled={busy || !propertyId} className="mt-3 rounded-lg border border-[#143d1a] px-4 py-2 text-sm font-bold text-[#143d1a] disabled:opacity-50" onClick={() => void configure()}>
            {summary.configured ? "Update property GPS at my current location" : "Set property GPS from my current location"}
          </button>
        </div>}

        {management && assignedEmployees.length > 0 && <details className="mt-2 rounded-lg border bg-white p-2">
          <summary className="cursor-pointer text-xs font-semibold text-[#143d1a]">Manager exception (not GPS verified)</summary>
          <label className="mt-2 block text-xs font-bold">Assigned employee
            <select className="mt-1 block w-full rounded border px-3 py-2 text-sm" value={exceptionEmployee} onChange={e => setExceptionEmployee(e.target.value)}>
              <option value="">Choose employee</option>
              {assignedEmployees.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
          <label className="mt-2 block text-xs font-bold">Reason for exception
            <textarea className="mt-1 block w-full rounded border px-3 py-2 text-sm" maxLength={2000} rows={2} value={exceptionReason} onChange={e => setExceptionReason(e.target.value)} placeholder="Explain why GPS verification could not be completed…" />
          </label>
          <button type="button" disabled={busy || !exceptionEmployee || exceptionReason.trim().length < 15} className="mt-3 rounded-lg bg-[#143d1a] px-4 py-2 text-sm font-bold text-white disabled:opacity-50" onClick={() => void exception()}>Record exception</button>
        </details>}
        {summary.employeeChecks.length > 0 && <div className="mt-3 text-xs text-neutral-600">Recorded employee checks: {summary.employeeChecks.length}</div>}
        {summary.exceptions.length > 0 && <div className="mt-1 text-xs text-neutral-600">Recorded exceptions: {summary.exceptions.length}</div>}
      </>}
    </>}
  </section>;
}
