"use client";

import { useSearchParams } from "next/navigation";
import { use, useState } from "react";

const RESPONSES = ["Accepted", "Tentative", "Declined"] as const;
type CalendarEvent = { title: string; description: string | null; starts_at: string; ends_at: string; location: string | null };

function compactUtc(date: string) {
  return new Date(date).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
function calendarLinks(event: CalendarEvent) {
  const dates = `${compactUtc(event.starts_at)}/${compactUtc(event.ends_at)}`;
  const google = new URL("https://calendar.google.com/calendar/render");
  google.search = new URLSearchParams({
    action: "TEMPLATE", text: event.title, dates,
    details: event.description || "", location: event.location || "",
  }).toString();
  const outlook = new URL("https://outlook.live.com/calendar/0/deeplink/compose");
  outlook.search = new URLSearchParams({
    path: "/calendar/action/compose", rru: "addevent", subject: event.title,
    startdt: event.starts_at, enddt: event.ends_at,
    body: event.description || "", location: event.location || "",
  }).toString();
  return { google: google.toString(), outlook: outlook.toString() };
}
function escapeIcs(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("\r\n", "\n").replaceAll("\n", "\\n").replaceAll(",", "\\,").replaceAll(";", "\\;");
}
function downloadIcs(event: CalendarEvent) {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//StudioScrubz//Calendar Export//EN",
    "BEGIN:VEVENT", `DTSTAMP:${compactUtc(new Date().toISOString())}`,
    `DTSTART:${compactUtc(event.starts_at)}`, `DTEND:${compactUtc(event.ends_at)}`,
    `SUMMARY:${escapeIcs(event.title)}`, `DESCRIPTION:${escapeIcs(event.description || "")}`,
    `LOCATION:${escapeIcs(event.location || "")}`, "END:VEVENT", "END:VCALENDAR", "",
  ];
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = "studioscrubz-event.ics";
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function InternalEventRsvpPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const search = useSearchParams();
  const [result, setResult] = useState<string | null>(null);
  const [calendar, setCalendar] = useState<CalendarEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const suggested = search.get("response");
  async function respond(response: typeof RESPONSES[number]) {
    setBusy(true); setResult(null); setCalendar(null);
    try {
      const reply = await fetch("/api/public/internal-schedule-rsvp", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, response }),
      });
      const body = await reply.json() as { error?: string; calendar?: CalendarEvent };
      setResult(reply.ok ? `Your response has been recorded as ${response}.` : body.error ?? "The RSVP could not be saved.");
      if (reply.ok && response === "Accepted" && body.calendar) setCalendar(body.calendar);
    } catch {
      setResult("The RSVP could not be saved. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  const links = calendar ? calendarLinks(calendar) : null;
  return <main className="min-h-screen bg-[#f4f6f2] px-4 py-16">
    <section className="mx-auto max-w-lg rounded-2xl bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-extrabold text-[#143D1A]">StudioScrubz Event RSVP</h1>
      <p className="mt-3 text-neutral-600">Choose your response. Your secure invitation link applies only to your attendee record.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        {RESPONSES.map(response => <button key={response} disabled={busy} onClick={() => void respond(response)}
          className={`rounded-lg px-4 py-2.5 font-bold ${suggested === response ? "bg-[#143D1A] text-white" : "border border-[#143D1A] text-[#143D1A]"}`}>
          {response === "Accepted" ? "Accept" : response === "Declined" ? "Decline" : response}
        </button>)}
      </div>
      {result && <p role="status" className="mt-6 rounded-lg bg-neutral-100 p-4 text-sm">{result}</p>}
      {calendar && links && <div className="mt-6 border-t pt-6">
        <h2 className="text-lg font-bold text-[#143D1A]">Add to Calendar</h2>
        <p className="mt-2 text-sm text-neutral-600">Your RSVP is saved. Choose your calendar below to add the event. Your calendar may ask you to confirm.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <a href={links.google} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-[#143D1A] px-4 py-2.5 font-semibold text-white">Google Calendar</a>
          <a href={links.outlook} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-[#143D1A] px-4 py-2.5 font-semibold text-[#143D1A]">Outlook</a>
          <button type="button" onClick={() => downloadIcs(calendar)} className="rounded-lg border border-[#143D1A] px-4 py-2.5 font-semibold text-[#143D1A]">Apple / Other (.ics)</button>
        </div>
      </div>}
    </section>
  </main>;
}
