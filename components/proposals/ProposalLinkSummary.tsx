"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getProposalLinks, type ProposalLinkRecord } from "@/lib/services/proposals";
import { useOperationalRealtime } from "@/components/realtime/OperationalRealtimeProvider";
import type { EstimateWithRelations } from "@/types/estimate";

type Props = { source: "estimate" | "walkthrough"; visibleEstimates?: EstimateWithRelations[] };

function historical(row: ProposalLinkRecord): boolean {
  return Boolean(row.archived_at || row.status === "Archived" || row.superseded_at || !row.is_current_revision);
}

function proposalLabel(row: ProposalLinkRecord): string {
  if (row.archived_at || row.status === "Archived") return "Archived";
  if (row.superseded_at || !row.is_current_revision) return "Superseded / Historical";
  return "Current revision";
}

export function ProposalLinkSummary({ source, visibleEstimates }: Props) {
  const [rows, setRows] = useState<ProposalLinkRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const visibleIds = useMemo(() => new Set(visibleEstimates?.map(item => item.id) ?? []), [visibleEstimates]);
  const estimateById = useMemo(() => new Map((visibleEstimates ?? []).map(item => [item.id, item])), [visibleEstimates]);

  async function refresh() {
    try {
      setRows(await getProposalLinks());
      setError(null);
    } catch (cause) {
      console.error("Proposal links failed to load", cause);
      setError("Proposal links could not be loaded. Refresh the page to retry.");
    }
  }
  useEffect(() => { void refresh(); }, []);
  useOperationalRealtime(["proposals"], refresh);

  const relevant = rows.filter(row => {
    if (source === "walkthrough") return Boolean(row.walkthrough_id);
    if (!row.estimate_id) return false;
    return visibleEstimates === undefined || visibleIds.has(row.estimate_id);
  });
  const current = relevant.filter(row => !historical(row));
  const history = relevant.filter(historical);

  function render(row: ProposalLinkRecord) {
    const estimate = row.estimate_id ? estimateById.get(row.estimate_id) : undefined;
    const sourceNumber = estimate?.estimate_number ?? (row.estimate_id ? "Linked estimate (not in current view)" : "Linked sales assessment");
    const customer = row.client_name || (estimate ? [estimate.customer_first_name, estimate.customer_last_name].filter(Boolean).join(" ") : "") || "Customer not recorded";
    return (
      <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-[#143d1a]/10 py-3 first:border-0">
        <div className="min-w-0 space-y-1">
          <p className="font-bold text-[#143d1a]">{row.proposal_number} <span className="text-xs font-normal text-neutral-600">V{row.revision_number}</span></p>
          <p className="text-sm text-neutral-700">{customer} · {sourceNumber}</p>
          <p className="text-xs text-neutral-600">Status: {row.status} · {proposalLabel(row)}</p>
        </div>
        <Link href={`/open-proposals?proposalId=${encodeURIComponent(row.id)}`} className="shrink-0 rounded-lg border border-[#143d1a]/20 bg-[#edf4ec] px-3 py-2 text-xs font-bold text-[#143d1a] hover:bg-[#dfecdd]">
          View Proposal
        </Link>
      </li>
    );
  }

  return (
    <section className="mt-6 rounded-2xl border border-[#143d1a]/10 bg-white p-4" aria-label="Proposal links for shown estimates">
      <h2 className="text-sm font-extrabold text-[#143d1a]">Proposal Linked</h2>
      <p className="mt-1 text-xs text-neutral-600">
        {source === "estimate" && visibleEstimates ? "Only proposals linked to the estimates currently shown above are listed." : "Proposals linked to this workflow."}
      </p>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      {!error && relevant.length === 0 && <p className="mt-3 text-sm text-neutral-600">No proposals are linked to these records yet.</p>}
      {current.length > 0 && <ul className="mt-3">{current.map(render)}</ul>}
      {history.length > 0 && <details className="mt-4 border-t border-neutral-200 pt-3">
        <summary className="cursor-pointer text-sm font-bold text-neutral-600">Historical / archived revisions ({history.length})</summary>
        <ul className="mt-2">{history.map(render)}</ul>
      </details>}
    </section>
  );
}
