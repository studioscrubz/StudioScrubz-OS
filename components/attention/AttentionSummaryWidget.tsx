"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getAttentionSummary } from "@/lib/services/attention";
import type { AttentionSummary } from "@/types/attention";

export function AttentionSummaryWidget() {
  const [summary, setSummary] = useState<AttentionSummary | null>(null);
  useEffect(() => { let active = true; void getAttentionSummary().then((value) => { if (active) setSummary(value); }).catch((cause) => console.error("Attention summary load failed", cause)); return () => { active = false; }; }, []);
  return <section className="mt-6 rounded-2xl border border-[#143d1a]/10 bg-white p-5 shadow-sm"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-extrabold text-[#143d1a]">Attention Summary</h2><p className="mt-1 text-sm text-neutral-500">Current operational follow-up items.{summary?.snoozed ? ` ${summary.snoozed} snoozed.` : ""}</p></div><Link href="/attention" className="text-sm font-bold text-[#143d1a] hover:underline">View Attention Center →</Link></div><div className="mt-4 grid grid-cols-3 gap-3">{[["Urgent", summary?.urgent], ["Needs Attention", summary?.attention], ["Upcoming", summary?.info]].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-[#f5f7f4] p-3 text-center"><p className="text-[10px] font-extrabold uppercase text-neutral-500">{label}</p><p className="mt-1 text-xl font-extrabold text-[#143d1a]">{value ?? "—"}</p></div>)}</div></section>;
}
