"use client";

import { useEffect, useMemo, useState } from "react";
import { getBusinessSettings } from "@/lib/services/businessSettings";
import type { CompletedJobMasterTimeInput } from "@/lib/services/jobs";
import type { JobWithRelations } from "@/types/job";

export function JobMasterTimeEditor({
  job,
  canEdit,
  busy,
  save,
}: {
  job: JobWithRelations;
  canEdit: boolean;
  busy: boolean;
  save: (input: CompletedJobMasterTimeInput, onError: (detail: string) => void) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const [loadingZone, setLoadingZone] = useState(true);
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!canEdit || job.status !== "Completed") return;
    let active = true;
    void getBusinessSettings()
      .then((settings) => { if (active) setTimeZone(settings.timezone || "UTC"); })
      .catch((cause: unknown) => {
        console.error("Business timezone load failed", cause);
        if (active) setError("The business timezone could not be loaded.");
      })
      .finally(() => { if (active) setLoadingZone(false); });
    return () => { active = false; };
  }, [canEdit, job.status]);

  function beginEditing() {
    if (!timeZone) return;
    const start = timestampParts(job.operational_started_at, timeZone);
    const end = timestampParts(job.operational_ended_at, timeZone);
    setStartDate(start.date);
    setStartTime(start.time);
    setEndDate(end.date);
    setEndTime(end.time);
    setError(null);
    setEditing(true);
  }

  const duration = useMemo(() => enteredDuration(startDate, startTime, endDate, endTime), [startDate, startTime, endDate, endTime]);
  if (!canEdit || job.status !== "Completed") return null;

  async function submit() {
    setError(null);
    if (!startDate || !startTime) return setError("Job Start date and time are required.");
    if (!endDate || !endTime) return setError("Job End date and time are required for Completed Jobs.");
    if (duration === null) return setError("Job End cannot be before Job Start.");
    setSaving(true);
    const saved = await save({ startDate, startTime, endDate, endTime }, setError);
    if (saved) setEditing(false);
    setSaving(false);
  }

  const hasMasterTime = Boolean(job.operational_started_at || job.operational_ended_at);
  return (
    <section className="mt-3 rounded-xl border border-neutral-200 bg-[#f6f8f5] p-4">
      {!editing ? (
        <button disabled={busy || loadingZone || !timeZone} onClick={beginEditing} className={secondary}>
          {hasMasterTime ? "EDIT JOB TIME" : "ADD JOB TIME"}
        </button>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h4 className="font-extrabold text-[#143d1a]">Master Job Time</h4><p className="mt-1 text-xs text-neutral-500">Business timezone: {timeZone}</p></div>
            <button disabled={busy} onClick={() => setEditing(false)} className={secondary}>Cancel</button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Job Start Date" type="date" value={startDate} set={setStartDate} />
            <Field label="Job Start Time" type="time" value={startTime} set={setStartTime} />
            <Field label="Job End Date" type="date" value={endDate} set={setEndDate} />
            <Field label="Job End Time" type="time" value={endTime} set={setEndTime} />
          </div>
          <p className="mt-3 text-sm font-bold text-[#143d1a]">Actual Job Duration: {duration === null ? "—" : duration}</p>
          <p className="mt-1 text-xs text-neutral-500">This changes master Job time only. Employee labor entries are not changed.</p>
          {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}
          <button disabled={busy || saving} onClick={() => void submit()} className={`${primary} mt-4`}>{busy || saving ? "Saving…" : "SAVE JOB TIME"}</button>
        </>
      )}
      {!editing && error && <p role="alert" className="mt-3 text-sm font-bold text-red-700">{error}</p>}
    </section>
  );
}

function Field({ label, type, value, set }: { label: string; type: "date" | "time"; value: string; set: (value: string) => void }) {
  return <label className="text-sm font-bold">{label}<input required type={type} value={value} onChange={(event) => set(event.target.value)} className={`${input} mt-2`} /></label>;
}
function timestampParts(value: string | null, timeZone: string) {
  if (!value) return { date: "", time: "" };
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}
function enteredDuration(startDate: string, startTime: string, endDate: string, endTime: string) {
  if (!startDate || !startTime || !endDate || !endTime) return "—";
  const milliseconds = Date.parse(`${endDate}T${endTime}:00Z`) - Date.parse(`${startDate}T${startTime}:00Z`);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return null;
  const minutes = Math.floor(milliseconds / 60_000);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
const input = "h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#d4af37]";
const primary = "rounded-lg bg-[#143d1a] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50";
const secondary = "rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-bold text-[#143d1a] disabled:opacity-50";
