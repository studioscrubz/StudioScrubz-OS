"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CatalogAddonPicker } from "@/components/serviceCatalog/CatalogAddonPicker";
import { useOperationalRealtime } from "@/components/realtime/OperationalRealtimeProvider";
import { getClients } from "@/lib/services/clients";
import { getProperties } from "@/lib/services/properties";
import { getServiceCatalog, getAvailableServiceAddons } from "@/lib/services/serviceCatalog";
import { getActiveCrews } from "@/lib/services/crews";
import { createDirectJob } from "@/lib/services/jobs";
import { calculateAddons, calculateServicePrice } from "@/lib/pricing/pricingEngine";
import { formatTime12Hour } from "@/lib/formatTime";
import { useAuth } from "@/components/auth/AuthProvider";
import { isMasterAdmin } from "@/lib/auth/permissions";
import type { Client } from "@/types/client";
import type { PropertyWithClient } from "@/types/property";
import type { CrewWithRelations } from "@/types/crew";
import type { ServiceCatalogBundle } from "@/types/serviceCatalog";

export function DirectJobModal({ close, created }: { close: () => void; created: () => Promise<void> }) {
  const { profile } = useAuth();
  const canOverridePrice = isMasterAdmin(profile);
  const [clients, setClients] = useState<Client[]>([]), [properties, setProperties] = useState<PropertyWithClient[]>([]);
  const [catalog, setCatalog] = useState<ServiceCatalogBundle | null>(null), [crews, setCrews] = useState<CrewWithRelations[]>([]);
  const [clientSearch, setClientSearch] = useState(""), [clientId, setClientId] = useState(""), [propertyId, setPropertyId] = useState("");
  const [serviceId, setServiceId] = useState(""), [addonNames, setAddonNames] = useState<string[]>([]);
  const [date, setDate] = useState(""), [time, setTime] = useState(""), [duration, setDuration] = useState(0), [laborHours, setLaborHours] = useState(0);
  const [crewId, setCrewId] = useState(""), [access, setAccess] = useState(""), [notes, setNotes] = useState("");
  const [overrideEnabled, setOverrideEnabled] = useState(false), [overridePrice, setOverridePrice] = useState("");
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState<string | null>(null);
  async function refreshOptions() { const [c, p, s, r] = await Promise.all([getClients(), getProperties(), getServiceCatalog(), getActiveCrews()]); setClients(c.filter((row) => !row.archived_at)); setProperties(p.filter((row) => !row.archived_at)); setCatalog(s); setCrews(r); }
  useOperationalRealtime(["clients", "properties", "crews", "employees", "services", "service_addons", "service_addon_links", "service_price_tiers", "recurring_pricing_rules"], refreshOptions);
  useEffect(() => { let active = true; void Promise.all([getClients(), getProperties(), getServiceCatalog(), getActiveCrews()]).then(([c, p, s, r]) => { if (active) { setClients(c.filter((row) => !row.archived_at)); setProperties(p.filter((row) => !row.archived_at)); setCatalog(s); setCrews(r); } }).catch((cause) => { if (active) setError(message(cause, "Job form data could not be loaded.")); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  const matchedClients = useMemo(() => { const term = clientSearch.trim().toLowerCase(); return clients.filter((row) => !term || [clientName(row), row.company_name, row.phone, row.email].filter(Boolean).join(" ").toLowerCase().includes(term)).slice(0, 100); }, [clientSearch, clients]);
  const clientProperties = useMemo(() => properties.filter((row) => row.client_id === clientId), [clientId, properties]);
  const property = clientProperties.find((row) => row.id === propertyId) ?? null;
  const services = useMemo(() => catalog?.services.filter((row) => !property || row.division === "Both" || row.division === property.property_type) ?? [], [catalog, property]);
  const service = services.find((row) => row.id === serviceId) ?? null;
  const addons = service && catalog ? getAvailableServiceAddons(catalog, service.id, property?.property_type) : [];
  const selectedAddonIds = addonNames.map((name) => addons.find((row) => row.addon_name === name)?.id).filter((id): id is string => Boolean(id));
  const basePrice = service && catalog ? calculateServicePrice(service, property?.square_feet || 1, catalog.tiers) : null;
  const addonTotal = service ? calculateAddons(addonNames, addons).reduce((sum, row) => sum + row.amount, 0) : 0;
  const total = basePrice == null ? null : Math.round((basePrice + addonTotal) * 100) / 100;
  function selectClient(value: string) { setClientId(value); const matches = properties.filter((row) => row.client_id === value); setPropertyId(matches.length === 1 ? matches[0].id : ""); setServiceId(""); setAddonNames([]); }
  function selectProperty(value: string) { setPropertyId(value); setServiceId(""); setAddonNames([]); const found = properties.find((row) => row.id === value); setAccess(found?.access_instructions ?? ""); }
  async function submit() {
    if (!clientId) return setError("Select an existing Client.");
    if (!propertyId) return setError("Select a Property / Service Location.");
    if (!serviceId) return setError("Select a Service.");
    if (!property || property.client_id !== clientId) return setError("The selected Property does not belong to the selected Client.");
    const override = Number(overridePrice);
    if (overrideEnabled && (overridePrice.trim() === "" || !Number.isFinite(override) || override < 0)) return setError("Override Job Price must be a number greater than or equal to zero.");
    if (total == null && !overrideEnabled) return setError(canOverridePrice ? "Enter an Override Job Price for this custom-priced Service." : "The selected Service does not have usable catalog pricing for a direct Job.");
    setSaving(true); setError(null);
    try { await createDirectJob({ client_id: clientId, property_id: propertyId, service_id: serviceId, addon_ids: selectedAddonIds, scheduled_date: date || null, start_time: date && time ? time : null, estimated_duration: duration > 0 ? duration : null, assigned_crew_id: crewId || null, labor_hours: Math.max(0, laborHours), access_instructions: access.trim() || null, internal_notes: notes.trim() || null, price_override: overrideEnabled ? override : null }); await created(); }
    catch (cause) { setError(message(cause, "Job could not be created.")); setSaving(false); }
  }
  return <div className="fixed inset-0 z-[70] overflow-y-auto bg-[#07190a]/65 p-4 backdrop-blur-[2px]"><section role="dialog" aria-modal="true" aria-labelledby="direct-job-title" className="mx-auto my-4 w-full max-w-4xl rounded-2xl bg-white shadow-2xl"><header className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-6 py-5"><div><p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-[#9a7a17]">Direct workflow</p><h2 id="direct-job-title" className="mt-1 text-xl font-extrabold text-[#143d1a]">Create Job</h2></div><button type="button" onClick={close} aria-label="Close Create Job" className="grid size-9 place-items-center rounded-lg border text-xl text-neutral-500">×</button></header>
  <div className="space-y-6 p-6">{loading ? <div className="h-64 animate-pulse rounded-xl bg-neutral-100" /> : <>
    <Section title="Client and Service Location"><div className="grid gap-4 sm:grid-cols-2"><Field label="Search Clients"><input className={input} value={clientSearch} onChange={(event) => setClientSearch(event.target.value)} placeholder="Name, company, phone, or email" /></Field><Field label="Client" required><select className={input} value={clientId} onChange={(event) => selectClient(event.target.value)}><option value="">Select existing Client</option>{matchedClients.map((row) => <option key={row.id} value={row.id}>{clientName(row)}{row.email ? ` — ${row.email}` : ""}</option>)}</select></Field><Field label="Property / Service Location" required><select className={input} disabled={!clientId} value={propertyId} onChange={(event) => selectProperty(event.target.value)}><option value="">{clientId && !clientProperties.length ? "No active properties for this Client" : "Select Property"}</option>{clientProperties.map((row) => <option key={row.id} value={row.id}>{propertyLabel(row)}</option>)}</select></Field><div className="self-end rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600">Need another location? <Link href="/properties" className="font-bold text-[#143d1a] underline">Add it through Properties</Link>, then reopen Create Job.</div></div></Section>
    <Section title="Service and Add-Ons"><div className="grid gap-4 sm:grid-cols-2"><Field label="Service" required><select className={input} disabled={!property} value={serviceId} onChange={(event) => { const next = services.find((row) => row.id === event.target.value); setServiceId(event.target.value); setAddonNames([]); setOverrideEnabled(canOverridePrice && next?.pricing_model === "Custom"); setOverridePrice(""); }}><option value="">Select active Service</option>{services.map((row) => <option key={row.id} value={row.id}>{row.service_name} — {money(row.base_price)}</option>)}</select></Field>{service && <div className="rounded-lg bg-neutral-50 p-3 text-sm"><b className="text-[#143d1a]">{service.service_name}</b><p className="mt-1 text-neutral-600">{service.description || "No catalog description."}</p><p className="mt-1 text-xs text-neutral-500">{service.division} · {service.pricing_model}</p></div>}<div className="sm:col-span-2"><CatalogAddonPicker addons={addons} selected={addonNames} setSelected={setAddonNames} /></div></div></Section>
    <Section title="Schedule and Crew"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Field label="Service Date"><input type="date" className={input} value={date} onChange={(event) => setDate(event.target.value)} /></Field><Field label="Service Time"><input type="time" className={input} disabled={!date} value={time} onChange={(event) => setTime(event.target.value)} />{time && <span className="mt-1 block text-xs text-neutral-500">{formatTime12Hour(time)}</span>}</Field><Field label="Estimated Duration (hours)"><input type="number" min="0" step="0.25" className={input} value={duration || ""} onChange={(event) => setDuration(Number(event.target.value))} /></Field><Field label="Assigned Crew"><select className={input} value={crewId} onChange={(event) => setCrewId(event.target.value)}><option value="">Unassigned</option>{crews.map((row) => <option key={row.id} value={row.id}>{row.crew_name}</option>)}</select></Field></div></Section>
    <Section title="Pricing"><div className="grid gap-4 sm:grid-cols-3"><Price label="Catalog / Base" value={basePrice}/><Price label="Add-Ons" value={addonTotal}/><Price label="Calculated Price" value={total} strong/></div>{canOverridePrice && <div className="mt-4 rounded-xl border border-[#d4af37]/50 bg-[#fffdf4] p-4"><label className="flex items-center gap-2 text-sm font-bold text-[#143d1a]"><input type="checkbox" checked={overrideEnabled} onChange={(event) => { setOverrideEnabled(event.target.checked); if (!event.target.checked) setOverridePrice(""); }} />Override Job Price</label>{overrideEnabled && <Field label="Final Job Price"><div className="relative max-w-xs"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500">$</span><input type="number" min="0" step="0.01" inputMode="decimal" className={`${input} pl-7`} value={overridePrice} onChange={(event) => setOverridePrice(event.target.value)} placeholder="0.00" /></div></Field>}<p className="mt-2 text-xs text-neutral-600">The override replaces the calculated total for this Job only. It does not change Service Catalog or Add-On pricing.</p></div>}<Field label="Planned Labor Hours"><input type="number" min="0" step="0.25" className={`${input} mt-2 max-w-xs`} value={laborHours || ""} onChange={(event) => setLaborHours(Number(event.target.value))} /></Field><p className="mt-2 text-xs text-neutral-500">Labor hours are operational planning data. Without a Master Admin override, catalog and add-on prices determine this Job total.</p></Section>
    <Section title="Instructions and Notes"><div className="grid gap-4 sm:grid-cols-2"><Field label="Access / Client Service Instructions"><textarea className={`${input} h-28 py-3`} value={access} onChange={(event) => setAccess(event.target.value)} /></Field><Field label="Internal Notes"><textarea className={`${input} h-28 py-3`} value={notes} onChange={(event) => setNotes(event.target.value)} /><span className="mt-1 block text-xs text-neutral-500">Internal notes are not presented as client instructions.</span></Field></div></Section>
  </>}{error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}<div className="flex justify-end gap-3 border-t pt-5"><button type="button" onClick={close} className={secondary}>Cancel</button><button type="button" disabled={loading || saving} onClick={() => void submit()} className={primary}>{saving ? "Creating…" : "Create Job"}</button></div></div></section></div>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) { return <section className="rounded-xl border p-5"><h3 className="font-extrabold text-[#143d1a]">{title}</h3><div className="mt-4">{children}</div></section>; }
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) { return <label className="block text-xs font-bold text-neutral-700">{label}{required && <span className="ml-1 text-[#9a7a17]">*</span>}<span className="mt-2 block">{children}</span></label>; }
function Price({ label, value, strong }: { label: string; value: number | null; strong?: boolean }) { return <div className={`rounded-xl p-4 ${strong ? "bg-[#143d1a] text-white" : "bg-neutral-50"}`}><p className="text-xs font-bold uppercase opacity-65">{label}</p><p className={`mt-2 text-2xl font-extrabold ${strong ? "text-[#d4af37]" : "text-[#143d1a]"}`}>{value == null ? "—" : money(value)}</p></div>; }
function clientName(row: Client) { return row.company_name || [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unnamed Client"; }
function propertyLabel(row: PropertyWithClient) { return [row.property_name, row.address, row.city].filter(Boolean).join(" · "); }
function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value); }
function message(cause: unknown, fallback: string) { return cause instanceof Error ? cause.message : fallback; }
const input = "h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#d4af37] disabled:bg-neutral-100";
const primary = "rounded-lg bg-[#143d1a] px-5 py-3 text-sm font-bold text-white disabled:opacity-50";
const secondary = "rounded-lg border border-neutral-200 px-5 py-3 text-sm font-bold text-[#143d1a]";
