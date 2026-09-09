"use client";
import Image from "next/image";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { resolvePorterIssue, savePorterIssue, signPorterPhotos, uploadPorterPhoto } from "@/lib/services/porterReporting";
import { OPERATIONAL_PHOTO_MIME_TYPES } from "@/types/photo";
import { PORTER_ISSUE_CATEGORIES, PORTER_ISSUE_SEVERITIES, type PorterIssue, type PorterIssueInput, type PorterPhotoWithUrl } from "@/types/porterReporting";
import type { PorterVisitWithAreas } from "@/types/porterVisit";

const button = "rounded-lg border border-[#143d1a]/20 px-3 py-2 text-sm font-bold text-[#143d1a] hover:bg-[#f4f7f1] disabled:opacity-50";
const field = "mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900";
export type RunPorterReporting = (task: () => Promise<unknown>) => Promise<boolean>;
type Shared = { visit: PorterVisitWithAreas; busy: boolean; run: RunPorterReporting };

export function PorterEvidenceGroup({ visit, areaId, issue, busy, run }: Shared & { areaId: string | null; issue?: PorterIssue }) {
  const rows = useMemo(() => (visit.photos ?? []).filter(photo => !photo.archived_at && (issue ? photo.issue_id === issue.id : photo.visit_area_id === areaId)), [visit.photos, areaId, issue]);
  const [photos, setPhotos] = useState<PorterPhotoWithUrl[]>([]);
  const [previewError, setPreviewError] = useState("");
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const terminal = ["Completed", "Cancelled"].includes(visit.status);
  useEffect(() => {
    let active = true;
    const renew = () => { void signPorterPhotos(rows).then(data => { if (active) { setPhotos(data); setPreviewError(""); setFailedImages([]); } }).catch(error => { if (active) setPreviewError(error instanceof Error ? error.message : "Photo previews unavailable."); }); };
    renew(); const timer = window.setInterval(renew, 12 * 60 * 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, [rows]);
  async function renew() {
    try { setPhotos(await signPorterPhotos(rows)); setFailedImages([]); setPreviewError(""); }
    catch (error) { setPreviewError(error instanceof Error ? error.message : "Photo previews unavailable."); }
  }
  async function upload(event: FormEvent) {
    event.preventDefault(); if (!file) return;
    if (await run(() => uploadPorterPhoto({ visitId: visit.id, areaId, issueId: issue?.id ?? null, file, caption: caption.trim() || null }))) { setAdding(false); setFile(null); setCaption(""); }
  }
  const area = visit.areas.find(area => area.id === areaId);
  const required = Boolean(area?.is_required && area.requires_photo);
  const optionalPhoto = Boolean(area?.requires_photo && !area.is_required);
  return <div className="mt-3 rounded-lg bg-[#f4f7f1] p-4">
    <p className={`text-sm font-bold ${required && !rows.length ? "text-red-700" : "text-[#143d1a]"}`}>{required && !issue ? "Photo Required \u2014 " : optionalPhoto && !issue ? "Photo Requested (optional) \u2014 " : "Evidence \u2014 "}{rows.length ? `${rows.length} Photo${rows.length === 1 ? "" : "s"}` : required && !issue ? "Missing" : "No photos"}</p>
    {previewError && <p role="alert" className="mt-2 text-sm text-red-700">{previewError}</p>}
    <div className="mt-3 flex flex-wrap gap-4">{photos.map(photo => <figure key={photo.id} className="w-36 text-xs">
      {photo.signedUrl ? <a href={photo.signedUrl} target="_blank" rel="noopener noreferrer" className="block rounded-lg border bg-white p-1" aria-label={`Open photo: ${photo.caption || photo.file_name || "Visit evidence"}`}>
        {!failedImages.includes(photo.id) ? <Image unoptimized src={photo.signedUrl} alt={photo.caption || "Porter Visit evidence"} width={136} height={100} className="h-24 w-full rounded object-cover" onError={() => setFailedImages(current => [...current, photo.id])}/> : <span className="block p-3">Preview unavailable. Open original image.</span>}
      </a> : <p>Photo link unavailable. Refresh links below.</p>}
      <figcaption className="mt-2 break-words text-neutral-600">{photo.caption && <p>{photo.caption}</p>}<p>{visit.areas.find(area => area.id === photo.visit_area_id)?.name ?? "Visit-level evidence"}</p>{photo.issue_id && <p>Issue: {visit.issues?.find(item => item.id === photo.issue_id)?.title ?? "Documented issue"}</p>}<time dateTime={photo.created_at}>{new Date(photo.created_at).toLocaleString()}</time></figcaption>
    </figure>)}</div>
    <div className="mt-3 flex flex-wrap gap-2">{rows.length > 0 && <button type="button" className={button} onClick={() => void renew()}>Refresh Photo Links</button>}{!terminal && <button type="button" className={button} disabled={busy} onClick={() => setAdding(value => !value)}>Add Photo</button>}{!issue && visit.status === "In Progress" && <button type="button" className={button} disabled={busy} onClick={() => setReporting(value => !value)}>Report Issue</button>}</div>
    {adding && !terminal && <form onSubmit={upload} className="mt-4 space-y-3"><fieldset disabled={busy} className="space-y-3"><label className="block text-sm font-bold">Image (up to 10 MB)<input type="file" required accept={OPERATIONAL_PHOTO_MIME_TYPES.join(",")} className={field} onChange={event => setFile(event.target.files?.[0] ?? null)}/></label><label className="block text-sm font-bold">Caption<input className={field} value={caption} onChange={event => setCaption(event.target.value)}/></label><button type="submit" className={button}>{busy ? "Uploading…" : "Upload Photo"}</button></fieldset></form>}
    {reporting && visit.status === "In Progress" && <IssueForm visitId={visit.id} areaId={areaId} busy={busy} run={run} close={() => setReporting(false)}/>}
  </div>;
}
function IssueForm({ visitId, areaId, existing, busy, run, close }: { visitId: string; areaId: string | null; existing?: PorterIssue; busy: boolean; run: RunPorterReporting; close: () => void }) {
  const [input, setInput] = useState<PorterIssueInput>(() => existing ?? { visit_area_id: areaId, title: "", description: null, category: "Other", severity: "Medium" });
  async function submit(event: FormEvent) { event.preventDefault(); if (await run(() => savePorterIssue(visitId, input, existing))) close(); }
  return <form onSubmit={submit} className="mt-4 rounded-lg border bg-white p-4"><h4 className="font-bold text-[#143d1a]">{existing ? "Edit Issue" : "Report Issue"}</h4><fieldset disabled={busy} className="mt-3 space-y-3">
    <label className="block text-sm font-bold">Title<input required className={field} value={input.title} onChange={event => setInput(current => ({ ...current, title: event.target.value }))}/></label>
    <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-bold">Category<select className={field} value={input.category} onChange={event => setInput(current => ({ ...current, category: event.target.value as PorterIssueInput["category"] }))}>{PORTER_ISSUE_CATEGORIES.map(value => <option key={value}>{value}</option>)}</select></label><label className="text-sm font-bold">Severity<select className={field} value={input.severity} onChange={event => setInput(current => ({ ...current, severity: event.target.value as PorterIssueInput["severity"] }))}>{PORTER_ISSUE_SEVERITIES.map(value => <option key={value}>{value}</option>)}</select></label></div>
    <label className="block text-sm font-bold">Observation notes<textarea className={field} rows={3} value={input.description ?? ""} onChange={event => setInput(current => ({ ...current, description: event.target.value || null }))}/></label>
    <div className="flex gap-3"><button className={button} type="submit">Save Issue</button><button className={button} type="button" onClick={close}>Cancel</button></div>
  </fieldset></form>;
}
export function PorterIssuesSection({ visit, management, busy, run }: Shared & { management: boolean }) {
  const { profile } = useAuth();
  return <section className="mt-7"><h3 className="text-lg font-extrabold text-[#143d1a]">Issues ({visit.issues?.length ?? 0})</h3><p className="mt-2 text-sm text-neutral-600">Visual observations for management follow-up, not licensed inspections, security determinations, maintenance, repairs, code enforcement, or pool maintenance. Open issues do not block visit completion.</p>
    {!visit.issues?.length && <p className="mt-3 text-sm text-neutral-500">No issues documented.</p>}
    <div className="mt-4 space-y-4">{visit.issues?.map(issue => <IssueCard key={`${issue.id}:${issue.updated_at}`} {...{ visit, management, busy, run, issue }} canEdit={visit.status === "In Progress" && issue.status !== "Resolved" && (management || issue.reported_by === profile?.id)}/>)}</div>
  </section>;
}
function IssueCard({ issue, visit, management, busy, run, canEdit }: Shared & { issue: PorterIssue; management: boolean; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [resolution, setResolution] = useState(issue.resolution_notes ?? "");
  return <article className="rounded-xl border border-neutral-200 p-4">
    <p className={`text-sm font-bold ${["High", "Urgent"].includes(issue.severity) ? "text-red-700" : "text-[#9a7a17]"}`}>{issue.severity} · {issue.category} · {issue.status}</p><h4 className="mt-2 text-lg font-bold text-[#143d1a]">{issue.title}</h4>
    <p className="mt-2 whitespace-pre-wrap text-sm">{issue.description}</p><p className="mt-2 text-xs text-neutral-500">{visit.areas.find(area => area.id === issue.visit_area_id)?.name ?? "Visit-level observation"} · {issue.reporter_name || "Team member"} · <time dateTime={issue.reported_at}>{new Date(issue.reported_at).toLocaleString()}</time></p>
    {issue.resolution_notes && <p className="mt-3 whitespace-pre-wrap text-sm">Management notes: {issue.resolution_notes}</p>}{issue.resolved_at && <p className="mt-2 text-xs">Resolved {new Date(issue.resolved_at).toLocaleString()}</p>}
    {canEdit && <button type="button" className={`${button} mt-3`} disabled={busy} onClick={() => setEditing(value => !value)}>Edit Observation</button>}
    {editing && canEdit && <IssueForm visitId={visit.id} areaId={issue.visit_area_id} existing={issue} busy={busy} run={run} close={() => setEditing(false)}/>}
    <PorterEvidenceGroup {...{ visit, issue, busy, run }} areaId={issue.visit_area_id}/>
    {management && issue.status !== "Resolved" && <fieldset disabled={busy} className="mt-4"><label className="block text-sm font-bold">Management resolution notes<textarea className={field} value={resolution} onChange={event => setResolution(event.target.value)}/></label><div className="mt-3 flex gap-2">{issue.status === "Open" && <button type="button" className={button} onClick={() => void run(() => resolvePorterIssue(issue, "acknowledge", resolution))}>Acknowledge</button>}<button type="button" className={button} onClick={() => void run(() => resolvePorterIssue(issue, "resolve", resolution))}>Resolve</button></div></fieldset>}
  </article>;
}
