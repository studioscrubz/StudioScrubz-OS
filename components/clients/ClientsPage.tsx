"use client";

import { useEffect, useMemo, useState } from "react";
import { ClientFormModal } from "./ClientFormModal";
import { archiveClient, createClient, findPotentialDuplicateClients, getClients, updateClient } from "@/lib/services/clients";
import { CLIENT_STATUSES, CLIENT_TYPES, type Client, type ClientInput, type ClientStatus, type ClientType } from "@/types/client";

type TypeFilter = "All" | ClientType;
type StatusFilter = "All" | ClientStatus;
type ArchiveFilter = "Active Records" | "Archived Records" | "All Records";

export function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("All");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>("Active Records");
  const [formClient, setFormClient] = useState<Client | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [duplicateInput, setDuplicateInput] = useState<ClientInput | null>(null);
  const [duplicateMatches, setDuplicateMatches] = useState<Client[]>([]);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getClients()
      .then((records) => { if (active) setClients(records); })
      .catch((caught: unknown) => {
        console.error("Failed to load clients from Supabase", caught);
        if (active) setError(toMessage(caught, "Clients could not be loaded. Check the Supabase connection and try again."));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const activeClients = useMemo(() => clients.filter((client) => !client.archived_at), [clients]);
  const summary = {
    total: activeClients.length,
    residential: activeClients.filter((client) => client.client_type === "Residential").length,
    commercial: activeClients.filter((client) => client.client_type === "Commercial").length,
    leads: activeClients.filter((client) => client.status === "Lead").length,
  };

  const filteredClients = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return clients.filter((client) => {
      const searchable = [client.first_name, client.last_name, client.company_name, client.phone, client.email].filter(Boolean).join(" ").toLocaleLowerCase();
      const archiveMatch = archiveFilter === "All Records" || (archiveFilter === "Archived Records" ? Boolean(client.archived_at) : !client.archived_at);
      return (!term || searchable.includes(term)) && (typeFilter === "All" || client.client_type === typeFilter) && (statusFilter === "All" || client.status === statusFilter) && archiveMatch;
    });
  }, [archiveFilter, clients, search, statusFilter, typeFilter]);

  async function handleSubmit(input: ClientInput) {
    setSaving(true);
    setError(null);
    try {
      if (formClient) {
        await updateClient(formClient.id, input);
        await refreshAfterChange("Client updated successfully.");
        setFormClient(undefined);
        return;
      }

      const matches = await findPotentialDuplicateClients(input);
      if (matches.length > 0) {
        setDuplicateInput(input);
        setDuplicateMatches(matches);
        return;
      }

      await finishCreate(input);
    } catch (caught) {
      console.error("Failed to save client to Supabase", caught);
      setError(toMessage(caught, "The client could not be saved. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  async function finishCreate(input: ClientInput) {
    await createClient(input);
    await refreshAfterChange("Client created successfully.");
    setDuplicateInput(null);
    setDuplicateMatches([]);
    setFormClient(undefined);
  }

  async function continueDuplicate() {
    if (!duplicateInput) return;
    setSaving(true);
    try {
      await finishCreate(duplicateInput);
    } catch (caught) {
      console.error("Failed to create duplicate-confirmed client", caught);
      setError(toMessage(caught, "The client could not be created. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive(client: Client) {
    if (!window.confirm(`Archive ${clientDisplayName(client)}? This record can still be viewed with the archived filter.`)) return;
    setArchivingId(client.id);
    setError(null);
    try {
      await archiveClient(client.id);
      await refreshAfterChange("Client archived successfully.");
    } catch (caught) {
      console.error("Failed to archive client in Supabase", caught);
      setError(toMessage(caught, "The client could not be archived. Please try again."));
    } finally {
      setArchivingId(null);
    }
  }

  async function refreshAfterChange(message: string) {
    setClients(await getClients());
    setNotice(message);
  }

  return (
    <>
      <div className="flex flex-col gap-5 border-b border-[#143d1a]/10 pb-7 sm:flex-row sm:items-end sm:justify-between sm:pb-8">
        <PageHeaderContent />
        <button type="button" onClick={() => { setNotice(null); setFormClient(null); }} className="shrink-0 rounded-lg bg-[#143d1a] px-5 py-3 text-sm font-bold text-white shadow-[0_8px_20px_rgba(20,61,26,.18)] hover:bg-[#0d2b12]">Add Client</button>
      </div>

      {notice && <div role="status" className="mt-6 flex items-center justify-between rounded-xl border border-[#143d1a]/15 bg-[#edf4ec] px-4 py-3 text-sm font-semibold text-[#143d1a]"><span>{notice}</span><button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message" className="text-lg text-[#143d1a]/50">×</button></div>}
      {error && <div role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}

      <section aria-label="Client summary" className="mt-7 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <SummaryCard label="Total Clients" value={loading ? "—" : summary.total} />
        <SummaryCard label="Residential" value={loading ? "—" : summary.residential} />
        <SummaryCard label="Commercial" value={loading ? "—" : summary.commercial} />
        <SummaryCard label="Leads" value={loading ? "—" : summary.leads} />
      </section>

      <section className="mt-6 overflow-hidden rounded-2xl border border-[#143d1a]/10 bg-white shadow-[0_12px_34px_rgba(20,61,26,.05)]">
        <div className="grid gap-3 border-b border-neutral-100 p-4 md:grid-cols-2 xl:grid-cols-[minmax(260px,1fr)_180px_160px_180px]">
          <label className="relative"><span className="sr-only">Search clients</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, company, phone, or email" className={filterClass} /></label>
          <Filter label="Client type" value={typeFilter} onChange={(value) => setTypeFilter(value as TypeFilter)} options={["All", ...CLIENT_TYPES]} />
          <Filter label="Status" value={statusFilter} onChange={(value) => setStatusFilter(value as StatusFilter)} options={["All", ...CLIENT_STATUSES]} />
          <Filter label="Archived records" value={archiveFilter} onChange={(value) => setArchiveFilter(value as ArchiveFilter)} options={["Active Records", "Archived Records", "All Records"]} />
        </div>

        {loading ? <LoadingState /> : filteredClients.length === 0 ? <EmptyState hasClients={clients.length > 0} onAdd={() => setFormClient(null)} /> : <ClientList clients={filteredClients} archivingId={archivingId} onEdit={setFormClient} onArchive={handleArchive} />}
      </section>

      {formClient !== undefined && <ClientFormModal key={formClient?.id ?? "new"} client={formClient} saving={saving} onClose={() => { if (!saving) setFormClient(undefined); }} onSubmit={handleSubmit} />}
      {duplicateInput && <DuplicateWarning matches={duplicateMatches} saving={saving} onCancel={() => { setDuplicateInput(null); setDuplicateMatches([]); }} onContinue={continueDuplicate} />}
    </>
  );
}

function PageHeaderContent() {
  return <div><p className="mb-3 text-[11px] font-extrabold uppercase tracking-[0.2em] text-[#9a7a17]">Operations workspace</p><h1 className="text-3xl font-extrabold tracking-[-0.04em] text-[#143d1a] sm:text-4xl">Clients</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-600 sm:text-base">Manage StudioScrubz residential and commercial clients.</p></div>;
}

function SummaryCard({ label, value }: { label: string; value: number | string }) {
  return <article className="rounded-2xl border border-[#143d1a]/10 bg-white p-5 shadow-[0_8px_25px_rgba(20,61,26,.045)]"><p className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-neutral-500 sm:text-xs">{label}</p><p className="mt-5 text-3xl font-extrabold text-[#143d1a]">{value}</p></article>;
}

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: readonly string[] }) {
  return <label><span className="sr-only">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className={filterClass}>{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
}

function ClientList({ clients, archivingId, onEdit, onArchive }: { clients: Client[]; archivingId: string | null; onEdit: (client: Client) => void; onArchive: (client: Client) => Promise<void> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[850px] border-collapse text-left">
        <thead><tr className="border-b border-neutral-100 bg-[#f8faf7] text-[10px] uppercase tracking-[0.12em] text-neutral-500"><th className="px-5 py-3 font-extrabold">Client</th><th className="px-5 py-3 font-extrabold">Type</th><th className="px-5 py-3 font-extrabold">Contact</th><th className="px-5 py-3 font-extrabold">Status</th><th className="px-5 py-3 text-right font-extrabold">Actions</th></tr></thead>
        <tbody>{clients.map((client) => (
          <tr key={client.id} className={`border-b border-neutral-100 last:border-0 ${client.archived_at ? "bg-neutral-50/70 text-neutral-500" : ""}`}>
            <td className="px-5 py-4"><p className="text-sm font-extrabold text-[#143d1a]">{clientDisplayName(client)}</p>{client.company_name && (client.first_name || client.last_name) && <p className="mt-1 text-xs text-neutral-500">{client.company_name}</p>}{client.archived_at && <span className="mt-2 inline-flex rounded-full bg-neutral-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-neutral-600">Archived</span>}</td>
            <td className="px-5 py-4 text-sm text-neutral-600">{client.client_type}</td>
            <td className="px-5 py-4"><p className="text-sm text-neutral-700">{client.email || "—"}</p><p className="mt-1 text-xs text-neutral-500">{client.phone || "—"}</p></td>
            <td className="px-5 py-4"><StatusBadge status={client.status} /></td>
            <td className="px-5 py-4"><div className="flex justify-end gap-2"><button type="button" onClick={() => onEdit(client)} className="rounded-lg border border-neutral-200 px-3 py-2 text-xs font-bold text-[#143d1a] hover:bg-[#f3f6f2]">Edit</button>{!client.archived_at && <button type="button" disabled={archivingId === client.id} onClick={() => void onArchive(client)} className="rounded-lg border border-neutral-200 px-3 py-2 text-xs font-bold text-neutral-500 hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:opacity-50">{archivingId === client.id ? "Archiving…" : "Archive"}</button>}</div></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }: { status: ClientStatus }) {
  const style = status === "Active" ? "bg-emerald-50 text-emerald-700" : status === "Inactive" ? "bg-neutral-100 text-neutral-600" : "bg-amber-50 text-amber-700";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${style}`}>{status}</span>;
}

function LoadingState() { return <div className="space-y-3 p-5" aria-label="Loading clients"><div className="h-16 animate-pulse rounded-xl bg-neutral-100" /><div className="h-16 animate-pulse rounded-xl bg-neutral-100" /><div className="h-16 animate-pulse rounded-xl bg-neutral-100" /></div>; }

function EmptyState({ hasClients, onAdd }: { hasClients: boolean; onAdd: () => void }) {
  return <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center"><span aria-hidden className="mb-5 h-1 w-10 rounded-full bg-[#d4af37]" /><h2 className="text-base font-extrabold text-[#143d1a]">{hasClients ? "No clients match these filters" : "No clients yet"}</h2><p className="mt-2 max-w-sm text-sm leading-6 text-neutral-500">{hasClients ? "Adjust the search or filters to see other records." : "Add the first StudioScrubz client to get started."}</p>{!hasClients && <button type="button" onClick={onAdd} className="mt-5 rounded-lg border border-[#143d1a]/20 px-4 py-2 text-sm font-bold text-[#143d1a] hover:bg-[#f3f6f2]">Add Client</button>}</div>;
}

function DuplicateWarning({ matches, saving, onCancel, onContinue }: { matches: Client[]; saving: boolean; onCancel: () => void; onContinue: () => Promise<void> }) {
  return <div className="fixed inset-0 z-[80] grid place-items-center bg-[#07190a]/60 p-5 backdrop-blur-[2px]"><section role="alertdialog" aria-modal="true" aria-labelledby="duplicate-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><div className="mb-4 grid size-10 place-items-center rounded-full bg-amber-50 font-extrabold text-amber-700">!</div><h2 id="duplicate-title" className="text-xl font-extrabold text-[#143d1a]">A similar client already exists.</h2><p className="mt-2 text-sm leading-6 text-neutral-600">{matches.length === 1 ? `The existing record is ${clientDisplayName(matches[0])}.` : `${matches.length} existing records share similar details.`} Review existing clients before continuing.</p><div className="mt-6 flex justify-end gap-3"><button type="button" disabled={saving} onClick={onCancel} className="rounded-lg border border-neutral-200 px-4 py-2.5 text-sm font-bold text-neutral-600">Cancel</button><button type="button" disabled={saving} onClick={() => void onContinue()} className="rounded-lg bg-[#143d1a] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">{saving ? "Saving…" : "Continue Anyway"}</button></div></section></div>;
}

function clientDisplayName(client: Client): string {
  const name = [client.first_name, client.last_name].filter(Boolean).join(" ");
  return name || client.company_name || "Unnamed client";
}

function toMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

const filterClass = "h-11 w-full rounded-lg border border-neutral-200 bg-white px-3.5 text-sm text-neutral-700 outline-none transition focus:border-[#d4af37] focus:ring-2 focus:ring-[#d4af37]/15";
