"use client";

import { useEffect, useMemo, useState } from "react";
import { WalkthroughFormModal, displayClient } from "./WalkthroughFormModal";
import { archiveWalkthrough, getWalkthroughs, updateWalkthroughStatus } from "@/lib/services/walkthroughs";
import type { EstimateDivision } from "@/types/estimate";
import { WALKTHROUGH_STATUSES, type WalkthroughStatus, type WalkthroughWithRelations } from "@/types/walkthrough";
import { ProposalLinkSummary } from "@/components/proposals/ProposalLinkSummary";
import { useOperationalRealtime } from "@/components/realtime/OperationalRealtimeProvider";

type DivisionFilter = "All" | EstimateDivision;
type StatusFilter = "All" | WalkthroughStatus;
type DateFilter = "All" | "Today" | "Upcoming" | "Past";
const ACTIVE_WALKTHROUGH_STATUSES: WalkthroughStatus[] = ["New", "Scheduled", "Completed", "Proposal Ready"];

export function WalkthroughsPage() {
  const [walkthroughs, setWalkthroughs] = useState<WalkthroughWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [division, setDivision] = useState<DivisionFilter>("All");
  const [status, setStatus] = useState<StatusFilter>("All");
  const [dateFilter, setDateFilter] = useState<DateFilter>("All");
  const [creating, setCreating] = useState(false);
  const [active, setActive] = useState<WalkthroughWithRelations | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => { let mounted = true; void getWalkthroughs().then((rows) => { if (mounted) setWalkthroughs(rows); }).catch((caught: unknown) => { console.error("Walkthrough load failed", caught); if (mounted) setError(message(caught, "Walkthroughs could not be loaded.")); }).finally(() => { if (mounted) setLoading(false); }); return () => { mounted = false; }; }, []);
  useEffect(() => {
    const walkthroughId = new URLSearchParams(window.location.search).get("walkthroughId");
    if (!walkthroughId) return;
    const selected = walkthroughs.find((item) => item.id === walkthroughId);
    if (selected) {
      // Open the existing Walkthrough editor requested by another workflow.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActive(selected);
    }
  }, [walkthroughs]);
  const summary = useMemo(() => ({ total: walkthroughs.filter((item) => !item.archived_at).length, scheduled: walkthroughs.filter((item) => !item.archived_at && item.status === "Scheduled").length, completed: walkthroughs.filter((item) => !item.archived_at && item.status === "Completed").length, proposalReady: walkthroughs.filter((item) => !item.archived_at && item.status === "Proposal Ready").length }), [walkthroughs]);
  const filtered = useMemo(() => { const term = search.trim().toLocaleLowerCase(); const today = localDate(); return walkthroughs.filter((item) => { const haystack = [displayClient(item.client), item.property?.address||"Deleted Property", item.estimate?.estimate_number, item.phone, item.email, item.assigned_to].filter(Boolean).join(" ").toLocaleLowerCase(); const dateMatch = dateFilter === "All" || (dateFilter === "Today" && item.walkthrough_date === today) || (dateFilter === "Upcoming" && Boolean(item.walkthrough_date && item.walkthrough_date > today)) || (dateFilter === "Past" && Boolean(item.walkthrough_date && item.walkthrough_date < today)); return !item.archived_at && item.status !== "Archived" && (!term || haystack.includes(term)) && (division === "All" || item.division === division) && (status === "All" || item.status === status) && dateMatch; }); }, [dateFilter, division, search, status, walkthroughs]);

  async function refresh(text?: string) { const rows = await getWalkthroughs(); setWalkthroughs(rows); if (text) setNotice(text); }
  useOperationalRealtime(["walkthroughs", "proposals"], refresh);
  async function changeStatus(item: WalkthroughWithRelations, nextStatus: WalkthroughStatus) { setUpdatingId(item.id); setError(null); try { await updateWalkthroughStatus(item.id, nextStatus); await refresh(`Walkthrough moved to ${nextStatus}.`); } catch (caught) { console.error("Walkthrough status update failed", caught); setError(message(caught, "The walkthrough status could not be updated.")); } finally { setUpdatingId(null); } }
  async function archiveItem(item: WalkthroughWithRelations) { if (!window.confirm("Archive this walkthrough?")) return; setUpdatingId(item.id); try { await archiveWalkthrough(item.id); await refresh("Walkthrough archived successfully."); } catch (caught) { console.error("Walkthrough archive failed", caught); setError(message(caught, "The walkthrough could not be archived.")); } finally { setUpdatingId(null); } }

  return <>
    <header className="flex flex-col gap-5 border-b border-[#143d1a]/10 pb-7 sm:flex-row sm:items-end sm:justify-between sm:pb-8"><div><p className="mb-3 text-[11px] font-extrabold uppercase tracking-[.2em] text-[#9a7a17]">Operations workspace</p><h1 className="text-3xl font-extrabold tracking-[-.04em] text-[#143d1a] sm:text-4xl">Walkthroughs</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-600 sm:text-base">Schedule, document, and manage StudioScrubz property walkthroughs.</p></div><button type="button" onClick={() => setCreating(true)} className="rounded-lg bg-[#143d1a] px-5 py-3 text-sm font-bold text-white shadow-[0_8px_20px_rgba(20,61,26,.18)]">New Walkthrough</button></header>
    {notice && <Alert text={notice} success dismiss={() => setNotice(null)} />}{error && <Alert text={error} />}
    <section aria-label="Walkthrough summary" className="mt-7 grid grid-cols-2 gap-4 xl:grid-cols-4"><Summary label="Total Walkthroughs" value={loading ? "—" : summary.total} /><Summary label="Scheduled" value={loading ? "—" : summary.scheduled} /><Summary label="Completed" value={loading ? "—" : summary.completed} /><Summary label="Proposal Ready" value={loading ? "—" : summary.proposalReady} /></section>
    <section className="mt-6 rounded-2xl border border-[#143d1a]/10 bg-white p-4 shadow-[0_8px_25px_rgba(20,61,26,.04)]"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(250px,1fr)_170px_170px_160px]"><label><span className="sr-only">Search walkthroughs</span><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search client, property, estimate, or assignee" className={filterClass} /></label><Filter label="Division" value={division} set={(v) => setDivision(v as DivisionFilter)} options={["All", "Residential", "Commercial"]} /><Filter label="Status" value={status} set={(v) => setStatus(v as StatusFilter)} options={["All", ...ACTIVE_WALKTHROUGH_STATUSES]} /><Filter label="Date" value={dateFilter} set={(v) => setDateFilter(v as DateFilter)} options={["All", "Today", "Upcoming", "Past"]} /></div></section>
    {loading ? <Loading /> : <Pipeline walkthroughs={filtered} updatingId={updatingId} open={setActive} changeStatus={changeStatus} archive={archiveItem} />}
    <ProposalLinkSummary source="walkthrough" />
    {creating && <WalkthroughFormModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void refresh("Walkthrough created successfully."); }} onViewDuplicate={(item) => { setCreating(false); setActive(item); }} />}
    {active && <WalkthroughFormModal walkthrough={active} onClose={() => setActive(null)} onSaved={() => { setActive(null); void refresh("Walkthrough updated successfully."); }} />}
  </>;
}

function Pipeline({ walkthroughs, updatingId, open, changeStatus, archive }: { walkthroughs: WalkthroughWithRelations[]; updatingId: string | null; open: (item: WalkthroughWithRelations) => void; changeStatus: (item: WalkthroughWithRelations, status: WalkthroughStatus) => Promise<void>; archive: (item: WalkthroughWithRelations) => Promise<void> }) { return <section aria-label="Walkthrough pipeline" className="mt-6 overflow-x-auto pb-4"><div className="grid min-w-[1040px] grid-cols-4 gap-4">{ACTIVE_WALKTHROUGH_STATUSES.map((column) => { const items = walkthroughs.filter((item) => item.status === column); return <div key={column} className="rounded-2xl border border-[#143d1a]/10 bg-[#eef1ed] p-3"><header className="mb-3 flex items-center justify-between px-1"><h2 className="text-xs font-extrabold tracking-[.1em] text-[#143d1a]">{column.toLocaleUpperCase()}</h2><span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-neutral-500">{items.length}</span></header><div className="space-y-3">{items.map((item) => <WalkthroughCard key={item.id} item={item} busy={updatingId === item.id} open={() => open(item)} change={(next) => void changeStatus(item, next)} archive={() => void archive(item)} />)}{items.length === 0 && <div className="rounded-xl border border-dashed border-[#143d1a]/15 px-3 py-8 text-center text-xs text-neutral-400">No walkthroughs</div>}</div></div>; })}</div></section>; }
function WalkthroughCard({ item, busy, open, change, archive }: { item: WalkthroughWithRelations; busy: boolean; open: () => void; change: (status: WalkthroughStatus) => void; archive: () => void }) { return <article className="rounded-xl border border-[#143d1a]/10 bg-white p-4 shadow-sm"><button type="button" onClick={open} className="w-full text-left"><p className="text-sm font-extrabold text-[#143d1a]">{displayClient(item.client)}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-neutral-500">{item.property?.address||"Deleted Property"}</p><p className="mt-2 text-xs font-bold text-[#143d1a]">{item.measurements.serviceType||item.estimate?.service_name||"Service not selected"}</p><div className="mt-3 flex items-center justify-between"><span className="rounded-full bg-[#edf4ec] px-2 py-1 text-[10px] font-bold text-[#143d1a]">{item.division}</span>{item.estimate && <span className="text-[10px] font-bold text-[#9a7a17]">{item.estimate.estimate_number}</span>}</div><dl className="mt-3 space-y-1 text-xs"><div className="flex justify-between"><dt className="text-neutral-400">Date</dt><dd className="font-semibold text-neutral-600">{item.walkthrough_date ? displayDate(item.walkthrough_date) : "—"}</dd></div><div className="flex justify-between"><dt className="text-neutral-400">Time</dt><dd className="font-semibold text-neutral-600">{item.walkthrough_time ? displayTime(item.walkthrough_time) : "—"}</dd></div><div className="flex justify-between"><dt className="text-neutral-400">Assigned</dt><dd className="max-w-28 truncate font-semibold text-neutral-600">{item.assigned_to || "Unassigned"}</dd></div></dl></button><div className="mt-4 border-t border-neutral-100 pt-3"><select aria-label="Change walkthrough status" value={item.status} onChange={(e) => change(e.target.value as WalkthroughStatus)} disabled={busy} className="h-9 w-full rounded-lg border border-neutral-200 px-2 text-xs font-bold text-neutral-600">{WALKTHROUGH_STATUSES.map((status) => <option key={status}>{status}</option>)}</select>{item.status !== "Archived" && <button type="button" onClick={archive} disabled={busy} className="mt-2 w-full text-center text-xs font-bold text-neutral-400 hover:text-red-700">Archive</button>}</div></article>; }
function Summary({ label, value }: { label: string; value: number | string }) { return <article className="rounded-2xl border border-[#143d1a]/10 bg-white p-5 shadow-[0_8px_25px_rgba(20,61,26,.045)]"><p className="text-[10px] font-extrabold uppercase tracking-[.1em] text-neutral-500 sm:text-xs">{label}</p><p className="mt-5 text-3xl font-extrabold text-[#143d1a]">{value}</p></article>; }
function Filter({ label, value, set, options }: { label: string; value: string; set: (value: string) => void; options: readonly string[] }) { return <label><span className="sr-only">{label}</span><select value={value} onChange={(e) => set(e.target.value)} className={filterClass}>{options.map((option) => <option key={option}>{option}</option>)}</select></label>; }
function Alert({ text, success, dismiss }: { text: string; success?: boolean; dismiss?: () => void }) { return <div role={success ? "status" : "alert"} className={`mt-6 flex justify-between rounded-xl border px-4 py-3 text-sm font-semibold ${success ? "border-[#143d1a]/15 bg-[#edf4ec] text-[#143d1a]" : "border-red-200 bg-red-50 text-red-700"}`}><span>{text}</span>{dismiss && <button type="button" onClick={dismiss}>×</button>}</div>; }
function Loading() { return <div className="mt-6 grid grid-cols-4 gap-4" aria-label="Loading walkthroughs">{ACTIVE_WALKTHROUGH_STATUSES.map((item) => <div key={item} className="h-64 animate-pulse rounded-2xl bg-neutral-200" />)}</div>; }
function displayDate(value: string): string { return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)); }
function displayTime(value: string): string { const [hours, minutes] = value.split(":").map(Number); return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, hours, minutes)); }
function localDate(): string { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; }
function message(error: unknown, fallback: string): string { return error instanceof Error && error.message ? error.message : fallback; }
const filterClass = "h-11 w-full rounded-lg border border-neutral-200 bg-white px-3.5 text-sm text-neutral-700 outline-none focus:border-[#d4af37] focus:ring-2 focus:ring-[#d4af37]/15";
