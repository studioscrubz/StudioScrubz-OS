"use client";

import { useSearchParams } from "next/navigation";
import { use, useState } from "react";

const RESPONSES = ["Accepted", "Tentative", "Declined"] as const;

export default function InternalEventRsvpPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const search = useSearchParams();
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const suggested = search.get("response");
  async function respond(response: typeof RESPONSES[number]) {
    setBusy(true); setResult(null);
    const reply = await fetch("/api/public/internal-schedule-rsvp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, response }) });
    const body = await reply.json() as { error?: string };
    setResult(reply.ok ? `Your response has been recorded as ${response}.` : body.error ?? "The RSVP could not be saved.");
    setBusy(false);
  }
  return <main className="min-h-screen bg-[#f4f6f2] px-4 py-16"><section className="mx-auto max-w-lg rounded-2xl bg-white p-8 shadow-sm"><h1 className="text-2xl font-extrabold text-[#143D1A]">StudioScrubz Event RSVP</h1><p className="mt-3 text-neutral-600">Choose your response. Your secure invitation link applies only to your attendee record.</p><div className="mt-6 flex flex-wrap gap-3">{RESPONSES.map(response => <button key={response} disabled={busy} onClick={() => void respond(response)} className={`rounded-lg px-4 py-2.5 font-bold ${suggested === response ? "bg-[#143D1A] text-white" : "border border-[#143D1A] text-[#143D1A]"}`}>{response === "Accepted" ? "Accept" : response === "Declined" ? "Decline" : response}</button>)}</div>{result && <p className="mt-6 rounded-lg bg-neutral-100 p-4 text-sm">{result}</p>}</section></main>;
}
