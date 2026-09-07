"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { createCommunication, createCommunicationOnce, getUpcomingServicesForClient, markCommunicationFailed, markCommunicationSent } from "@/lib/services/clientCommunications";
import { hasPermission } from "@/lib/auth/permissions";
import { getClientById } from "@/lib/services/clients";
import { getPropertyById } from "@/lib/services/properties";
import type { JobWithRelations } from "@/types/job";
import { openDeviceSmsApp } from "@/lib/deviceSms";
import { openDeviceEmailApp } from "@/lib/deviceEmail";
import type { Client } from "@/types/client";
import { COMMUNICATION_CHANNELS, COMMUNICATION_DIRECTIONS, COMMUNICATION_TYPES, type ClientCommunication, type CommunicationChannel, type CommunicationComposerContext, type CommunicationDirection, type CommunicationStatus, type CommunicationType, type UpcomingClientService } from "@/types/clientCommunication";

type Links = { clientId?: string; propertyId?: string; estimateId?: string; proposalId?: string; agreementId?: string; invoiceId?: string };

export function LogCommunicationModal({ links, client, context, initialType, initialServiceId, eventKey, onClose, onCreated }: { links: Links; client?: Client; context?: CommunicationComposerContext; initialType?: CommunicationType; initialServiceId?: string; eventKey?: string; onClose: () => void; onCreated: (record: ClientCommunication) => void }) {
  const { profile } = useAuth();
  const allowedTypes = useMemo(() => (profile?.role === "Sales" ? ["Estimate", "Proposal", "Service Agreement", "Service Reminder", "General"] : COMMUNICATION_TYPES.filter((type) => type !== "System")) as readonly CommunicationType[], [profile?.role]);
  const [type, setType] = useState<CommunicationType>(context?.communicationType ?? (initialType && allowedTypes.includes(initialType) ? initialType : allowedTypes[0] ?? "General"));
  const [channel, setChannel] = useState<CommunicationChannel>(context?.channel ?? "Email");
  const [direction, setDirection] = useState<CommunicationDirection>("Outbound");
  const [status, setStatus] = useState<Extract<CommunicationStatus, "Prepared" | "Sent" | "Failed">>("Prepared");
  const [subject, setSubject] = useState(context?.subject ?? ""); const [message, setMessage] = useState(context?.messageBody ?? "");
  const [email, setEmail] = useState(context?.recipientEmail ?? client?.email ?? ""); const [phone, setPhone] = useState(context?.recipientPhone ?? client?.phone ?? ""); const [failure, setFailure] = useState("");
  const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingClientService[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [loadingUpcoming, setLoadingUpcoming] = useState(false);
  const [upcomingError, setUpcomingError] = useState<string | null>(null);
  const [preparedSms, setPreparedSms] = useState<ClientCommunication | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const recordCommunication = (input: Parameters<typeof createCommunication>[0]) => eventKey
    ? createCommunicationOnce({ ...input, event_key: `${eventKey}:${input.channel}` })
    : createCommunication(input);

  useEffect(() => {
    if (context || type !== "Service Reminder" || !links.clientId) return;
    let active = true;
    // Reset request state before beginning the client-side lookup.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingUpcoming(true); setUpcomingError(null);
    void getUpcomingServicesForClient(links.clientId)
      .then((services) => {
        if (!active) return;
        setUpcoming(services);
        const first = services.find((item) => item.sourceId === initialServiceId) ?? services[0];
        setSelectedServiceId(first?.sourceId ?? "");
        if (first) applyReminder(first);
      })
      .catch((caught: unknown) => { console.error("Failed to load upcoming client services", caught); if (active) { setUpcoming([]); setUpcomingError("Upcoming services could not be loaded."); } })
      .finally(() => { if (active) setLoadingUpcoming(false); });
    return () => { active = false; };
  }, [context, initialServiceId, links.clientId, type]);

  function applyReminder(service: UpcomingClientService) {
    const date = friendlyDate(service.scheduledDate);
    const time = service.startTime ? friendlyTime(service.startTime) : null;
    const greeting = client?.first_name?.trim() || clientDisplayName(client);
    const scheduleText = time ? `${date} at ${time}` : date;
    setSubject(`Reminder: ${service.serviceName} — ${date}`);
    setMessage([
      `Hello ${greeting},`, "", `This is a reminder that your ${service.serviceName} service with StudioScrubz is scheduled for ${scheduleText}.`,
      ...(service.propertyAddress ? ["", "Service Location:", service.propertyAddress] : []),
      "", "If you have any questions or need to make changes, please contact StudioScrubz.", "", "Thank you,", "StudioScrubz",
    ].join("\n"));
    setEmail(client?.email ?? ""); setPhone(client?.phone ?? "");
  }

  function selectUpcoming(sourceId: string) {
    setSelectedServiceId(sourceId);
    const service = upcoming.find((item) => item.sourceId === sourceId);
    if (service) applyReminder(service);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "Failed" && !failure.trim()) { setError("Enter a failure reason."); return; }
    setSaving(true); setError(null);
    try {
      const record = await recordCommunication({
        client_id: context?.clientId ?? links.clientId ?? null, property_id: selectedService?.propertyId ?? context?.propertyId ?? links.propertyId ?? null,
        estimate_id: context?.estimateId ?? links.estimateId ?? null, proposal_id: context?.proposalId ?? links.proposalId ?? null,
        agreement_id: context?.agreementId ?? links.agreementId ?? null, invoice_id: context?.invoiceId ?? links.invoiceId ?? null,
        communication_type: type, channel, direction, status,
        subject: clean(subject), message_body: clean(message), recipient_email: clean(email), recipient_phone: clean(phone),
        sent_at: status === "Sent" ? new Date().toISOString() : null,
        failure_reason: status === "Failed" ? failure.trim() : null,
        metadata: selectedService ? { source: selectedService.source, source_id: selectedService.sourceId, scheduled_date: selectedService.scheduledDate, service_name: selectedService.serviceName } : context?.metadata ?? {},
      });
      onCreated(record);
      onClose();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Communication could not be logged."); }
    finally { setSaving(false); }
  }

  async function textClient() {
    if (!phone.trim()) { setError("No phone number is saved for this client."); return; }
    if (!message.trim()) { setError("Enter a message before opening the messaging app."); return; }
    setSaving(true); setError(null); setNotice(null);
    try {
      const record = (eventKey ? null : preparedSms) ?? await recordCommunication({
        client_id: context?.clientId ?? links.clientId ?? null, property_id: selectedService?.propertyId ?? context?.propertyId ?? links.propertyId ?? null,
        estimate_id: context?.estimateId ?? links.estimateId ?? null, proposal_id: context?.proposalId ?? links.proposalId ?? null,
        agreement_id: context?.agreementId ?? links.agreementId ?? null, invoice_id: context?.invoiceId ?? links.invoiceId ?? null,
        communication_type: type, channel: "SMS", direction, status: "Prepared", provider: "device",
        subject: clean(subject), message_body: clean(message), recipient_email: clean(email), recipient_phone: clean(phone),
        metadata: selectedService ? { source: selectedService.source, source_id: selectedService.sourceId, scheduled_date: selectedService.scheduledDate, service_name: selectedService.serviceName } : context?.metadata ?? {},
      });
      setPreparedSms(record); onCreated(record);
      if (eventKey && record.status === "Sent") { setNotice("This Job communication is already recorded as sent by SMS."); return; }
      openDeviceSmsApp(phone, message);
      setNotice("Messaging app opened. Confirm the message was sent before marking it as sent.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Your device could not open a messaging app."); }
    finally { setSaving(false); }
  }

  async function emailClient() {
    if (!email.trim()) { setError("No email address is saved for this client."); return; }
    setSaving(true); setError(null); setNotice(null);
    try {
      const record = (eventKey ? null : preparedSms) ?? await recordCommunication({
        client_id: context?.clientId ?? links.clientId ?? null, property_id: context?.propertyId ?? links.propertyId ?? null,
        estimate_id: context?.estimateId ?? links.estimateId ?? null, proposal_id: context?.proposalId ?? links.proposalId ?? null,
        agreement_id: context?.agreementId ?? links.agreementId ?? null, invoice_id: context?.invoiceId ?? links.invoiceId ?? null,
        communication_type: type, channel: "Email", direction, status: "Prepared", provider: "mailto",
        subject: clean(subject), message_body: clean(message), recipient_email: clean(email), recipient_phone: clean(phone), metadata: context?.metadata ?? {},
      });
      setPreparedSms(record); onCreated(record); if (eventKey && record.status === "Sent") { setNotice("This Job communication is already recorded as sent by email."); return; } openDeviceEmailApp(email, subject, `${message}${context?.handoffSuffix ?? ""}`);
      setNotice("Email application opened. Confirm the message was sent before marking it as sent.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Your device could not open an email application."); }
    finally { setSaving(false); }
  }

  async function confirmSms(next: "Sent" | "Failed") {
    if (!preparedSms) return;
    const reason = next === "Failed" ? window.prompt("Why did the SMS handoff fail?")?.trim() : null;
    if (next === "Failed" && !reason) return;
    setSaving(true); setError(null);
    try {
      const updated = next === "Sent" ? await markCommunicationSent(preparedSms.id) : await markCommunicationFailed(preparedSms.id, reason!);
      setPreparedSms(updated); onCreated(updated); setNotice(next === "Sent" ? "SMS marked as sent." : "SMS marked as failed.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "SMS status could not be updated."); }
    finally { setSaving(false); }
  }

  const selectedService = upcoming.find((item) => item.sourceId === selectedServiceId);

  return <div className="fixed inset-0 z-[90] flex items-end justify-center bg-[#07190a]/60 backdrop-blur-[2px] sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="log-communication-title" className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
      <header className="sticky top-0 flex items-start justify-between border-b border-neutral-100 bg-white px-6 py-5"><div><p className="text-[10px] font-extrabold uppercase tracking-[.16em] text-[#9a7a17]">Client history</p><h2 id="log-communication-title" className="mt-1 text-xl font-extrabold text-[#143d1a]">Log Communication</h2></div><button type="button" onClick={onClose} disabled={saving} className="grid size-9 place-items-center rounded-lg border border-neutral-200 text-xl text-neutral-500">×</button></header>
      <form onSubmit={submit} className="grid gap-5 p-6 sm:grid-cols-2">
        <Field label="Communication Type"><select value={type} onChange={(e) => setType(e.target.value)} className={inputClass}>{allowedTypes.map((item) => <option key={item}>{item}</option>)}</select></Field>
        <Field label="Channel"><select value={channel} onChange={(e) => setChannel(e.target.value as CommunicationChannel)} className={inputClass}>{(context ? COMMUNICATION_CHANNELS.filter((item) => item === "Email" || item === "SMS") : COMMUNICATION_CHANNELS).map((item) => <option key={item}>{item}</option>)}</select></Field>
        <Field label="Direction"><select value={direction} onChange={(e) => setDirection(e.target.value as CommunicationDirection)} className={inputClass}>{COMMUNICATION_DIRECTIONS.filter((item) => item !== "System").map((item) => <option key={item}>{item}</option>)}</select></Field>
        <Field label="Status"><select value={status} disabled={Boolean(context)} onChange={(e) => setStatus(e.target.value as typeof status)} className={inputClass}><option>Prepared</option>{!context && <><option>Sent</option><option>Failed</option></>}</select></Field>
        {type === "Service Reminder" && <div className="sm:col-span-2">
          {loadingUpcoming ? <p className="rounded-lg bg-neutral-50 px-4 py-3 text-sm text-neutral-500">Loading upcoming services…</p>
            : upcoming.length > 0 ? <Field label="Upcoming Service"><select value={selectedServiceId} onChange={(e) => selectUpcoming(e.target.value)} className={inputClass}>{upcoming.map((service) => <option key={`${service.source}-${service.sourceId}`} value={service.sourceId}>{serviceLabel(service)}</option>)}</select></Field>
            : <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">{upcomingError || "No upcoming scheduled service was found for this client."}</p>}
        </div>}
        <Field label="Recipient Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} /></Field>
        <Field label="Recipient Phone"><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} /></Field>
        <div className="sm:col-span-2"><Field label="Subject"><input value={subject} onChange={(e) => setSubject(e.target.value)} className={inputClass} /></Field></div>
        <div className="sm:col-span-2"><Field label="Message / Notes"><textarea rows={5} value={message} onChange={(e) => setMessage(e.target.value)} className={`${inputClass} resize-y`} /></Field></div>
        {status === "Failed" && <div className="sm:col-span-2"><Field label="Failure Reason"><textarea required rows={2} value={failure} onChange={(e) => setFailure(e.target.value)} className={`${inputClass} resize-y`} /></Field></div>}
        {!phone.trim() && channel === "SMS" && <p className="sm:col-span-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">No phone number is saved for this client.</p>}{!email.trim() && channel === "Email" && <p className="sm:col-span-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">No email address is saved for this client.</p>}
        {notice && <p role="status" className="sm:col-span-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-800">{notice}</p>}
        {error && <p role="alert" className="sm:col-span-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}
        <div className="flex flex-wrap justify-end gap-3 border-t border-neutral-100 pt-5 sm:col-span-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-neutral-200 px-5 py-2.5 text-sm font-bold text-neutral-600">{preparedSms ? "Close" : "Cancel"}</button>
          {channel === "SMS" && (!preparedSms || preparedSms.status === "Prepared") && <button type="button" disabled={saving || !phone.trim()} onClick={() => void textClient()} className="rounded-lg border border-[#143d1a]/20 px-5 py-2.5 text-sm font-bold text-[#143d1a] disabled:opacity-50">Text Client</button>}
          {channel === "Email" && (!preparedSms || preparedSms.status === "Prepared") && <button type="button" disabled={saving || !email.trim()} onClick={() => void emailClient()} className="rounded-lg border border-[#143d1a]/20 px-5 py-2.5 text-sm font-bold text-[#143d1a] disabled:opacity-50">Email Client</button>}
          {preparedSms?.status === "Prepared" && <><button type="button" disabled={saving} onClick={() => void confirmSms("Failed")} className="rounded-lg border border-red-200 px-5 py-2.5 text-sm font-bold text-red-700">Mark as Failed</button><button type="button" disabled={saving} onClick={() => void confirmSms("Sent")} className="rounded-lg bg-[#143d1a] px-5 py-2.5 text-sm font-bold text-white">Mark as Sent</button></>}
          {!preparedSms && !context && <button type="submit" disabled={saving} className="rounded-lg bg-[#143d1a] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60">{saving ? "Saving…" : "Log Communication"}</button>}
        </div>
      </form>
    </section>
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-2 block text-xs font-bold text-neutral-700">{label}</span>{children}</label>; }
function clean(value: string) { return value.trim() || null; }
function clientDisplayName(client?: Client) { if (!client) return "Client"; return client.company_name?.trim() || [client.first_name, client.last_name].filter(Boolean).join(" ").trim() || "Client"; }
function friendlyDate(value: string) { return new Intl.DateTimeFormat("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date(`${value}T12:00:00`)); }
function friendlyTime(value: string) { const [hours, minutes] = value.slice(0, 5).split(":").map(Number); return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, hours, minutes)); }
function serviceLabel(service: UpcomingClientService) { return `${service.serviceName} — ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${service.scheduledDate}T12:00:00`))}${service.startTime ? ` at ${friendlyTime(service.startTime)}` : ""}`; }
const inputClass = "w-full rounded-lg border border-neutral-200 bg-white px-3.5 py-2.5 text-sm text-neutral-800 outline-none focus:border-[#d4af37] focus:ring-2 focus:ring-[#d4af37]/15";
export function useJobCommunication() {
  const { profile } = useAuth();
  const [draft, setDraft] = useState<{ context: CommunicationComposerContext; eventKey: string } | null>(null);
  async function expose(job: JobWithRelations, event: "service_scheduled" | "team_arrived" | "service_completed") {
    try {
      if (!hasPermission(profile, "communications.create") || !job.client_id) return;
      if (event === "service_scheduled" && (!job.scheduled_date || ["Completed", "Cancelled", "Archived"].includes(job.status))) return;
      if (event === "team_arrived" && (job.status !== "In Progress" || !job.operational_started_at)) return;
      if (event === "service_completed" && job.status !== "Completed") return;
      const client = job.client ?? await getClientById(job.client_id).catch(() => null);
      const property = job.property ?? (job.property_id ? await getPropertyById(job.property_id).catch(() => null) : null);
      const name = client?.first_name?.trim() || client?.company_name?.trim() || [client?.first_name, client?.last_name].filter(Boolean).join(" ").trim() || job.client_name?.trim();
      const hello = name ? `Hello ${name},` : "Hello,";
      const location = property ? [property.property_name, property.address, property.address_line_2, property.city, property.state, property.zip].filter(Boolean).join(", ") : job.property_name;
      let subject: string;
      let body: string;
      if (event === "service_scheduled") {
        subject = `StudioScrubz Service Scheduled${job.property_name || job.client_name ? ` — ${job.property_name || job.client_name}` : ""}`;
        body = [hello, "", "Your StudioScrubz service has been scheduled.", "", ...(job.service_name ? [`Service: ${job.service_name}`] : []), `Date: ${friendlyDate(job.scheduled_date!)}`, ...(job.start_time ? [`Time: ${friendlyTime(job.start_time)}`] : []), ...(location ? ["", "Property:", location] : []), "", "Please make sure our team will have the necessary access to the service areas at the scheduled time.", "", "If anything changes or you have questions before your appointment, please contact us.", "", "Thank you for choosing StudioScrubz.", "", "No mess. No stress.", "", "StudioScrubz"].join("\n");
      } else if (event === "team_arrived") {
        subject = "StudioScrubz Team Has Arrived";
        body = `${hello}\n\nYour StudioScrubz team has arrived and service is beginning.\n\nOur team will work according to the confirmed service scope for your property or project.\n\nIf anything requiring your attention comes up during service, we’ll communicate with you.\n\nNo mess. No stress.\n\nStudioScrubz`;
      } else {
        subject = "StudioScrubz Service Completed";
        body = `${hello}\n\nYour StudioScrubz service has been completed.\n\nThank you for trusting us with your property or project.\n\nIf you have any questions about the completed service or anything that needs our attention, please contact us.\n\nAny applicable invoice or payment information will be provided separately.\n\nWe appreciate your business and look forward to working with you again.\n\nNo mess. No stress.\n\nStudioScrubz`;
      }
      const eventKey = `${event}:${job.id}${event === "service_scheduled" ? `:${job.scheduled_date}:${job.start_time || "no-time"}` : event === "team_arrived" ? `:${job.operational_started_at}` : ""}`;
      setDraft({ eventKey, context: { clientId: job.client_id, propertyId: job.property_id, jobId: job.id, communicationType: "General", channel: "Email", clientName: name || "", recipientEmail: client?.email ?? null, recipientPhone: client?.phone ?? null, subject, messageBody: body, sourceType: "Job", sourceId: job.id, metadata: { event, source: "Job", source_id: job.id, scheduled_date: job.scheduled_date, operational_started_at: job.operational_started_at, event_key: eventKey } } });
    } catch {
      // Communication preparation must never change a successful lifecycle result.
    }
  }
  return { expose, composer: draft ? <LogCommunicationModal key={draft.eventKey} links={{ clientId: draft.context.clientId! }} context={draft.context} eventKey={draft.eventKey} onClose={() => setDraft(null)} onCreated={() => {}} /> : null };
}
