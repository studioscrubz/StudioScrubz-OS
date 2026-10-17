"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { PageHeader } from "@/components/layout/PageHeader";
import { getEmployeeEmailWorkspace, previewEmployeeEmail, sendEmployeeEmail } from "@/lib/services/employeeEmails";
import type { EmployeeDepartment } from "@/types/employee";
import type { EmployeeEmailPreview, EmployeeEmailSelection, EmployeeEmailWorkspace } from "@/types/employeeEmail";

export function EmployeeEmailPage() {
  const { profile } = useAuth();
  const [workspace, setWorkspace] = useState<EmployeeEmailWorkspace | null>(null);
  const [mode, setMode] = useState<"selected" | "department">("selected");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [department, setDepartment] = useState<EmployeeDepartment>("Scrub Technicians");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<EmployeeEmailPreview | null>(null);
  const [requestId, setRequestId] = useState("");
  const [bulkConfirmed, setBulkConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const authorized = profile?.is_active === true && (profile.role === "Master Admin" || profile.role === "Administrator");

  async function load() { const result = await getEmployeeEmailWorkspace(); setWorkspace(result); }
  useEffect(() => { if (!authorized) { setLoading(false); return; } let active = true; void getEmployeeEmailWorkspace().then((result) => { if (active) setWorkspace(result); }).catch((cause) => { if (active) setError(messageFrom(cause)); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [authorized]);

  const selection = useMemo<EmployeeEmailSelection>(() => mode === "department" ? { mode, department } : { mode, employeeIds: selectedIds }, [department, mode, selectedIds]);
  function changed() { setPreview(null); setBulkConfirmed(false); setRequestId(""); setNotice(null); }
  function toggle(id: string) { changed(); setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]); }

  if (!authorized) return <section className="rounded-2xl border bg-white p-10 text-center"><h1 className="text-2xl font-extrabold text-[#143d1a]">Unauthorized</h1><p className="mt-3 text-neutral-600">Only an active Master Admin or Administrator can send employee email.</p></section>;
  return <>
    <PageHeader title="Employee Email" description="Send private, individually addressed StudioScrubz email to active employees and review provider acceptance history." />
    {error && <Alert tone="error">{error}</Alert>}{notice && <Alert tone="success">{notice}</Alert>}
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-7">
        <h2 className="text-lg font-extrabold text-[#143d1a]">Compose employee email</h2>
        <div className="mt-5 flex flex-wrap gap-3">
          <Choice active={mode === "selected"} onClick={() => { changed(); setMode("selected"); }}>Selected employees</Choice>
          <Choice active={mode === "department"} onClick={() => { changed(); setMode("department"); }}>Entire department</Choice>
        </div>
        {mode === "department" ? <label className="mt-5 block text-sm font-bold text-neutral-700">Department<select className={input} value={department} onChange={(event) => { changed(); setDepartment(event.target.value as EmployeeDepartment); }}>{workspace?.departments.map((value) => <option key={value}>{value}</option>)}</select></label>
          : <div className="mt-5"><p className="text-sm font-bold text-neutral-700">Employees</p><div className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-neutral-200">{loading ? <p className="p-4 text-sm text-neutral-500">Loading Employee Directory...</p> : workspace?.employees.map((employee) => <label key={employee.id} className={`flex items-start gap-3 border-b border-neutral-100 p-3 last:border-0 ${employee.available ? "cursor-pointer" : "bg-neutral-50 text-neutral-400"}`}><input type="checkbox" className="mt-1 size-4 accent-[#143d1a]" disabled={!employee.available} checked={selectedIds.includes(employee.id)} onChange={() => toggle(employee.id)} /><span className="min-w-0"><span className="block font-bold">{employee.name}</span><span className="block break-all text-xs">{employee.email || employee.unavailableReason}</span><span className="block text-xs">{employee.department}{!employee.available ? " - unavailable" : ""}</span></span></label>)}</div></div>}
        <label className="mt-5 block text-sm font-bold text-neutral-700">Subject<input className={input} maxLength={200} value={subject} onChange={(event) => { changed(); setSubject(event.target.value); }} /></label>
        <label className="mt-5 block text-sm font-bold text-neutral-700">Message<textarea className={`${input} min-h-48 resize-y py-3`} maxLength={10000} value={message} onChange={(event) => { changed(); setMessage(event.target.value); }} /></label>
        <div className="mt-6 flex justify-end"><button className={primary} disabled={working || (mode === "selected" && !selectedIds.length) || !subject.trim() || !message.trim()} onClick={() => void buildPreview()}>{working ? "Preparing..." : "Preview recipients"}</button></div>
      </section>

      <aside className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-extrabold text-[#143d1a]">Send preview</h2>
        {!preview ? <p className="mt-4 text-sm leading-6 text-neutral-500">Choose recipients and enter the subject and message to preview the exact server-validated recipient list.</p> : <>
          <p className="mt-4 text-sm"><b>{preview.recipientCount}</b> individual email{preview.recipientCount === 1 ? "" : "s"} will be submitted to Resend.</p>
          <div className="mt-4 max-h-52 overflow-y-auto rounded-xl border border-neutral-200">{preview.recipients.map((recipient) => <div key={recipient.employeeId} className="border-b p-3 text-sm last:border-0"><b>{recipient.name}</b><div className="break-all text-neutral-600">{recipient.email}</div><div className="text-xs text-neutral-500">{recipient.department}</div></div>)}</div>
          {preview.unavailable.length > 0 && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-sm font-bold text-amber-900">Unavailable - not included</p>{preview.unavailable.map((employee) => <p key={employee.id} className="mt-1 text-xs text-amber-900">{employee.name}: {employee.unavailableReason}</p>)}</div>}
          <div className="mt-4 rounded-xl bg-neutral-50 p-4 text-sm"><p className="font-bold text-[#143d1a]">{subject}</p><p className="mt-2 whitespace-pre-wrap text-neutral-700">{message}</p></div>
          {preview.recipientCount > 1 && <label className="mt-4 flex items-start gap-3 rounded-xl border border-[#143d1a]/20 p-3 text-sm font-semibold"><input type="checkbox" className="mt-1 size-4 accent-[#143d1a]" checked={bulkConfirmed} onChange={(event) => setBulkConfirmed(event.target.checked)} />I confirm this bulk email should be sent separately to all {preview.recipientCount} listed employees.</label>}
          <button className={`${primary} mt-5 w-full`} disabled={working || !preview.recipientCount || (preview.recipientCount > 1 && !bulkConfirmed)} onClick={() => void send()}>{working ? "Submitting..." : `Send ${preview.recipientCount} email${preview.recipientCount === 1 ? "" : "s"}`}</button>
        </>}
      </aside>
    </div>

    <section className="mt-7 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm"><div className="border-b p-5"><h2 className="text-lg font-extrabold text-[#143d1a]">Sent-email history</h2><p className="mt-1 text-xs text-neutral-500">Accepted means the email provider accepted the submission; it does not confirm inbox delivery.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-[#edf1eb] text-xs uppercase text-[#143d1a]"><tr>{["Employee","Email","Subject","Date","Sender","Provider status"].map((value) => <th key={value} className="p-4">{value}</th>)}</tr></thead><tbody>{workspace?.history.length ? workspace.history.map((row) => <tr key={row.id} className="border-t"><td className="p-4"><b>{row.employeeName}</b><div className="text-xs text-neutral-500">{row.department}</div></td><td className="p-4">{row.recipientEmail}</td><td className="p-4">{row.subject}</td><td className="p-4">{new Date(row.createdAt).toLocaleString()}</td><td className="p-4">{row.senderName}</td><td className="p-4"><Status value={row.status}/>{row.failureReason && <div className="mt-1 max-w-xs text-xs text-red-700">{row.failureReason}</div>}</td></tr>) : <tr><td colSpan={6} className="p-8 text-center text-neutral-500">No employee email history yet.</td></tr>}</tbody></table></div></section>
  </>;

  async function buildPreview() { setWorking(true); setError(null); setNotice(null); try { const result = await previewEmployeeEmail(selection); setPreview(result); setBulkConfirmed(false); setRequestId(crypto.randomUUID()); } catch (cause) { setError(messageFrom(cause)); } finally { setWorking(false); } }
  async function send() { if (!preview || !requestId) return; setWorking(true); setError(null); setNotice(null); try { const result = await sendEmployeeEmail({ requestId, selection, subject, message, confirmed: preview.recipientCount <= 1 || bulkConfirmed }); setNotice(`${result.accepted} accepted, ${result.failed} failed, and ${result.pending} pending. Provider acceptance is not inbox-delivery confirmation.`); await load(); } catch (cause) { setError(messageFrom(cause)); } finally { setWorking(false); } }
}

function Choice({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" onClick={onClick} className={`rounded-lg px-4 py-2 text-sm font-bold ${active ? "bg-[#143d1a] text-white" : "border border-neutral-200 text-[#143d1a]"}`}>{children}</button>; }
function Status({ value }: { value: "Pending" | "Accepted" | "Failed" }) { return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-extrabold ${value === "Accepted" ? "bg-green-100 text-green-800" : value === "Failed" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-900"}`}>{value}</span>; }
function Alert({ tone, children }: { tone: "error" | "success"; children: React.ReactNode }) { return <div role={tone === "error" ? "alert" : "status"} className={`mb-5 rounded-xl p-4 text-sm font-bold ${tone === "error" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-800"}`}>{children}</div>; }
function messageFrom(cause: unknown) { return cause instanceof Error ? cause.message : "Employee email operation failed."; }
const input = "mt-2 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#d4af37]";
const primary = "rounded-lg bg-[#143d1a] px-5 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50";
