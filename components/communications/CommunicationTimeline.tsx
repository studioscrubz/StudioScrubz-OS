"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { hasPermission } from "@/lib/auth/permissions";
import { archiveCommunication, getClientCommunications, getCommunicationsForRecord, markCommunicationFailed, markCommunicationSent } from "@/lib/services/clientCommunications";
import { openDeviceSmsApp } from "@/lib/deviceSms";
import { COMMUNICATION_STATUSES, type ClientCommunication, type CommunicationStatus, type CommunicationType } from "@/types/clientCommunication";
import { CommunicationDetailModal } from "./CommunicationDetailModal";
import { LogCommunicationModal } from "./LogCommunicationModal";
import type { Client } from "@/types/client";

export type CommunicationTimelineProps = {
  clientId?: string; propertyId?: string; estimateId?: string; proposalId?: string; agreementId?: string; invoiceId?: string;
  client?: Client;
  initialLogType?: CommunicationType; initialServiceId?: string;
};

const FILTER_TYPES = ["All", "Estimate", "Proposal", "Service Agreement", "Service Reminder", "Invoice", "Payment Reminder", "General"] as const;

export function CommunicationTimeline(props: CommunicationTimelineProps) {
  const { profile } = useAuth();
  const canView = hasPermission(profile, "communications.view");
  const canCreate = hasPermission(profile, "communications.create");
  const canArchive = hasPermission(profile, "communications.archive");
  const [records, setRecords] = useState<ClientCommunication[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<(typeof FILTER_TYPES)[number]>("All");
  const [statusFilter, setStatusFilter] = useState<"All" | CommunicationStatus>("All");
  const [search, setSearch] = useState(""); const [showArchived, setShowArchived] = useState(false);
  const [detail, setDetail] = useState<ClientCommunication | null>(null); const [logging, setLogging] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [smsActionId, setSmsActionId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canView) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const data = props.clientId
        ? await getClientCommunications(props.clientId, showArchived)
        : await getCommunicationsForRecord({ estimateId: props.estimateId, proposalId: props.proposalId, agreementId: props.agreementId, invoiceId: props.invoiceId }, showArchived);
      setRecords(data);
    } catch (caught) { console.error("Failed to load communication history", caught); setError("Communication history could not be loaded."); }
    finally { setLoading(false); }
  }, [canView, props.agreementId, props.clientId, props.estimateId, props.invoiceId, props.proposalId, showArchived]);

  useEffect(() => {
    // Initial and filter-driven client-side hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  useEffect(() => {
    // Open the composer when the parent explicitly requests a prepared workflow.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (canCreate && props.initialLogType) setLogging(true);
  }, [canCreate, props.initialLogType]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return records.filter((item) => {
      const text = [item.communication_number, item.subject, item.message_body, item.recipient_email, item.recipient_phone].filter(Boolean).join(" ").toLowerCase();
      return (typeFilter === "All" || item.communication_type === typeFilter) && (statusFilter === "All" || item.status === statusFilter) && (!term || text.includes(term));
    });
  }, [records, search, statusFilter, typeFilter]);

  async function archive(record: ClientCommunication) {
    if (!window.confirm(`Archive ${record.communication_number}?`)) return;
    setArchivingId(record.id); setError(null);
    try { await archiveCommunication(record.id); await load(); }
    catch (caught) { console.error("Failed to archive communication", caught); setError(caught instanceof Error ? caught.message : "Communication could not be archived."); }
    finally { setArchivingId(null); }
  }

  function upsert(record: ClientCommunication) { setRecords((current) => [record, ...current.filter((item) => item.id !== record.id)]); }
  function text(record: ClientCommunication) {
    if (!record.recipient_phone) { setError("No phone number is saved for this client."); return; }
    try { openDeviceSmsApp(record.recipient_phone, record.message_body ?? ""); setNotice("Messaging app opened. Confirm the message was sent before marking it as sent."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Your device could not open a messaging app."); }
  }
  async function updateSms(record: ClientCommunication, next: "Sent" | "Failed") {
    const reason = next === "Failed" ? window.prompt("Why did the SMS handoff fail?")?.trim() : null;
    if (next === "Failed" && !reason) return;
    setSmsActionId(record.id); setError(null);
    try { const updated = next === "Sent" ? await markCommunicationSent(record.id) : await markCommunicationFailed(record.id, reason!); upsert(updated); setNotice(next === "Sent" ? "SMS marked as sent." : "SMS marked as failed."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "SMS status could not be updated."); }
    finally { setSmsActionId(null); }
  }

  if (!canView) return null;
  return <section className="rounded-2xl border border-[#143d1a]/10 bg-white shadow-[0_10px_30px_rgba(20,61,26,.05)]">
    <header className="flex flex-col gap-4 border-b border-neutral-100 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div><h3 className="text-lg font-extrabold text-[#143d1a]">Communication History</h3><p className="mt-1 text-sm text-neutral-500">Client-facing delivery and interaction history.</p></div>
      {canCreate && <button type="button" onClick={() => setLogging(true)} className="rounded-lg bg-[#143d1a] px-4 py-2.5 text-sm font-bold text-white">+ Log Communication</button>}
    </header>
    <div className="grid gap-3 border-b border-neutral-100 p-4 md:grid-cols-2 xl:grid-cols-[1fr_170px_150px_auto]">
      <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search communication history" className={filterClass} />
      <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)} className={filterClass}>{FILTER_TYPES.map((item) => <option key={item}>{item}</option>)}</select>
      <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className={filterClass}><option>All</option>{COMMUNICATION_STATUSES.map((item) => <option key={item}>{item}</option>)}</select>
      <label className="flex items-center gap-2 px-2 text-sm font-semibold text-neutral-600"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="size-4 accent-[#143d1a]" /> Show Archived</label>
    </div>
    {error && <p role="alert" className="m-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</p>}
    {notice && <p role="status" className="m-5 rounded-xl border border-green-200 bg-green-50 p-4 text-sm font-semibold text-green-800">{notice}</p>}
    {loading ? <div className="space-y-3 p-5" aria-label="Loading communication history"><div className="h-20 animate-pulse rounded-xl bg-neutral-100" /><div className="h-20 animate-pulse rounded-xl bg-neutral-100" /></div>
      : visible.length === 0 ? <div className="grid min-h-44 place-items-center p-6 text-center"><div><p className="font-extrabold text-[#143d1a]">No communication history yet.</p><p className="mt-1 text-sm text-neutral-500">Logged client interactions will appear here.</p></div></div>
      : <div className="divide-y divide-neutral-100">{visible.map((item) => <article key={item.id} className="group flex gap-4 p-5 hover:bg-[#f8faf7]">
          <span aria-hidden className={`mt-1 size-3 shrink-0 rounded-full ring-4 ${statusStyle(item.status)}`} />
          <button type="button" onClick={() => setDetail(item)} className="min-w-0 flex-1 text-left">
            <div className="flex flex-wrap items-center gap-2"><strong className="text-sm text-[#143d1a]">{item.communication_type} · {item.status}</strong><span className="text-xs text-neutral-400">{formatDate(item.sent_at ?? item.created_at)}</span>{item.archived_at && <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-bold uppercase text-neutral-500">Archived</span>}</div>
            <p className="mt-1 truncate text-sm font-semibold text-neutral-700">{item.subject || "No subject"}</p>
            <p className="mt-1 text-xs text-neutral-500">To: {item.recipient_email || item.recipient_phone || "—"} · By: {item.sent_by_name || "—"} · {item.channel} / {item.direction}</p>
            {item.failure_reason && <p className="mt-2 text-xs font-semibold text-red-700">{item.failure_reason}</p>}
          </button>
          <div className="flex shrink-0 flex-col justify-center gap-1">{canCreate && item.channel === "SMS" && item.status === "Prepared" && <><button type="button" disabled={!item.recipient_phone || smsActionId === item.id} onClick={() => text(item)} className="rounded-lg border border-[#143d1a]/20 px-3 py-2 text-xs font-bold text-[#143d1a] disabled:opacity-50">Text Client</button><button type="button" disabled={smsActionId === item.id} onClick={() => void updateSms(item, "Sent")} className="rounded-lg bg-[#143d1a] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Mark as Sent</button><button type="button" disabled={smsActionId === item.id} onClick={() => void updateSms(item, "Failed")} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-50">Mark as Failed</button></>}{canArchive && !item.archived_at && <button type="button" disabled={archivingId === item.id} onClick={() => void archive(item)} className="rounded-lg border border-neutral-200 px-3 py-2 text-xs font-bold text-neutral-500 hover:border-red-200 hover:text-red-700 disabled:opacity-50">{archivingId === item.id ? "Archiving…" : "Archive"}</button>}</div>
        </article>)}</div>}
    {detail && <CommunicationDetailModal communication={detail} onClose={() => setDetail(null)} />}
    {logging && <LogCommunicationModal links={props} client={props.client} initialType={props.initialLogType} initialServiceId={props.initialServiceId} onClose={() => setLogging(false)} onCreated={upsert} />}
  </section>;
}

function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function statusStyle(status: CommunicationStatus) { if (status === "Failed") return "bg-red-500 ring-red-100"; if (status === "Sent" || status === "Delivered" || status === "Opened") return "bg-emerald-500 ring-emerald-100"; if (status === "Cancelled" || status === "Archived") return "bg-neutral-400 ring-neutral-100"; return "bg-amber-500 ring-amber-100"; }
const filterClass = "h-11 w-full rounded-lg border border-neutral-200 bg-white px-3.5 text-sm text-neutral-700 outline-none focus:border-[#d4af37] focus:ring-2 focus:ring-[#d4af37]/15";
