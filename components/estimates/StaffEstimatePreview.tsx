"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getEstimateById } from "@/lib/services/estimates";
import type { EstimateWithRelations } from "@/types/estimate";
import { EstimateDocument, estimateDocumentFromRecord } from "@/components/estimates/EstimateDocument";

export function StaffEstimatePreview({ estimateId }: { estimateId: string }) {
  const [estimate, setEstimate] = useState<EstimateWithRelations|null>(null);
  const [error, setError] = useState<string|null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void getEstimateById(estimateId).then(data => { if(active) setEstimate(data); })
      .catch((cause:unknown) => { if(active) setError(cause instanceof Error ? cause.message : "Unable to load estimate."); })
      .finally(() => { if(active) setLoading(false); });
    return () => { active = false; };
  }, [estimateId]);

  useEffect(() => {
    if (!estimate || new URLSearchParams(window.location.search).get("print") !== "1") return;
    let cancelled = false;
    const printOnce = async () => {
      // Browser fonts and page layout can change pagination if printing starts while content is loading.
      if (document.fonts?.ready) await document.fonts.ready;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!cancelled) window.print();
      }));
    };
    void printOnce();
    return () => { cancelled = true; };
  }, [estimate]);

  if (loading) return <main className="mx-auto max-w-3xl px-6 py-12 text-sm text-neutral-600">Loading saved estimate for review…</main>;
  if (error || !estimate) return <main className="mx-auto max-w-3xl px-6 py-12"><h1 className="text-xl font-bold text-red-700">Estimate preview unavailable</h1><p className="mt-2 text-sm">{error || "The record could not be found."}</p><Link href="/open-estimates" className="mt-4 inline-block underline">Back to Open Estimates</Link></main>;

  return <main className="estimate-standalone-print min-h-screen bg-[#f5f6f4] px-4 py-8 print:min-h-0 print:bg-white print:p-0">
    <div className="mx-auto mb-5 max-w-3xl rounded-xl border border-[#143d1a]/20 bg-white p-4 shadow-sm print:hidden">
      <p className="text-sm font-bold text-[#143d1a]">Staff Preview · {estimate.estimate_number}</p>
      <p className="mt-1 text-xs text-neutral-600">Private review before delivery. Copying or printing this preview does not mark the estimate as sent. Sign-in is required to open this staff link.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={()=>window.print()} className="rounded-lg bg-[#143d1a] px-4 py-2 text-sm font-bold text-white">Print / Save PDF</button>
        <Link href="/open-estimates" className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-bold text-neutral-700">Back to Estimates</Link>
      </div>
    </div>
    <div className="mx-auto max-w-3xl bg-white shadow-sm print:max-w-none print:shadow-none">
      <EstimateDocument document={estimateDocumentFromRecord(estimate)}/>
    </div>
  </main>;
}
