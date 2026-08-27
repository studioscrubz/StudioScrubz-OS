"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { WalkthroughFormModal, displayClient } from "./WalkthroughFormModal";
import { archiveWalkthrough, getWalkthroughs } from "@/lib/services/walkthroughs";
import type { EstimateDivision } from "@/types/estimate";
import type { WalkthroughWithRelations } from "@/types/walkthrough";
import { useOperationalRealtime } from "@/components/realtime/OperationalRealtimeProvider";
import { WalkthroughPricingReviewModal } from "./WalkthroughPricingReviewModal";
import { getProposals } from "@/lib/services/proposals";
import { getServiceCatalog } from "@/lib/services/serviceCatalog";
import type { ProposalWithRelations } from "@/types/proposal";
import type { ServiceCatalogBundle } from "@/types/serviceCatalog";
import { compareWalkthroughSchedule, proposalRetiresWalkthrough } from "@/lib/walkthroughWorkflow";

type DivisionFilter = "All" | EstimateDivision;
type WorkflowFilter = "All" | "New" | "Completed";

export function WalkthroughsPage() {
  const [walkthroughs, setWalkthroughs] = useState<WalkthroughWithRelations[]>([]);
  const [proposals, setProposals] = useState<ProposalWithRelations[]>([]);
  const [catalog, setCatalog] = useState<ServiceCatalogBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [division, setDivision] = useState<DivisionFilter>("All");
  const [workflow, setWorkflow] = useState<WorkflowFilter>("All");
  const [active, setActive] = useState<WalkthroughWithRelations | null>(null);
  const [reviewing, setReviewing] = useState<WalkthroughWithRelations | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => { let mounted = true; void Promise.all([getWalkthroughs(), getProposals(), getServiceCatalog()]).then(([rows, nextProposals, nextCatalog]) => { if (mounted) { setWalkthroughs(rows); setProposals(nextProposals); setCatalog(nextCatalog); } }).catch((caught: unknown) => { console.error("Walkthrough load failed", caught); if (mounted) setError(message(caught, "Walkthroughs could not be loaded.")); }).finally(() => { if (mounted) setLoading(false); }); return () => { mounted = false; }; }, []);
  useEffect(() => { const walkthroughId = new URLSearchParams(window.location.search).get("walkthroughId"); if (!walkthroughId) return; const selected = walkthroughs.find((item) => item.id === walkthroughId); if (selected) {
    // Open the existing walkthrough requested by another workflow.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActive(selected);
  } }, [walkthroughs]);

  const activeProposalByWalkthrough = useMemo(() => new Map(proposals.filter((proposal) => proposal.walkthrough_id && !proposal.archived_at).map((proposal) => [proposal.walkthrough_id!, proposal])), [proposals]);
  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return walkthroughs.filter((item) => {
      const proposal = activeProposalByWalkthrough.get(item.id);
      const retired = proposalRetiresWalkthrough(proposal?.status);
      const displayStatus = item.status === "Completed" || item.status === "Proposal Ready" ? "Completed" : "New";
      const haystack = [displayClient(item.client), item.property?.address, item.property?.property_name, item.estimate?.estimate_number, item.measurements.serviceType, item.estimate?.service_name, item.assigned_to].filter(Boolean).join(" ").toLocaleLowerCase();
      return !item.archived_at && item.status !== "Archived" && !retired && Boolean(item.walkthrough_date && item.walkthrough_time) && (!term || haystack.includes(term)) && (division === "All" || item.division === division) && (workflow === "All" || workflow === displayStatus);
    });
  }, [activeProposalByWalkthrough, division, search, walkthroughs, workflow]);
  const scheduled = useMemo(() => visible.filter((item) => item.status === "New" || item.status === "Scheduled").sort(compareWalkthroughSchedule), [visible]);
  const completed = useMemo(() => visible.filter((item) => item.status === "Completed" || item.status === "Proposal Ready").sort((a, b) => b.updated_at.localeCompare(a.updated_at)), [visible]);
  const groups = useMemo(() => groupByDate(scheduled), [scheduled]);

  async function refresh(text?: string) { const [rows, nextProposals] = await Promise.all([getWalkthroughs(), getProposals()]); setWalkthroughs(rows); setProposals(nextProposals); if (text) setNotice(text); }
  useOperationalRealtime(["walkthroughs", "estimates", "proposals"], refresh);
  async function archiveItem(item: WalkthroughWithRelations) { if (!window.confirm("Archive this walkthrough?")) return; setUpdatingId(item.id); try { await archiveWalkthrough(item.id); await refresh("Walkthrough archived successfully."); } catch (caught) { setError(message(caught, "The walkthrough could not be archived.")); } finally { setUpdatingId(null); } }

  return <>
    <header className="border-b border-[#143d1a]/10 pb-7 sm:pb-8"><p className="mb-3 text-[11px] font-extrabold uppercase tracking-[.2em] text-[#9a7a17]">Field operations</p><h1 className="text-3xl font-extrabold tracking-[-.04em] text-[#143d1a] sm:text-4xl">Walkthroughs</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-600 sm:text-base">Perform scheduled walkthroughs and move completed assessments into pricing review. Schedule appointments from Open Estimates.</p></header>
    {notice && <Alert text={notice} success dismiss={() => setNotice(null)} />}{error && <Alert text={error} />}
    <section className="mt-6 rounded-2xl border border-[#143d1a]/10 bg-white p-4 shadow-sm"><div className="grid gap-3 md:grid-cols-3"><input aria-label="Search walkthroughs" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search client, property, estimate, service, or assignee" className={filterClass} /><Filter label="Division" value={division} set={(value) => setDivision(value as DivisionFilter)} options={["All", "Residential", "Commercial"]} /><Filter label="Workflow" value={workflow} set={(value) => setWorkflow(value as WorkflowFilter)} options={["All", "New", "Completed"]} /></div></section>
    {loading ? <Loading /> : <main className="mt-7 space-y-9">
      <section aria-labelledby="scheduled-heading"><div className="flex items-end justify-between"><div><p className="text-[10px] font-extrabold uppercase tracking-[.16em] text-[#9a7a17]">Scheduled field work</p><h2 id="scheduled-heading" className="mt-1 text-xl font-extrabold text-[#143d1a]">Upcoming Walkthroughs</h2></div><span className="text-sm font-bold text-neutral-500">{scheduled.length}</span></div><div className="mt-4 space-y-6">{groups.map(([date, items]) => <DateGroup key={date} date={date} items={items} open={setActive} />)}{groups.length === 0 && <Empty text="No scheduled walkthroughs match these filters." />}</div></section>
      <section aria-labelledby="completed-heading" className="rounded-2xl border border-[#143d1a]/10 bg-[#f5f7f4] p-4 sm:p-5"><div><p className="text-[10px] font-extrabold uppercase tracking-[.16em] text-[#9a7a17]">Completed — pricing review</p><h2 id="completed-heading" className="mt-1 text-xl font-extrabold text-[#143d1a]">Awaiting Proposal Submission</h2><p className="mt-1 text-sm text-neutral-500">These stay here until their linked proposal is sent.</p></div><div className="mt-4 grid gap-3 lg:grid-cols-2">{completed.map((item) => <CompletedCard key={item.id} item={item} proposal={activeProposalByWalkthrough.get(item.id)} busy={updatingId === item.id} open={() => setActive(item)} review={() => setReviewing(item)} archive={() => void archiveItem(item)} />)}{completed.length === 0 && <Empty text="No completed walkthroughs are awaiting proposal submission." />}</div></section>
    </main>}
    {active && <WalkthroughFormModal walkthrough={active} onClose={() => setActive(null)} onSaved={() => { setActive(null); void refresh("Walkthrough updated successfully."); }} />}
    {reviewing && catalog && <WalkthroughPricingReviewModal walkthrough={reviewing} catalog={catalog} close={() => setReviewing(null)} approved={() => { setReviewing(null); void refresh("Walkthrough pricing approved."); }} />}
  </>;
}

function DateGroup({ date, items, open }: { date: string; items: WalkthroughWithRelations[]; open: (item: WalkthroughWithRelations) => void }) { return <section><header className="mb-2 flex items-center gap-3 border-b border-[#143d1a]/10 pb-2"><h3 className="text-base font-extrabold text-[#143d1a]">{friendlyDate(date)}</h3><span className="rounded-full bg-[#edf4ec] px-2 py-0.5 text-xs font-bold text-[#143d1a]">{items.length}</span></header><div className="grid gap-2">{items.map((item) => <ScheduledCard key={item.id} item={item} open={() => open(item)} />)}</div></section>; }
function ScheduledCard({ item, open }: { item: WalkthroughWithRelations; open: () => void }) { return <article className="grid gap-3 rounded-xl border border-[#143d1a]/10 bg-white p-3 shadow-sm sm:grid-cols-[110px_minmax(0,1fr)_auto] sm:items-center sm:p-4"><div><p className="text-lg font-extrabold text-[#143d1a]">{displayTime(item.walkthrough_time!)}</p><span className="mt-1 inline-block rounded-full bg-[#fff6d8] px-2 py-0.5 text-[10px] font-extrabold text-[#725b10]">NEW</span></div><div className="min-w-0"><p className="truncate text-sm font-extrabold text-[#143d1a]">{displayClient(item.client)}</p><p className="truncate text-sm text-neutral-600">{propertyLabel(item)}</p><p className="mt-1 truncate text-xs font-semibold text-neutral-500">{serviceLabel(item)} · {item.division}{item.assigned_to ? ` · ${item.assigned_to}` : " · Unassigned"}</p>{item.estimate?.estimate_number && <p className="mt-1 text-[10px] font-bold text-[#9a7a17]">{item.estimate.estimate_number}</p>}</div><button type="button" onClick={open} className="rounded-lg bg-[#143d1a] px-4 py-2.5 text-xs font-bold text-white">Open / Perform</button></article>; }
function CompletedCard({ item, proposal, busy, open, review, archive }: { item: WalkthroughWithRelations; proposal?: ProposalWithRelations; busy: boolean; open: () => void; review: () => void; archive: () => void }) { return <article className="rounded-xl border border-[#143d1a]/10 bg-white p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><span className="rounded-full bg-[#edf4ec] px-2 py-1 text-[10px] font-extrabold text-[#143d1a]">COMPLETED — PRICING REVIEW</span><p className="mt-3 truncate font-extrabold text-[#143d1a]">{displayClient(item.client)}</p><p className="truncate text-sm text-neutral-500">{propertyLabel(item)}</p><p className="mt-1 text-xs font-semibold text-neutral-500">{serviceLabel(item)} · {friendlyDate(item.walkthrough_date!)}</p></div><button type="button" onClick={open} className="rounded-lg border px-3 py-2 text-xs font-bold text-[#143d1a]">Open</button></div><div className="mt-4 flex flex-wrap gap-2">{proposal ? <Link href="/open-proposals" className="rounded-lg bg-[#143d1a] px-3 py-2 text-xs font-bold text-white">View Proposal</Link> : !item.pricing_review ? <button type="button" onClick={review} className="rounded-lg bg-[#d4af37] px-3 py-2 text-xs font-extrabold text-[#143d1a]">Review Pricing</button> : <Link href={`/proposals?walkthroughId=${encodeURIComponent(item.id)}`} className="rounded-lg bg-[#143d1a] px-3 py-2 text-xs font-bold text-white">Create Proposal</Link>}<button type="button" onClick={archive} disabled={busy} className="rounded-lg border px-3 py-2 text-xs font-bold text-neutral-500 disabled:opacity-50">Archive</button></div></article>; }

export function groupByDate(items: WalkthroughWithRelations[]): [string, WalkthroughWithRelations[]][] { const groups = new Map<string, WalkthroughWithRelations[]>(); for (const item of items) { if (!item.walkthrough_date) continue; groups.set(item.walkthrough_date, [...(groups.get(item.walkthrough_date) ?? []), item]); } return [...groups.entries()]; }
function friendlyDate(value: string): string { const today = localDate(); const tomorrow = new Date(`${today}T00:00:00`); tomorrow.setDate(tomorrow.getDate() + 1); const full = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)); if (value === today) return `Today — ${full}`; if (value === localDate(tomorrow)) return `Tomorrow — ${full}`; return full; }
function localDate(date = new Date()): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function displayTime(value: string): string { const [hours, minutes] = value.split(":").map(Number); return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, hours, minutes)); }
function propertyLabel(item: WalkthroughWithRelations): string { return item.property ? [item.property.property_name, item.property.address].filter(Boolean).join(" · ") : "Deleted Property"; }
function serviceLabel(item: WalkthroughWithRelations): string { return item.measurements.serviceType || item.estimate?.service_name || "Service not selected"; }
function Filter({ label, value, set, options }: { label: string; value: string; set: (value: string) => void; options: readonly string[] }) { return <label><span className="sr-only">{label}</span><select value={value} onChange={(event) => set(event.target.value)} className={filterClass}>{options.map((option) => <option key={option}>{option}</option>)}</select></label>; }
function Alert({ text, success, dismiss }: { text: string; success?: boolean; dismiss?: () => void }) { return <div role={success ? "status" : "alert"} className={`mt-6 flex justify-between rounded-xl border px-4 py-3 text-sm font-semibold ${success ? "border-[#143d1a]/15 bg-[#edf4ec] text-[#143d1a]" : "border-red-200 bg-red-50 text-red-700"}`}><span>{text}</span>{dismiss && <button type="button" onClick={dismiss}>×</button>}</div>; }
function Empty({ text }: { text: string }) { return <div className="rounded-xl border border-dashed border-[#143d1a]/15 px-4 py-8 text-center text-sm text-neutral-400">{text}</div>; }
function Loading() { return <div className="mt-7 space-y-4" aria-label="Loading walkthroughs"><div className="h-40 animate-pulse rounded-2xl bg-neutral-200" /><div className="h-40 animate-pulse rounded-2xl bg-neutral-200" /></div>; }
function message(error: unknown, fallback: string): string { return error instanceof Error && error.message ? error.message : fallback; }
const filterClass = "h-11 w-full rounded-lg border border-neutral-200 bg-white px-3.5 text-sm text-neutral-700 outline-none focus:border-[#d4af37] focus:ring-2 focus:ring-[#d4af37]/15";
