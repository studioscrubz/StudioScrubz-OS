"use client";

import { CommunicationTimeline } from "@/components/communications/CommunicationTimeline";
import type { Client } from "@/types/client";

export function ClientDetailModal({ client, initialServiceId, onClose, onEdit }: { client: Client; initialServiceId?: string; onClose: () => void; onEdit: () => void }) {
  return <div className="fixed inset-0 z-[70] flex items-end justify-center bg-[#07190a]/60 backdrop-blur-[2px] sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="client-detail-title" className="max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-t-2xl bg-[#f7f9f6] shadow-2xl sm:rounded-2xl">
      <header className="sticky top-0 z-10 flex items-start justify-between border-b border-[#143d1a]/10 bg-white px-6 py-5">
        <div><p className="text-[10px] font-extrabold uppercase tracking-[.16em] text-[#9a7a17]">Client detail</p><h2 id="client-detail-title" className="mt-1 text-2xl font-extrabold text-[#143d1a]">{displayName(client)}</h2></div>
        <div className="flex gap-2"><button type="button" onClick={onEdit} className="rounded-lg border border-[#143d1a]/20 px-4 py-2 text-sm font-bold text-[#143d1a]">Edit Client</button><button type="button" onClick={onClose} aria-label="Close client detail" className="grid size-10 place-items-center rounded-lg border border-neutral-200 text-xl text-neutral-500">×</button></div>
      </header>
      <div className="space-y-5 p-5 sm:p-6">
        <section className="grid gap-4 rounded-2xl border border-[#143d1a]/10 bg-white p-5 sm:grid-cols-2 lg:grid-cols-4">
          <Item label="Type" value={client.client_type} /><Item label="Status" value={client.status} /><Item label="Email" value={client.email || "—"} /><Item label="Phone" value={client.phone || "—"} />
        </section>
        <CommunicationTimeline clientId={client.id} client={client} initialLogType={initialServiceId ? "Service Reminder" : undefined} initialServiceId={initialServiceId} />
      </div>
    </section>
  </div>;
}

function Item({ label, value }: { label: string; value: string }) { return <div><p className="text-[10px] font-extrabold uppercase tracking-[.12em] text-neutral-400">{label}</p><p className="mt-1 text-sm font-semibold text-neutral-700">{value}</p></div>; }
function displayName(client: Client) { return [client.first_name, client.last_name].filter(Boolean).join(" ") || client.company_name || "Unnamed client"; }
