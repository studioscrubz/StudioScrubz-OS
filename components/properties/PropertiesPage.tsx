"use client";

import { useEffect, useMemo, useState } from "react";
import { PropertyFormModal, clientDisplayName } from "./PropertyFormModal";
import { archiveProperty, createProperty, findPotentialDuplicateProperties, getProperties, getPropertyClients, updateProperty } from "@/lib/services/properties";
import type { Client } from "@/types/client";
import { PROPERTY_TYPES, type PropertyInput, type PropertyType, type PropertyWithClient } from "@/types/property";

type TypeFilter = "All" | PropertyType;
type ArchiveFilter = "Active Records" | "Archived Records" | "All Records";

export function PropertiesPage() {
  const [properties, setProperties] = useState<PropertyWithClient[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("All");
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>("Active Records");
  const [formProperty, setFormProperty] = useState<PropertyWithClient | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [duplicateInput, setDuplicateInput] = useState<PropertyInput | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([getProperties(), getPropertyClients()])
      .then(([propertyRecords, clientRecords]) => { if (active) { setProperties(propertyRecords); setClients(clientRecords); } })
      .catch((caught: unknown) => { console.error("Failed to load properties from Supabase", caught); if (active) setError(toMessage(caught, "Properties could not be loaded. Check the Supabase connection and try again.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const summary = useMemo(() => ({
    total: properties.filter((item) => !item.archived_at).length,
    residential: properties.filter((item) => !item.archived_at && item.property_type === "Residential").length,
    commercial: properties.filter((item) => !item.archived_at && item.property_type === "Commercial").length,
    archived: properties.filter((item) => item.archived_at).length,
  }), [properties]);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return properties.filter((property) => {
      const searchable = [property.property_name, property.address, property.city, property.zip, clientDisplayName(property.client)].filter(Boolean).join(" ").toLocaleLowerCase();
      const archiveMatch = archiveFilter === "All Records" || (archiveFilter === "Archived Records" ? Boolean(property.archived_at) : !property.archived_at);
      return (!term || searchable.includes(term)) && (typeFilter === "All" || property.property_type === typeFilter) && archiveMatch;
    });
  }, [archiveFilter, properties, search, typeFilter]);

  async function submit(input: PropertyInput) {
    setSaving(true); setError(null);
    try {
      if (formProperty) {
        await updateProperty(formProperty.id, input);
        await refresh("Property updated successfully.");
        setFormProperty(undefined);
      } else {
        const matches = await findPotentialDuplicateProperties(input);
        if (matches.length) { setDuplicateInput(input); return; }
        await finishCreate(input);
      }
    } catch (caught) { console.error("Failed to save property to Supabase", caught); setError(toMessage(caught, "The property could not be saved. Please try again.")); }
    finally { setSaving(false); }
  }

  async function finishCreate(input: PropertyInput) { await createProperty(input); await refresh("Property created successfully."); setDuplicateInput(null); setFormProperty(undefined); }
  async function continueDuplicate() { if (!duplicateInput) return; setSaving(true); try { await finishCreate(duplicateInput); } catch (caught) { console.error("Failed to create duplicate-confirmed property", caught); setError(toMessage(caught, "The property could not be created. Please try again.")); } finally { setSaving(false); } }
  async function handleArchive(property: PropertyWithClient) { if (!window.confirm(`Archive ${propertyDisplayName(property)}?`)) return; setArchivingId(property.id); setError(null); try { await archiveProperty(property.id); await refresh("Property archived successfully."); } catch (caught) { console.error("Failed to archive property in Supabase", caught); setError(toMessage(caught, "The property could not be archived. Please try again.")); } finally { setArchivingId(null); } }
  async function refresh(message: string) { setProperties(await getProperties()); setNotice(message); }

  return <>
    <div className="flex flex-col gap-5 border-b border-[#143d1a]/10 pb-7 sm:flex-row sm:items-end sm:justify-between sm:pb-8"><Header /><button type="button" onClick={() => { setNotice(null); setFormProperty(null); }} disabled={!loading && clients.length === 0} className="shrink-0 rounded-lg bg-[#143d1a] px-5 py-3 text-sm font-bold text-white shadow-[0_8px_20px_rgba(20,61,26,.18)] hover:bg-[#0d2b12] disabled:cursor-not-allowed disabled:opacity-50">Add Property</button></div>
    {notice && <Message kind="success" text={notice} dismiss={() => setNotice(null)} />}
    {error && <Message kind="error" text={error} />}
    {!loading && clients.length === 0 && !error && <Message kind="error" text="Add a client before creating a property. Properties must be linked to an existing client." />}
    <section aria-label="Property summary" className="mt-7 grid grid-cols-2 gap-4 xl:grid-cols-4"><Summary label="Total Properties" value={loading ? "—" : summary.total} /><Summary label="Residential" value={loading ? "—" : summary.residential} /><Summary label="Commercial" value={loading ? "—" : summary.commercial} /><Summary label="Archived" value={loading ? "—" : summary.archived} /></section>
    <section className="mt-6 overflow-hidden rounded-2xl border border-[#143d1a]/10 bg-white shadow-[0_12px_34px_rgba(20,61,26,.05)]">
      <div className="grid gap-3 border-b border-neutral-100 p-4 md:grid-cols-[minmax(240px,1fr)_180px_180px]"><label><span className="sr-only">Search properties</span><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search property, address, or client" className={filterClass} /></label><Filter label="Property type" value={typeFilter} onChange={(value) => setTypeFilter(value as TypeFilter)} options={["All", ...PROPERTY_TYPES]} /><Filter label="Archived records" value={archiveFilter} onChange={(value) => setArchiveFilter(value as ArchiveFilter)} options={["Active Records", "Archived Records", "All Records"]} /></div>
      {loading ? <Loading /> : filtered.length === 0 ? <Empty hasRecords={properties.length > 0} canAdd={clients.length > 0} add={() => setFormProperty(null)} /> : <PropertyTable properties={filtered} archivingId={archivingId} edit={setFormProperty} archive={handleArchive} />}
    </section>
    {formProperty !== undefined && <PropertyFormModal key={formProperty?.id ?? "new"} property={formProperty} clients={clients} saving={saving} onClose={() => { if (!saving) setFormProperty(undefined); }} onSubmit={submit} />}
    {duplicateInput && <DuplicateWarning saving={saving} cancel={() => setDuplicateInput(null)} proceed={continueDuplicate} />}
  </>;
}

function Header() { return <div><p className="mb-3 text-[11px] font-extrabold uppercase tracking-[.2em] text-[#9a7a17]">Operations workspace</p><h1 className="text-3xl font-extrabold tracking-[-.04em] text-[#143d1a] sm:text-4xl">Properties</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-600 sm:text-base">Manage service locations connected to StudioScrubz clients.</p></div>; }
function Summary({ label, value }: { label: string; value: number | string }) { return <article className="rounded-2xl border border-[#143d1a]/10 bg-white p-5 shadow-[0_8px_25px_rgba(20,61,26,.045)]"><p className="text-[10px] font-extrabold uppercase tracking-[.1em] text-neutral-500 sm:text-xs">{label}</p><p className="mt-5 text-3xl font-extrabold text-[#143d1a]">{value}</p></article>; }
function Message({ kind, text, dismiss }: { kind: "success" | "error"; text: string; dismiss?: () => void }) { return <div role={kind === "error" ? "alert" : "status"} className={`mt-6 flex items-center justify-between rounded-xl border px-4 py-3 text-sm font-semibold ${kind === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-[#143d1a]/15 bg-[#edf4ec] text-[#143d1a]"}`}><span>{text}</span>{dismiss && <button type="button" onClick={dismiss} aria-label="Dismiss message" className="text-lg opacity-50">×</button>}</div>; }
function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: readonly string[] }) { return <label><span className="sr-only">{label}</span><select value={value} onChange={(e) => onChange(e.target.value)} className={filterClass}>{options.map((option) => <option key={option}>{option}</option>)}</select></label>; }
function PropertyTable({ properties, archivingId, edit, archive }: { properties: PropertyWithClient[]; archivingId: string | null; edit: (property: PropertyWithClient) => void; archive: (property: PropertyWithClient) => Promise<void> }) { return <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left"><thead><tr className="border-b border-neutral-100 bg-[#f8faf7] text-[10px] uppercase tracking-[.12em] text-neutral-500"><th className="px-5 py-3">Property</th><th className="px-5 py-3">Client</th><th className="px-5 py-3">Type</th><th className="px-5 py-3">Location</th><th className="px-5 py-3 text-right">Actions</th></tr></thead><tbody>{properties.map((property) => <tr key={property.id} className={`border-b border-neutral-100 last:border-0 ${property.archived_at ? "bg-neutral-50/70" : ""}`}><td className="px-5 py-4"><p className="text-sm font-extrabold text-[#143d1a]">{propertyDisplayName(property)}</p>{property.archived_at && <span className="mt-2 inline-flex rounded-full bg-neutral-200 px-2 py-0.5 text-[10px] font-bold uppercase text-neutral-600">Archived</span>}</td><td className="px-5 py-4"><p className="text-sm font-semibold text-neutral-700">{clientDisplayName(property.client)}</p>{property.client.archived_at && <p className="mt-1 text-xs text-neutral-400">Archived client</p>}</td><td className="px-5 py-4 text-sm text-neutral-600">{property.property_type}</td><td className="px-5 py-4"><p className="text-sm text-neutral-700">{property.address}{property.address_line_2 ? `, ${property.address_line_2}` : ""}</p><p className="mt-1 text-xs text-neutral-500">{[property.city, property.state, property.zip].filter(Boolean).join(", ") || "—"}</p></td><td className="px-5 py-4"><div className="flex justify-end gap-2"><button type="button" onClick={() => edit(property)} className={actionClass}>Edit</button>{!property.archived_at && <button type="button" disabled={archivingId === property.id} onClick={() => void archive(property)} className={`${actionClass} hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:opacity-50`}>{archivingId === property.id ? "Archiving…" : "Archive"}</button>}</div></td></tr>)}</tbody></table></div>; }
function Loading() { return <div className="space-y-3 p-5" aria-label="Loading properties"><div className="h-16 animate-pulse rounded-xl bg-neutral-100" /><div className="h-16 animate-pulse rounded-xl bg-neutral-100" /><div className="h-16 animate-pulse rounded-xl bg-neutral-100" /></div>; }
function Empty({ hasRecords, canAdd, add }: { hasRecords: boolean; canAdd: boolean; add: () => void }) { return <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center"><span className="mb-5 h-1 w-10 rounded-full bg-[#d4af37]" /><h2 className="font-extrabold text-[#143d1a]">{hasRecords ? "No properties match these filters" : "No properties yet"}</h2><p className="mt-2 text-sm text-neutral-500">{hasRecords ? "Adjust the search or filters to see other records." : canAdd ? "Add the first service location to get started." : "Add a client before creating a property."}</p>{!hasRecords && canAdd && <button type="button" onClick={add} className="mt-5 rounded-lg border border-[#143d1a]/20 px-4 py-2 text-sm font-bold text-[#143d1a]">Add Property</button>}</div>; }
function DuplicateWarning({ saving, cancel, proceed }: { saving: boolean; cancel: () => void; proceed: () => Promise<void> }) { return <div className="fixed inset-0 z-[80] grid place-items-center bg-[#07190a]/60 p-5 backdrop-blur-[2px]"><section role="alertdialog" aria-modal="true" aria-labelledby="duplicate-property-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><div className="mb-4 grid size-10 place-items-center rounded-full bg-amber-50 font-extrabold text-amber-700">!</div><h2 id="duplicate-property-title" className="text-xl font-extrabold text-[#143d1a]">A similar property already exists for this client.</h2><p className="mt-2 text-sm leading-6 text-neutral-600">Review the existing property before creating another record at this location.</p><div className="mt-6 flex justify-end gap-3"><button type="button" disabled={saving} onClick={cancel} className={actionClass}>Cancel</button><button type="button" disabled={saving} onClick={() => void proceed()} className="rounded-lg bg-[#143d1a] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">{saving ? "Saving…" : "Continue Anyway"}</button></div></section></div>; }
function propertyDisplayName(property: PropertyWithClient): string { return property.property_name || property.address; }
function toMessage(error: unknown, fallback: string): string { return error instanceof Error && error.message ? error.message : fallback; }
const filterClass = "h-11 w-full rounded-lg border border-neutral-200 bg-white px-3.5 text-sm text-neutral-700 outline-none transition focus:border-[#d4af37] focus:ring-2 focus:ring-[#d4af37]/15";
const actionClass = "rounded-lg border border-neutral-200 px-3 py-2 text-xs font-bold text-[#143d1a] hover:bg-[#f3f6f2]";
