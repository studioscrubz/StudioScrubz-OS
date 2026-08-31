"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { getClients } from "@/lib/services/clients";
import { getProperties } from "@/lib/services/properties";
import { getServiceCatalog } from "@/lib/services/serviceCatalog";
import { getActiveCrews } from "@/lib/services/crews";
import { getBusinessSettings } from "@/lib/services/businessSettings";
import { createCompletedHistoricalJob } from "@/lib/services/jobs";
import { calculateServicePrice } from "@/lib/pricing/pricingEngine";
import { formatDuration } from "@/lib/jobPerformance";
import type { Client } from "@/types/client";
import type { PropertyWithClient } from "@/types/property";
import type { CrewWithRelations } from "@/types/crew";
import type { ServiceCatalogBundle } from "@/types/serviceCatalog";

export function CompletedHistoricalJobModal({ close, created }: { close: () => void; created: () => Promise<void> }) {
  const [clients, setClients] = useState<Client[]>([]); const [properties, setProperties] = useState<PropertyWithClient[]>([]);
  const [catalog, setCatalog] = useState<ServiceCatalogBundle | null>(null); const [crews, setCrews] = useState<CrewWithRelations[]>([]);
  const [timeZone, setTimeZone] = useState("UTC"); const [clientSearch, setClientSearch] = useState("");
  const [clientId, setClientId] = useState(""); const [propertyId, setPropertyId] = useState(""); const [serviceId, setServiceId] = useState("");
  const [startDate, setStartDate] = useState(""); const [startTime, setStartTime] = useState(""); const [endDate, setEndDate] = useState(""); const [endTime, setEndTime] = useState("");
  const [crewId, setCrewId] = useState(""); const [notes, setNotes] = useState(""); const [price, setPrice] = useState("");
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => { let active = true; void Promise.all([getClients(), getProperties(), getServiceCatalog(), getActiveCrews(), getBusinessSettings()]).then(([c, p, s, r, settings]) => { if (active) { setClients(c.filter((x) => !x.archived_at)); setProperties(p.filter((x) => !x.archived_at)); setCatalog(s); setCrews(r); setTimeZone(settings.timezone || "UTC"); } }).catch((cause) => { if (active) setError(message(cause, "Historical Job form data could not be loaded.")); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  const matchedClients = useMemo(() => { const term = clientSearch.trim().toLowerCase(); return clients.filter((row) => !term || [clientName(row), row.company_name, row.phone, row.email].filter(Boolean).join(" ").toLowerCase().includes(term)).slice(0, 100); }, [clientSearch, clients]);
  const clientProperties = useMemo(() => properties.filter((row) => row.client_id === clientId), [properties, clientId]);
  const property = clientProperties.find((row) => row.id === propertyId) ?? null;
  const services = useMemo(() => catalog?.services.filter((row) => !property || row.division === "Both" || row.division === property.property_type) ?? [], [catalog, property]);
  const service = services.find((row) => row.id === serviceId) ?? null;
  const catalogPrice = service && property && catalog ? calculateServicePrice(service, property.square_feet || 1, catalog.tiers) : null;
  const previewSeconds = durationSeconds(startDate, startTime, endDate, endTime);
  function selectClient(value: string) { setClientId(value); const matches = properties.filter((row) => row.client_id === value); setPropertyId(matches.length === 1 ? matches[0].id : ""); setServiceId(""); setPrice(""); }
  function selectProperty(value: string) { setPropertyId(value); setServiceId(""); setPrice(""); }
  async function submit() {
    if (!clientId) return setError("Select an existing Client."); if (!propertyId) return setError("Select a Property / Service Location."); if (!serviceId) return setError("Select a Service.");
    if (!startDate || !startTime || !endDate || !endTime) return setError("Actual Job Start and Actual Job End are required.");
    if (previewSeconds !== null && previewSeconds < 0) return setError("Actual Job End cannot be before Actual Job Start.");
    const value = price.trim() === "" ? null : Number(price); if (value !== null && (!Number.isFinite(value) || value < 0)) return setError("Job Value must be a number greater than or equal to zero.");
    if (service?.pricing_model === "Custom" && value === null) return setError("Enter a Job Value for this custom-priced Service.");
    setSaving(true); setError(null);
    try { await createCompletedHistoricalJob({ client_id: clientId, property_id: propertyId, service_id: serviceId, start_date: startDate, start_time: startTime, end_date: endDate, end_time: endTime, assigned_crew_id: crewId || null, internal_notes: notes.trim() || null, price: value }); await created(); }
    catch (cause) { setError(message(cause, "Completed Job could not be added.")); setSaving(false); }
  }
  return <div className="fixed inset-0 z-[75] overflow-y-auto bg-[#07190a]/65 p-4 backdrop-blur-[2px]"><section role="dialog" aria-modal="true" aria-labelledby="historical-job-title" className="mx-auto my-4 w-full max-w-4xl rounded-2xl bg-white shadow-2xl">
    <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-6 py-5"><div><p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-[#9a7a17]">Historical record</p><h2 id="historical-job-title" className="mt-1 text-xl font-extrabold text-[#143d1a]">Add Completed Job</h2><p className="mt-1 text-xs text-neutral-500">Records work that already happened. It does not clock employees in or create an Invoice.</p></div><button type="button" onClick={close} aria-label="Close Add Completed Job" className="grid size-9 place-items-center rounded-lg border text-xl text-neutral-500">×</button></header>
    <div className="space-y-6 p-6">{loading ? <div className="h-64 animate-pulse rounded-xl bg-neutral-100" /> : <>
      <Section title="Client and Service Location"><div className="grid gap-4 sm:grid-cols-2"><Field label="Search Clients"><input className={input} value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} placeholder="Name, company, phone, or email" /></Field><Field label="Client" required><select className={input} value={clientId} onChange={(e) => selectClient(e.target.value)}><option value="">Select existing Client</option>{matchedClients.map((row) => <option key={row.id} value={row.id}>{clientName(row)}</option>)}</select></Field><Field label="Property / Service Location" required><select className={input} disabled={!clientId} value={propertyId} onChange={(e) => selectProperty(e.target.value)}><option value="">Select Property</option>{clientProperties.map((row) => <option key={row.id} value={row.id}>{[row.property_name, row.address, row.city].filter(Boolean).join(" · ")}</option>)}</select></Field><Field label="Division"><div className="flex h-11 items-center rounded-lg bg-neutral-50 px-3 text-sm">{property?.property_type || "Select a Property"}</div></Field></div></Section>
      <Section title="Service and Job Value"><div className="grid gap-4 sm:grid-cols-2"><Field label="Service" required><select className={input} disabled={!property} value={serviceId} onChange={(e) => { setServiceId(e.target.value); setPrice(""); }}><option value="">Select active Service</option>{services.map((row) => <option key={row.id} value={row.id}>{row.service_name}</option>)}</select></Field><Field label="Job Value"><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500">$</span><input type="number" min="0" step="0.01" className={`${input} pl-7`} value={price} onChange={(e) => setPrice(e.target.value)} placeholder={catalogPrice === null ? "Required for custom pricing" : catalogPrice.toFixed(2)} /></div><span className="mt-1 block text-xs text-neutral-500">Optional unless custom-priced. Blank uses the active catalog price. No Invoice is created.</span></Field></div></Section>
      <Section title="Actual Master Job Time"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><DateTimeField label="Job Start Date" type="date" value={startDate} set={setStartDate} /><DateTimeField label="Job Start Time" type="time" value={startTime} set={setStartTime} /><DateTimeField label="Job End Date" type="date" value={endDate} set={setEndDate} /><DateTimeField label="Job End Time" type="time" value={endTime} set={setEndTime} /></div><div className="mt-4 rounded-xl bg-[#edf4ec] p-4 text-sm"><b className="text-[#143d1a]">Entered duration: {previewSeconds === null || previewSeconds < 0 ? "—" : formatDuration(previewSeconds)}</b><p className="mt-1 text-xs text-neutral-600">Times are interpreted in {timeZone}. The database performs the authoritative timezone conversion and validation.</p></div></Section>
      <Section title="Optional Operational Context"><div className="grid gap-4 sm:grid-cols-2"><Field label="Assigned Crew"><select className={input} value={crewId} onChange={(e) => setCrewId(e.target.value)}><option value="">Unassigned</option>{crews.map((row) => <option key={row.id} value={row.id}>{row.crew_name}</option>)}</select></Field><Field label="Internal Notes"><textarea className="min-h-24 w-full rounded-lg border border-neutral-200 p-3 text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div></Section>
    </>}{error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</p>}<div className="flex justify-end gap-3 border-t pt-5"><button type="button" onClick={close} className={secondary}>Cancel</button><button type="button" disabled={loading || saving} onClick={() => void submit()} className={primary}>{saving ? "Adding…" : "Add Completed Job"}</button></div></div>
  </section></div>;
}

function Section({ title, children }: { title: string; children: ReactNode }) { return <section className="rounded-xl border p-5"><h3 className="font-extrabold text-[#143d1a]">{title}</h3><div className="mt-4">{children}</div></section>; }
function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) { return <label className="block text-xs font-bold text-neutral-700">{label}{required && <span className="ml-1 text-[#9a7a17]">*</span>}<span className="mt-2 block">{children}</span></label>; }
function DateTimeField({ label, type, value, set }: { label: string; type: "date" | "time"; value: string; set: (value: string) => void }) { return <Field label={label} required><input type={type} className={input} value={value} onChange={(e) => set(e.target.value)} /></Field>; }
function durationSeconds(startDate: string, startTime: string, endDate: string, endTime: string) { if (!startDate || !startTime || !endDate || !endTime) return null; return (Date.parse(`${endDate}T${endTime}:00`) - Date.parse(`${startDate}T${startTime}:00`)) / 1000; }
function clientName(row: Client) { return row.company_name || [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unnamed Client"; }
function message(cause: unknown, fallback: string) { if (cause instanceof Error && cause.message.trim()) return cause.message; if (cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string" && cause.message.trim()) return cause.message; return fallback; }
const input = "h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#d4af37] disabled:bg-neutral-100";
const primary = "rounded-lg bg-[#143d1a] px-5 py-3 text-sm font-bold text-white disabled:opacity-50";
const secondary = "rounded-lg border border-neutral-200 px-5 py-3 text-sm font-bold text-[#143d1a]";
