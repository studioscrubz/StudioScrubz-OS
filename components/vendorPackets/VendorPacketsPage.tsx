"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getClients } from "@/lib/services/clients";
import { getProperties } from "@/lib/services/properties";
import { getBusinessSettings } from "@/lib/services/businessSettings";
import type { Client } from "@/types/client";
import type { Property } from "@/types/property";
import type { BusinessSettings } from "@/types/businessSettings";

import { modules, strengths, process, intro, about, cta, disclaimer } from "@/lib/vendorPackets/content";
const fieldClass = "mt-2 w-full rounded-lg border border-neutral-200 bg-white p-3 text-sm text-neutral-800";

export function VendorPacketsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [business, setBusiness] = useState<BusinessSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [emailDraft, setEmailDraft] = useState<{ recipientEmail: string; subject: string; messageBody: string; requestId: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailNotice, setEmailNotice] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    Promise.all([getClients(), getProperties(), getBusinessSettings()]).then(([rows, locations, settings]) => {
      if (!mounted) return;
      setClients(rows.filter(item => !item.archived_at));
      setProperties(locations.filter(item => !item.archived_at));
      setBusiness(settings);
    }).catch(() => { if (mounted) setError("Client, property, or business information could not be loaded. Refresh the page to try again."); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);
  const client = clients.find(item => item.id === clientId);
  const availableProperties = properties.filter(item => item.client_id === clientId);
  const property = availableProperties.find(item => item.id === propertyId);
  const chosen = modules.filter(item => selected.includes(item.id));
  const packet = client && business && chosen.length > 0 ? <Packet client={client} property={property} business={business} chosen={chosen} /> : null;

  function openEmail() {
    if (!client || !packet) return;
    setEmailError(null); setEmailNotice(null);
    setEmailDraft({ recipientEmail: client.email ?? "", requestId: crypto.randomUUID(),
      subject: `StudioScrubz Cleaning & Property Service Capabilities — ${property?.property_name || clientName(client)}`.slice(0, 200),
      messageBody: `Hello ${clientName(client)},\n\nThank you for the opportunity to introduce StudioScrubz.\n\nWe've prepared a service capability packet highlighting the StudioScrubz services that may be relevant to your property or project.\n\nPlease review the information below, and feel free to contact us if you would like to schedule an assessment or discuss a customized service plan.\n\nNo mess. No stress.\n\nStudioScrubz`,
    });
  }

  async function sendEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!emailDraft || !packet || sending) return;
    setSending(true); setEmailError(null);
    try {
      const response = await fetch("/api/vendor-packets/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...emailDraft, clientId, propertyId: propertyId || null, moduleIds: selected }) });
      const result = await response.json() as { error?: string; providerMessageId?: string; warning?: string };
      if (!response.ok || !result.providerMessageId) throw new Error(result.error || "The email could not be sent.");
      setEmailDraft(null); setEmailNotice(result.warning || "Vendor packet email sent and recorded in client history.");
    } catch (cause) { setEmailError(cause instanceof Error ? cause.message : "The email could not be confirmed as sent. Please try again."); }
    finally { setSending(false); }
  }

  return <>
    <header className="mb-7 border-b border-[#143d1a]/10 pb-7"><p className="text-xs font-bold uppercase tracking-widest text-[#9a7a17]">Business development</p><h1 className="mt-3 text-3xl font-extrabold text-[#143d1a]">Vendor Packets</h1><p className="mt-3 text-sm text-neutral-600">Prepare a capability packet for an existing prospect or client. Selections are not saved.</p></header>
    {loading ? <p role="status">Loading clients and business information...</p> : error ? <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">{error}</p> : <>
      <section aria-label="Packet options" className="mb-8 rounded-2xl border border-neutral-200 bg-white p-5 sm:p-7">
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="text-sm font-bold">Prospect / Client<select className={fieldClass} value={clientId} onChange={event => { setClientId(event.target.value); setPropertyId(""); }}><option value="">Select a client</option>{clients.map(item => <option key={item.id} value={item.id}>{clientName(item)}</option>)}</select></label>
          <label className="text-sm font-bold">Property (optional)<select className={fieldClass} value={propertyId} disabled={!client} onChange={event => setPropertyId(event.target.value)}><option value="">No property selected</option>{availableProperties.map(item => <option key={item.id} value={item.id}>{propertyLabel(item)}</option>)}</select></label>
        </div>
        {!clients.length && <p className="mt-3 text-sm text-neutral-600">No unarchived clients are available. Add a prospect through Clients first.</p>}
        <fieldset className="mt-6"><legend className="font-bold text-[#143d1a]">Capability modules</legend><div className="mt-3 grid gap-3 sm:grid-cols-2">{modules.map(item => <label key={item.title} className="flex items-start gap-3 rounded-lg border border-neutral-200 p-3 text-sm"><input type="checkbox" className="mt-1 accent-[#143d1a]" checked={selected.includes(item.id)} onChange={event => setSelected(current => event.target.checked ? [...current, item.id] : current.filter(value => value !== item.id))}/>{item.title}</label>)}</div></fieldset>
        <div className="mt-6 flex flex-wrap items-center gap-4"><button type="button" disabled={!packet} onClick={() => document.getElementById("vendor-packet-preview")?.scrollIntoView({ behavior: "smooth" })} className="rounded-lg border px-5 py-3 text-sm font-bold disabled:opacity-40">Preview</button><button type="button" disabled={!packet} onClick={() => window.print()} className="rounded-lg bg-[#143d1a] px-5 py-3 text-sm font-bold text-white disabled:opacity-40">Print / Save PDF</button><button type="button" disabled={!packet} onClick={openEmail} className="rounded-lg bg-[#143d1a] px-5 py-3 text-sm font-bold text-white disabled:opacity-40">Email Packet</button><p className="text-sm text-neutral-500">Select a client and at least one module to preview. For a clean PDF, turn off browser headers and footers.</p></div>
        {emailNotice && <p role="status" className="mt-4 text-sm text-[#143d1a]">{emailNotice}</p>}
      </section>
      {packet && <section id="vendor-packet-preview" aria-label="Vendor packet preview" className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">{packet}</section>}
    </>}
    {emailDraft && <dialog ref={element => { if (element && !element.open) element.showModal(); }} onCancel={event => { event.preventDefault(); if (!sending) setEmailDraft(null); }} aria-labelledby="vendor-email-title" className="m-auto w-full max-w-xl rounded-2xl p-6 backdrop:bg-black/40">
      <form onSubmit={sendEmail}>
        <h2 id="vendor-email-title" className="text-xl font-bold text-[#143d1a]">Email Packet</h2>
        <p className="mt-2 text-sm text-neutral-600">The current packet will appear in the email body.</p>
        <fieldset disabled={sending} className="mt-4 space-y-4">
          <label className="block text-sm font-bold">Recipient<input autoFocus required type="email" maxLength={320} className={fieldClass} value={emailDraft.recipientEmail} onChange={event => setEmailDraft({ ...emailDraft, recipientEmail: event.target.value })}/></label>
          <label className="block text-sm font-bold">Subject<input required maxLength={200} className={fieldClass} value={emailDraft.subject} onChange={event => setEmailDraft({ ...emailDraft, subject: event.target.value })}/></label>
          <label className="block text-sm font-bold">Message<textarea required maxLength={10000} rows={9} className={fieldClass} value={emailDraft.messageBody} onChange={event => setEmailDraft({ ...emailDraft, messageBody: event.target.value })}/></label>
        </fieldset>
        {emailError && <p role="alert" className="mt-3 text-sm text-red-700">{emailError}</p>}
        <div className="mt-5 flex justify-end gap-3"><button type="button" disabled={sending} onClick={() => setEmailDraft(null)} className="rounded-lg border px-4 py-2">Cancel</button><button disabled={sending || !packet || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailDraft.recipientEmail.trim()) || !emailDraft.subject.trim() || !emailDraft.messageBody.trim()} className="rounded-lg bg-[#143d1a] px-4 py-2 font-bold text-white disabled:opacity-40">{sending ? "Sending..." : "Send Packet"}</button></div>
      </form>
    </dialog>}
    {!loading && createPortal(<div id="vendor-packet-print">{packet}</div>, document.body)}
    <style>{`
      #vendor-packet-print { display: none; }
      .vendor-document { max-width: 8.5in; margin: auto; padding: .6in; background: white; color: #202820; font: 11pt/1.55 Arial, sans-serif; overflow-wrap: anywhere; }
      .vendor-document h1 { font-size: 27pt; line-height: 1.15; color: #143d1a; font-weight: 800; margin: 24px 0; }
      .vendor-document h2 { font-size: 16pt; line-height: 1.25; color: #143d1a; font-weight: 700; margin-bottom: 12px; }
      .vendor-document h3 { font-size: 12pt; color: #143d1a; font-weight: 700; margin-bottom: 6px; }
      .vendor-document section { margin-top: 26px; }
      .vendor-document p { margin: 8px 0; }
      .vendor-document ul, .vendor-document ol { padding-left: 20px; }
      .vendor-document ul { list-style: disc; }
      .vendor-document ol { list-style: decimal; }
      .vendor-document li { margin: 4px 0; }
      .vendor-cover { border-top: 5px solid #d4af37; padding-top: 24px; }
      .vendor-brand { font-size: 25pt; font-weight: 800; color: #143d1a; }
      .vendor-prepared { border-left: 3px solid #d4af37; padding-left: 18px; margin: 24px 0; }
      .vendor-module { margin-top: 18px; break-inside: avoid; }
      @media print {
        @page { size: letter; margin: .65in; }
        body > *:not(#vendor-packet-print) { display: none !important; }
        body > #vendor-packet-print { display: block !important; }
        html, body { background: white !important; margin: 0 !important; padding: 0 !important; }
        .vendor-document { max-width: none; padding: 0; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        .vendor-document h2, .vendor-document h3 { break-after: avoid; }
        .vendor-document p, .vendor-document li { orphans: 3; widows: 3; }
        .vendor-document section { break-inside: avoid; }
        .vendor-document .vendor-capabilities, .vendor-document .vendor-process, .vendor-document .vendor-strengths { break-inside: auto; }
        .vendor-process li { break-inside: avoid; }
      }
    `}</style>
  </>;
}

function Packet({ client, property, business, chosen }: { client: Client; property?: Property; business: BusinessSettings; chosen: ReadonlyArray<(typeof modules)[number]> }) {
  const contact = [business.business_phone, business.business_email, business.website].filter(Boolean);
  return <article className="vendor-document">
    <header className="vendor-cover"><div className="vendor-brand">{business.business_name}</div><p>Cleaning &bull; Property Services &bull; Specialty Cleaning</p><p>No mess. No stress.</p><h1>Professional Cleaning &amp; Property Service Capabilities</h1><div className="vendor-prepared"><p>Prepared for:</p><h2>{clientName(client)}</h2>{property && <p><strong>Property/Project:</strong> {propertyLabel(property)}</p>}</div>{contact.map(value => <p key={value}>{value}</p>)}{intro.map(text => <p key={text}>{text}</p>)}</header>
    <section><h2>About StudioScrubz</h2>{about.map(text => <p key={text}>{text}</p>)}</section>
    <section className="vendor-capabilities"><h2>Selected Service Capabilities</h2>{chosen.map(item => <div className="vendor-module" key={item.title}><h3>{item.title}</h3><ul>{item.bullets.map(bullet => <li key={bullet}>{bullet}</li>)}</ul>{item.note && <p>{item.note}</p>}</div>)}</section>
    <section className="vendor-process"><h2>How We Work</h2><ol>{process.map(step => <li key={step.title}><h3>{step.title}</h3><p>{step.copy}</p></li>)}</ol></section>
    <section className="vendor-strengths"><h2>Why StudioScrubz</h2>{strengths.map(item => <div className="vendor-module" key={item.title}><h3>{item.title}</h3><p>{item.copy}</p></div>)}</section>
    <section><h2>Let&apos;s Build the Right Service Plan</h2><p>{cta}</p><p><strong>{business.business_name}</strong></p>{contact.map(value => <p key={value}>{value}</p>)}<p>{disclaimer}</p></section>
  </article>;
}

function clientName(client: Client) { return client.company_name?.trim() || [client.first_name, client.last_name].filter(Boolean).join(" ") || "Unnamed client"; }
function propertyLabel(property: Property) { return [property.property_name, property.address, property.address_line_2, property.city, property.state, property.zip].filter(Boolean).join(", "); }
