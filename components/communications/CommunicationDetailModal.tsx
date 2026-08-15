"use client";

import type { ClientCommunication } from "@/types/clientCommunication";

export function CommunicationDetailModal({ communication, onClose }: { communication: ClientCommunication; onClose: () => void }) {
  const recipient = [communication.recipient_email, communication.recipient_phone].filter(Boolean).join(" · ") || "—";
  const context = contextLabel(communication);
  return <div className="fixed inset-0 z-[90] grid place-items-center bg-[#07190a]/60 p-5 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="communication-detail-title" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
      <header className="sticky top-0 flex items-start justify-between border-b border-neutral-100 bg-white px-6 py-5">
        <div><p className="text-[10px] font-extrabold uppercase tracking-[.16em] text-[#9a7a17]">{communication.communication_number}</p><h2 id="communication-detail-title" className="mt-1 text-xl font-extrabold text-[#143d1a]">Communication Detail</h2></div>
        <button type="button" onClick={onClose} aria-label="Close communication detail" className="grid size-9 place-items-center rounded-lg border border-neutral-200 text-xl text-neutral-500">×</button>
      </header>
      <div className="grid gap-5 p-6 sm:grid-cols-2">
        <Item label="Type" value={communication.communication_type} /><Item label="Status" value={communication.status} />
        {context && <div className="sm:col-span-2"><Item label="Related Record" value={context} /></div>}
        <Item label="Channel / Direction" value={`${communication.channel} · ${communication.direction}`} /><Item label="Recipient" value={recipient} />
        <Item label="Sent By" value={communication.sent_by_name || "—"} /><Item label="Created" value={formatDate(communication.created_at)} />
        <Item label="Sent Date" value={formatDate(communication.sent_at)} /><Item label="Provider" value={communication.provider || "—"} />
        <div className="sm:col-span-2"><Item label="Subject" value={communication.subject || "—"} /></div>
        <div className="sm:col-span-2"><Item label="Full Message" value={communication.message_body || "—"} preserve /></div>
        {communication.failure_reason && <div className="sm:col-span-2 rounded-xl border border-red-200 bg-red-50 p-4"><Item label="Failure Reason" value={communication.failure_reason} /></div>}
      </div>
    </section>
  </div>;
}

function Item({ label, value, preserve = false }: { label: string; value: string; preserve?: boolean }) {
  return <div><p className="text-[10px] font-extrabold uppercase tracking-[.12em] text-neutral-400">{label}</p><p className={`mt-1 text-sm leading-6 text-neutral-700 ${preserve ? "whitespace-pre-wrap" : ""}`}>{value}</p></div>;
}

function formatDate(value: string | null) { return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—"; }
function contextLabel(communication: ClientCommunication) {
  const entries = [["Estimate", "estimate_number"], ["Proposal", "proposal_number"], ["Agreement", "agreement_number"], ["Invoice", "invoice_number"]] as const;
  for (const [label, key] of entries) { const value = communication.metadata[key]; if (typeof value === "string" && value) return `${label} ${value}`; }
  return null;
}
