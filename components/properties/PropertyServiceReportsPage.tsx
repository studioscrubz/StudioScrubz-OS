"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { hasPermission } from "@/lib/auth/permissions";
import { deletePropertyServiceReport, getPropertyServiceReport, listPropertyServiceReports } from "@/lib/services/propertyServiceReports";
import { PorterEvidenceGroup } from "@/components/properties/PorterReporting";
import { PROPERTY_REPORT_STATUSES, summarizePropertyServiceReport } from "@/types/propertyServiceReport";
import type { PorterVisitWithAreas } from "@/types/porterVisit";

const button = "rounded-lg border border-[#143d1a]/20 px-4 py-2 text-sm font-bold text-[#143d1a] hover:bg-[#f4f7f1] disabled:opacity-50";
const field = "mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm";
const timestamp = (value: string | null) => value ? new Date(value).toLocaleString() : "Not recorded";
const calendarDate = (value: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
type Detail = Awaited<ReturnType<typeof getPropertyServiceReport>>;
const readOnly = async () => false;

export function PropertyServiceReportsPage() {
  const { profile } = useAuth();
  const allowed = hasPermission(profile, "porterVisits.manage");
  const [rows, setRows] = useState<PorterVisitWithAreas[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [property, setProperty] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  useEffect(() => {
    if (!allowed) return;
    let active = true;
    listPropertyServiceReports().then(data => { if (active) setRows(data); }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Reports could not be loaded."); });
    return () => { active = false; };
  }, [allowed]);
  async function load(id?: string) {
    setBusy(true); setError("");
    try {
      if (id) setDetail(await getPropertyServiceReport(id));
      else {
        setRows(await listPropertyServiceReports());
        if (detail) setDetail(await getPropertyServiceReport(detail.visit.id));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Reports could not be loaded."); }
    finally { setBusy(false); }
  }
  async function removeReport(id: string) {
    if (!window.confirm("Permanently delete this Property Service Report? This cannot be undone.")) return;
    setBusy(true); setError("");
    try {
      await deletePropertyServiceReport(id);
      if (detail?.visit.id === id) setDetail(null);
      setRows(rows => rows.filter(row => row.id !== id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Report could not be deleted."); }
    finally { setBusy(false); }
  }
  if (!allowed) return <p className="p-6">Property Service Reports require management access.</p>;
  const properties = Array.from(new Map(rows.map(row => [row.property_id, row.property_label])).entries());
  const filtered = rows.filter(row => {
    const date = calendarDate(row.completed_at);
    return (!property || row.property_id === property) && (!status || summarizePropertyServiceReport(row).status === status)
      && (!from || date >= from) && (!to || date <= to)
      && `${row.property_label} ${row.plan_name} ${row.crew_name ?? ""}`.toLowerCase().includes(search.toLowerCase());
  });
  return <div className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-extrabold text-[#143d1a]">Property Service Reports</h1><p className="mt-2 text-sm text-neutral-600">Review completed Porter Visits and current issue dispositions.</p></div><button className={button} disabled={busy} onClick={() => void load()}>Refresh</button></header>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {!detail ? <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-sm font-bold">Search<input className={field} value={search} onChange={event => setSearch(event.target.value)} placeholder="Property, plan or crew"/></label>
        <label className="text-sm font-bold">Property<select className={field} value={property} onChange={event => setProperty(event.target.value)}><option value="">All properties</option>{properties.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="text-sm font-bold">Report status<select className={field} value={status} onChange={event => setStatus(event.target.value)}><option value="">All statuses</option>{PROPERTY_REPORT_STATUSES.map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="text-sm font-bold">Completed from<input type="date" className={field} value={from} onChange={event => setFrom(event.target.value)}/></label>
        <label className="text-sm font-bold">Completed through<input type="date" className={field} value={to} onChange={event => setTo(event.target.value)}/></label>
      </div>
      {!filtered.length && <p>No completed visits match these filters.</p>}
      <div className="grid gap-4 lg:grid-cols-2">{filtered.map(visit => {
        const { metrics, status } = summarizePropertyServiceReport(visit);
        return <article key={visit.id} className="rounded-xl border border-neutral-200 bg-white p-5"><h2 className="font-bold text-[#143d1a]">{visit.property_label}</h2><p>{visit.plan_name}</p><p className="mt-2 text-sm font-bold">{status}</p><p className="mt-2 text-sm">Completed {timestamp(visit.completed_at)} | {visit.crew_name || "Unassigned crew"}</p><p className="mt-2 text-sm">{metrics.evidence} photos | {metrics.issues} issues | {metrics.openIssues} Open | {metrics.acknowledgedIssues} Acknowledged | {metrics.resolvedIssues} Resolved | {metrics.highUrgentIssues} High/Urgent</p><div className="mt-4 flex flex-wrap gap-3"><button className={button} disabled={busy} onClick={() => void load(visit.id)}>View Report</button><button className={button} disabled={busy} onClick={() => void removeReport(visit.id)}>Delete Report</button></div></article>;
      })}</div>
    </> : <>
      <div className="flex gap-3"><button className={button} onClick={() => setDetail(null)}>Back to Reports</button><button className={button} onClick={() => window.print()}>Print Report</button><button className={button} disabled={busy} onClick={() => void removeReport(detail.visit.id)}>Delete Report</button></div>
      <ReportDetail detail={detail}/>
    </>}
  </div>;
}

function ReportDetail({ detail }: { detail: Detail }) {
  const { visit } = detail;
  const { metrics, status } = summarizePropertyServiceReport(visit);
  const summary = [
    ["Total service areas", metrics.totalAreas], ["Service areas completed", metrics.completedAreas],
    ["Unable to Complete", metrics.unableAreas], ["Pending areas", metrics.pendingAreas],
    ["Required areas completed", `${metrics.requiredCompleted} / ${metrics.requiredAreas}`],
    ["Photo-required areas documented", `${metrics.photoRequiredDocumented} / ${metrics.photoRequiredAreas}`],
    ["Evidence photos", metrics.evidence], ["Documented issues", metrics.issues],
    ["Open issues", metrics.openIssues], ["Acknowledged issues", metrics.acknowledgedIssues],
    ["Resolved issues", metrics.resolvedIssues], ["High / Urgent issues (all dispositions)", metrics.highUrgentIssues],
  ];
  return <article className="document-print-root space-y-6 rounded-xl border border-neutral-200 bg-white p-6 text-neutral-900 print:border-0 print:p-0 print:[&_button]:hidden">
    <header><h2 className="text-2xl font-extrabold text-[#143d1a]">Property Service Report</h2><h3 className="mt-2 text-xl font-bold">{visit.property_label}</h3><p className="mt-2 font-bold">{status}</p><p className="mt-2 text-sm">Visit reference: {visit.id}</p></header>
    <section className="grid gap-3 text-sm sm:grid-cols-2"><p>Plan (visit snapshot): {visit.plan_name}</p><p>Client (current): {detail.currentClientName || "Unavailable"}</p><p>Plan frequency (current, not historical): {detail.currentFrequency || "Unavailable"}</p><p>Crew: {visit.crew_name || "Unassigned"}</p><p>Scheduled date: {visit.scheduled_date}</p><p>Visit status: {visit.status}</p><p>Started: {timestamp(visit.started_at)}</p><p>Completed: {timestamp(visit.completed_at)}</p></section>
    {detail.contextUnavailable && <p className="text-sm">Some current client/plan context could not be loaded. Historical visit data is shown below.</p>}
    <p className="whitespace-pre-wrap text-sm">Visit notes: {visit.visit_notes || "None recorded"}</p>
    <section><h3 className="text-lg font-bold text-[#143d1a]">Report Summary</h3><dl className="mt-3 grid gap-3 sm:grid-cols-3">{summary.map(([label, value]) => <div key={label} className="rounded-lg bg-[#f4f7f1] p-3"><dt className="text-sm">{label}</dt><dd className="font-bold">{value}</dd></div>)}</dl><p className="mt-3 text-xs">Unresolved service areas include Pending or Unable to Complete areas and missing required photos. Acknowledged issues remain open for follow-up until Resolved. Optional areas may remain Pending.</p></section>
    <section><h3 className="text-lg font-bold text-[#143d1a]">Service Area Results</h3>{[...visit.areas].sort((a,b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id)).map(area => <section key={area.id} className="mt-4 rounded-lg border p-4 print:break-inside-avoid"><h4 className="font-bold">{area.name}</h4><p className="text-sm">{area.is_required ? "Required" : "Optional"}{area.requires_photo ? area.is_required ? " | Photo Required" : " | Photo Requested (optional)" : ""} | {area.status}</p>{area.description && <p className="mt-2 text-sm">{area.description}</p>}<p className="mt-2 whitespace-pre-wrap text-sm">{area.notes || "No notes recorded."}</p><PorterEvidenceGroup visit={visit} areaId={area.id} busy={false} run={readOnly}/></section>)}</section>
    <section><h3 className="text-lg font-bold text-[#143d1a]">Visit-level Photo Evidence</h3><PorterEvidenceGroup visit={visit} areaId={null} busy={false} run={readOnly}/></section>
    <section><h3 className="text-lg font-bold text-[#143d1a]">Documented Issues ({metrics.issues})</h3>{!metrics.issues && <p className="mt-2 text-sm">No issues documented.</p>}{visit.issues?.map(issue => <section key={issue.id} className="mt-4 rounded-lg border p-4 print:break-inside-avoid"><p className="text-sm font-bold">{issue.severity} | {issue.category} | {issue.status}</p><h4 className="mt-2 font-bold">{issue.title}</h4><p className="mt-2 whitespace-pre-wrap text-sm">{issue.description}</p><p className="mt-2 text-sm">{visit.areas.find(area => area.id === issue.visit_area_id)?.name || "Visit-level observation"} | {issue.reporter_name || "Team member"} | {timestamp(issue.reported_at)}</p><p className="mt-2 whitespace-pre-wrap text-sm">Resolution notes: {issue.resolution_notes || "None recorded"}</p>{issue.resolved_at && <p className="text-sm">Resolved: {timestamp(issue.resolved_at)}</p>}<PorterEvidenceGroup visit={visit} areaId={issue.visit_area_id} issue={issue} busy={false} run={readOnly}/></section>)}</section>
    <p className="border-t pt-4 text-xs">This report documents routine property support activity and observations made during service. It is not a licensed inspection, maintenance certification, or code-compliance report.</p>
  </article>;
}
