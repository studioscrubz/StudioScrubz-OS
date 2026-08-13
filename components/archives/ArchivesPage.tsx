"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { canPermanentlyDelete } from "@/lib/auth/permissions";
import { getArchivedRecords, permanentlyDeleteArchivedRecord, restoreArchivedRecord } from "@/lib/services/archives";
import { ARCHIVE_RECORD_TYPES, type ArchivedRecord, type ArchiveRecordType } from "@/types/archive";

type Filter = "All" | ArchiveRecordType;
export function ArchivesPage() {
  const auth = useAuth();
  const [records, setRecords] = useState<ArchivedRecord[]>([]);
  const [filter, setFilter] = useState<Filter>("All");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ArchivedRecord | null>(null);
  const visible = useMemo(() => records.filter((record) => filter === "All" || record.type === filter), [filter, records]);
  async function load() { setRecords(await getArchivedRecords()); }
  useEffect(() => { let active = true; void getArchivedRecords().then((rows) => { if (active) setRecords(rows); }).catch((cause: unknown) => { console.error("Archive load failed", cause); if (active) setError(message(cause)); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  async function restore(record: ArchivedRecord) { setBusy(record.id); setError(null); try { await restoreArchivedRecord(record); await load(); setNotice(`${record.label} restored.`); } catch (cause) { console.error("Archive restore failed", cause); setError(message(cause)); } finally { setBusy(null); } }
  async function remove(record: ArchivedRecord) { setBusy(record.id); setError(null); try { await permanentlyDeleteArchivedRecord(record); setConfirming(null); await load(); setNotice(`${record.label} permanently deleted.`); } catch (cause) { console.error("Permanent deletion failed", cause); setError(message(cause)); setConfirming(null); } finally { setBusy(null); } }
  return <>
    <header className="border-b pb-7"><p className="text-xs font-extrabold uppercase tracking-[.18em] text-[#9a7a17]">Records management</p><h1 className="mt-2 text-3xl font-extrabold text-[#143d1a]">Archives</h1><p className="mt-3 text-neutral-600">View, restore, or permanently delete archived StudioScrubz records.</p></header>
    {error && <Alert text={error} />}{notice && <Alert text={notice} good />}
    <div className="mt-6 flex flex-wrap gap-2"><Tab active={filter === "All"} text="All" click={() => setFilter("All")} />{ARCHIVE_RECORD_TYPES.map((type) => <Tab key={type} active={filter === type} text={type} click={() => setFilter(type)} />)}</div>
    {loading ? <div className="mt-6 h-64 animate-pulse rounded-2xl bg-neutral-200" /> : visible.length ? <div className="mt-6 overflow-x-auto rounded-2xl border bg-white"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-[#edf1eb] text-xs uppercase text-[#143d1a]"><tr>{["Record Type", "Record", "Related", "Archived Date", "Status", "Actions"].map((label) => <th className="p-4" key={label}>{label}</th>)}</tr></thead><tbody>{visible.map((record) => <tr className="border-t" key={`${record.type}-${record.id}`}><td className="p-4 font-bold">{record.type}</td><td className="p-4 font-extrabold text-[#143d1a]">{record.label}</td><td className="p-4 text-neutral-600">{record.relatedName ?? "—"}</td><td className="p-4">{date(record.archivedAt)}</td><td className="p-4">{record.status}</td><td className="p-4"><div className="flex flex-wrap gap-2"><Link href={record.href} className={secondary}>View</Link><button disabled={busy === record.id} className={secondary} onClick={() => void restore(record)}>Restore</button>{canPermanentlyDelete(auth.profile) && <button disabled={busy === record.id} className={danger} onClick={() => setConfirming(record)}>Delete Permanently</button>}</div></td></tr>)}</tbody></table></div> : <div className="mt-6 rounded-2xl border border-dashed bg-white p-12 text-center text-neutral-500">No archived records in this category.</div>}
    {confirming && <div className="fixed inset-0 z-[100] grid place-items-center bg-[#07190a]/70 p-5"><section role="alertdialog" aria-modal="true" className="w-full max-w-lg rounded-2xl bg-white p-6"><h2 className="text-xl font-extrabold text-red-800">Permanently delete this record?</h2><p className="mt-3 text-sm text-neutral-700">This action cannot be undone. Linked business or financial history will block deletion.</p><p className="mt-3 rounded-xl bg-red-50 p-3 font-bold text-red-800">{confirming.type}: {confirming.label}</p><div className="mt-6 flex justify-end gap-2"><button className={secondary} onClick={() => setConfirming(null)}>Cancel</button><button disabled={busy === confirming.id} className={danger} onClick={() => void remove(confirming)}>Confirm Permanent Delete</button></div></section></div>}
  </>;
}
function Tab({ active, text, click }: { active: boolean; text: string; click: () => void }) { return <button onClick={click} className={`rounded-full px-3 py-2 text-xs font-bold ${active ? "bg-[#143d1a] text-white" : "border bg-white text-neutral-600"}`}>{text}</button>; }
function Alert({ text, good }: { text: string; good?: boolean }) { return <p role={good ? "status" : "alert"} className={`mt-5 rounded-xl p-4 text-sm font-bold ${good ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>{text}</p>; }
function message(value: unknown) { return value instanceof Error ? value.message : "The archive operation failed."; }
function date(value: string) { return value ? new Date(value).toLocaleString() : "—"; }
const secondary = "rounded-lg border px-3 py-2 text-xs font-bold text-[#143d1a] disabled:opacity-50";
const danger = "rounded-lg bg-red-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50";
