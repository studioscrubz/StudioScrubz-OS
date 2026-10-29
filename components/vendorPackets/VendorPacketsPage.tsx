"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { VendorDocumentPreview } from "@/components/vendorPackets/VendorDocumentPreview";
import { getBusinessIdentitySettings } from "@/lib/services/businessSettings";
import { getClients } from "@/lib/services/clients";
import { getCorporateCapabilityProfile } from "@/lib/services/corporateCapability";
import { getProperties } from "@/lib/services/properties";
import {
  buildVendorCapabilityDocumentModel,
  CORPORATE_CAPABILITY_MODULE_LIMIT,
  type VendorDocumentKind,
} from "@/lib/vendorPackets/capability";
import { modules } from "@/lib/vendorPackets/content";
import type { BusinessIdentitySettings } from "@/types/businessSettings";
import type { Client } from "@/types/client";
import type { CorporateCapabilityProfile } from "@/types/corporateCapability";
import type { Property } from "@/types/property";

const fieldClass = "mt-2 w-full rounded-lg border border-neutral-200 bg-white p-3 text-sm text-neutral-800";
const documentChoices: Array<{ kind: VendorDocumentKind; title: string; description: string }> = [
  { kind: "corporate-capability-statement", title: "Corporate Capability Statement", description: "A concise corporate profile with verified company facts and selected core competencies." },
  { kind: "service-packet", title: "Service Capability Packet", description: "The detailed service overview for a prospect, client, property, or project." },
];

type EmailDraft = { recipientEmail: string; subject: string; messageBody: string; requestId: string };

export function VendorPacketsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [business, setBusiness] = useState<BusinessIdentitySettings | null>(null);
  const [corporateProfile, setCorporateProfile] = useState<CorporateCapabilityProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [documentKind, setDocumentKind] = useState<VendorDocumentKind>("corporate-capability-statement");
  const [clientId, setClientId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [serviceModuleIds, setServiceModuleIds] = useState<string[]>([]);
  const [statementModuleIds, setStatementModuleIds] = useState<string[]>([]);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null);
  const [sending, setSending] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailNotice, setEmailNotice] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([getClients(), getProperties(), getBusinessIdentitySettings(), getCorporateCapabilityProfile()])
      .then(([rows, locations, settings, profile]) => {
        if (!mounted) return;
        setClients(rows.filter((item) => !item.archived_at));
        setProperties(locations.filter((item) => !item.archived_at));
        setBusiness(settings);
        setCorporateProfile(profile);
      })
      .catch(() => {
        if (mounted) setError("Client, property, or corporate business information could not be loaded. Refresh the page to try again.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, []);

  const client = clients.find((item) => item.id === clientId);
  const availableProperties = properties.filter((item) => item.client_id === clientId);
  const property = availableProperties.find((item) => item.id === propertyId);
  const selectedModuleIds = documentKind === "corporate-capability-statement" ? statementModuleIds : serviceModuleIds;
  const documentModel = (() => {
    if (!client || !business || selectedModuleIds.length === 0) return null;
    return buildVendorCapabilityDocumentModel({
      documentKind,
      clientName: clientName(client),
      propertyLabel: property ? propertyLabel(property) : null,
      business: {
        name: business.business_name,
        tagline: business.tagline,
        email: business.business_email,
        phone: business.business_phone,
        website: business.website,
        address: businessAddress(business),
      },
      corporateProfile,
      moduleIds: selectedModuleIds,
    });
  })();

  const documentLabel = documentKind === "corporate-capability-statement" ? "Capability Statement" : "Service Packet";
  const profileHasCorporateFacts = Boolean(corporateProfile && (
    corporateProfile.uei || corporateProfile.cageCode || corporateProfile.naicsCodes.length || corporateProfile.certifications.length ||
    corporateProfile.pastPerformance.length || corporateProfile.differentiators.length || corporateProfile.serviceAreas
  ));

  function changeDocumentKind(kind: VendorDocumentKind) {
    setDocumentKind(kind);
    setSelectionNotice(null);
    setEmailNotice(null);
  }

  function toggleModule(moduleId: string, checked: boolean) {
    const current = selectedModuleIds;
    if (checked && documentKind === "corporate-capability-statement" && current.length >= CORPORATE_CAPABILITY_MODULE_LIMIT) {
      setSelectionNotice(`A Corporate Capability Statement can include up to ${CORPORATE_CAPABILITY_MODULE_LIMIT} core competencies. Remove one before adding another.`);
      return;
    }
    const next = checked ? [...current, moduleId] : current.filter((value) => value !== moduleId);
    if (documentKind === "corporate-capability-statement") setStatementModuleIds(next);
    else setServiceModuleIds(next);
    setSelectionNotice(null);
    setEmailNotice(null);
  }

  function openEmail() {
    if (!client || !documentModel) return;
    setEmailError(null);
    setEmailNotice(null);
    const target = property?.property_name || clientName(client);
    const statement = documentKind === "corporate-capability-statement";
    setEmailDraft({
      recipientEmail: client.email ?? "",
      requestId: crypto.randomUUID(),
      subject: statement
        ? `StudioScrubz Corporate Capability Statement — ${target}`.slice(0, 200)
        : `StudioScrubz Cleaning & Property Service Capabilities — ${target}`.slice(0, 200),
      messageBody: statement
        ? `Hello ${clientName(client)},\n\nThank you for the opportunity to introduce StudioScrubz.\n\nWe've prepared a corporate capability statement summarizing our company, selected core competencies, and verified business information.\n\nPlease review the statement below, and contact us if you would like to discuss your facility, project, or vendor requirements.\n\nNo mess. No stress.\n\nStudioScrubz`
        : `Hello ${clientName(client)},\n\nThank you for the opportunity to introduce StudioScrubz.\n\nWe've prepared a service capability packet highlighting the StudioScrubz services that may be relevant to your property or project.\n\nPlease review the information below, and feel free to contact us if you would like to schedule an assessment or discuss a customized service plan.\n\nNo mess. No stress.\n\nStudioScrubz`,
    });
  }

  async function sendEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!emailDraft || !documentModel || sending) return;
    setSending(true);
    setEmailError(null);
    try {
      const response = await fetch("/api/vendor-packets/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...emailDraft, documentKind, clientId, propertyId: propertyId || null, moduleIds: selectedModuleIds }),
      });
      const result = await response.json() as { error?: string; providerMessageId?: string; warning?: string };
      if (!response.ok || !result.providerMessageId) throw new Error(result.error || "The email could not be sent.");
      setEmailDraft(null);
      setEmailNotice(result.warning || `${documentLabel} emailed and recorded in client history.`);
    } catch (cause) {
      setEmailError(cause instanceof Error ? cause.message : "The email could not be confirmed as sent. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return <>
    <header className="mb-7 border-b border-[#143d1a]/10 pb-7">
      <p className="text-xs font-bold uppercase tracking-widest text-[#9a7a17]">Business development</p>
      <h1 className="mt-3 text-3xl font-extrabold text-[#143d1a]">Vendor Documents</h1>
      <p className="mt-3 max-w-3xl text-sm text-neutral-600">Generate a client-ready Corporate Capability Statement or detailed Service Capability Packet from approved StudioScrubz information.</p>
    </header>

    {loading ? <p role="status">Loading clients and corporate business information...</p> : error ? <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">{error}</p> : <>
      <section aria-label="Document options" className="mb-8 rounded-2xl border border-neutral-200 bg-white p-4 sm:p-6">
        <fieldset>
          <legend className="font-bold text-[#143d1a]">Document type</legend>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {documentChoices.map((choice) => <label key={choice.kind} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${documentKind === choice.kind ? "border-[#143d1a] bg-[#143d1a]/5 ring-1 ring-[#143d1a]" : "border-neutral-200 hover:border-neutral-300"}`}>
              <input type="radio" name="vendor-document-kind" value={choice.kind} checked={documentKind === choice.kind} onChange={() => changeDocumentKind(choice.kind)} className="mt-1 accent-[#143d1a]" />
              <span><strong className="block text-sm text-[#143d1a]">{choice.title}</strong><span className="mt-1 block text-sm text-neutral-600">{choice.description}</span></span>
            </label>)}
          </div>
        </fieldset>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <label className="text-sm font-bold">Prospect / Client
            <select className={fieldClass} value={clientId} onChange={(event) => { setClientId(event.target.value); setPropertyId(""); setEmailNotice(null); }}>
              <option value="">Select a client</option>
              {clients.map((item) => <option key={item.id} value={item.id}>{clientName(item)}</option>)}
            </select>
          </label>
          <label className="text-sm font-bold">Property (optional)
            <select className={fieldClass} value={propertyId} disabled={!client} onChange={(event) => { setPropertyId(event.target.value); setEmailNotice(null); }}>
              <option value="">No property selected</option>
              {availableProperties.map((item) => <option key={item.id} value={item.id}>{propertyLabel(item)}</option>)}
            </select>
          </label>
        </div>
        {!clients.length && <p className="mt-3 text-sm text-neutral-600">No unarchived clients are available. Add a prospect through Clients first.</p>}

        <fieldset className="mt-6" aria-describedby="module-guidance">
          <legend className="font-bold text-[#143d1a]">{documentKind === "corporate-capability-statement" ? "Core competencies" : "Capability modules"}</legend>
          <p id="module-guidance" className="mt-1 text-sm text-neutral-600">{documentKind === "corporate-capability-statement" ? `Choose up to ${CORPORATE_CAPABILITY_MODULE_LIMIT} services to keep the statement concise.` : "Choose the service sections relevant to this client or property."}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {modules.map((item) => {
              const checked = selectedModuleIds.includes(item.id);
              const limitReached = documentKind === "corporate-capability-statement" && !checked && selectedModuleIds.length >= CORPORATE_CAPABILITY_MODULE_LIMIT;
              return <label key={item.id} className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${limitReached ? "cursor-not-allowed bg-neutral-50 text-neutral-400" : "cursor-pointer"}`}>
                <input type="checkbox" className="mt-1 accent-[#143d1a]" checked={checked} disabled={limitReached} onChange={(event) => toggleModule(item.id, event.target.checked)} />
                {item.title}
              </label>;
            })}
          </div>
        </fieldset>

        {selectionNotice && <p role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{selectionNotice}</p>}
        {documentKind === "corporate-capability-statement" && <p className="mt-4 rounded-lg bg-neutral-50 p-3 text-sm text-neutral-600">
          {profileHasCorporateFacts ? "Only configured corporate facts are included. Blank identifiers or claims are omitted." : "Corporate identifiers, certifications, service areas, differentiators, and past performance are omitted until a Master Admin verifies them in Business Settings."}
        </p>}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button type="button" disabled={!documentModel} onClick={() => document.getElementById("vendor-document-preview")?.scrollIntoView({ behavior: "smooth" })} className="rounded-lg border px-5 py-3 text-sm font-bold disabled:opacity-40">Preview</button>
          <button type="button" disabled={!documentModel} onClick={() => window.print()} className="rounded-lg bg-[#143d1a] px-5 py-3 text-sm font-bold text-white disabled:opacity-40">Print / Save PDF</button>
          <button type="button" disabled={!documentModel} onClick={openEmail} className="rounded-lg bg-[#143d1a] px-5 py-3 text-sm font-bold text-white disabled:opacity-40">Email {documentLabel}</button>
          <p className="basis-full text-sm text-neutral-500 sm:basis-auto">Select a client and at least one capability. For a clean PDF, turn off browser headers and footers.</p>
        </div>
        {emailNotice && <p role="status" className="mt-4 text-sm font-medium text-[#143d1a]">{emailNotice}</p>}
      </section>

      {documentModel && <section id="vendor-document-preview" aria-label={`${documentLabel} preview`} className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm"><VendorDocumentPreview model={documentModel} /></section>}
    </>}

    {emailDraft && <dialog ref={(element) => { if (element && !element.open) element.showModal(); }} onCancel={(event) => { event.preventDefault(); if (!sending) setEmailDraft(null); }} aria-labelledby="vendor-email-title" className="m-auto w-[calc(100%-2rem)] max-w-xl rounded-2xl p-5 backdrop:bg-black/40 sm:p-6">
      <form onSubmit={sendEmail}>
        <h2 id="vendor-email-title" className="text-xl font-bold text-[#143d1a]">Email {documentLabel}</h2>
        <p className="mt-2 text-sm text-neutral-600">The generated document will appear in the branded email body and the exact content snapshot will be recorded in client history.</p>
        <fieldset disabled={sending} className="mt-4 space-y-4">
          <label className="block text-sm font-bold">Recipient<input autoFocus required type="email" maxLength={320} className={fieldClass} value={emailDraft.recipientEmail} onChange={(event) => setEmailDraft({ ...emailDraft, recipientEmail: event.target.value })} /></label>
          <label className="block text-sm font-bold">Subject<input required maxLength={200} className={fieldClass} value={emailDraft.subject} onChange={(event) => setEmailDraft({ ...emailDraft, subject: event.target.value })} /></label>
          <label className="block text-sm font-bold">Message<textarea required maxLength={10000} rows={9} className={fieldClass} value={emailDraft.messageBody} onChange={(event) => setEmailDraft({ ...emailDraft, messageBody: event.target.value })} /></label>
        </fieldset>
        {emailError && <p role="alert" className="mt-3 text-sm text-red-700">{emailError}</p>}
        <div className="mt-5 flex justify-end gap-3"><button type="button" disabled={sending} onClick={() => setEmailDraft(null)} className="rounded-lg border px-4 py-2">Cancel</button><button disabled={sending || !documentModel || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailDraft.recipientEmail.trim()) || !emailDraft.subject.trim() || !emailDraft.messageBody.trim()} className="rounded-lg bg-[#143d1a] px-4 py-2 font-bold text-white disabled:opacity-40">{sending ? "Sending..." : `Send ${documentLabel}`}</button></div>
      </form>
    </dialog>}

    {!loading && createPortal(<div id="vendor-document-print">{documentModel && <VendorDocumentPreview model={documentModel} />}</div>, document.body)}
    <style>{`
      #vendor-document-print { display: none; }
      .vendor-document { max-width: 8.5in; margin: auto; padding: .55in; background: white; color: #202820; font: 10.5pt/1.48 Arial, sans-serif; overflow-wrap: anywhere; }
      .vendor-document h1 { font-size: 25pt; line-height: 1.12; color: #143d1a; font-weight: 800; margin: 20px 0; }
      .vendor-document h2 { font-size: 15pt; line-height: 1.2; color: #143d1a; font-weight: 700; margin-bottom: 10px; }
      .vendor-document h3 { font-size: 11.5pt; line-height: 1.25; color: #143d1a; font-weight: 700; margin-bottom: 5px; }
      .vendor-document section { margin-top: 23px; }
      .vendor-document p { margin: 7px 0; }
      .vendor-document ul, .vendor-document ol { padding-left: 18px; }
      .vendor-document ul { list-style: disc; }
      .vendor-document ol { list-style: decimal; }
      .vendor-document li { margin: 3px 0; }
      .vendor-cover { border-top: 5px solid #d4af37; padding-top: 22px; }
      .vendor-brand-row { display: flex; align-items: center; gap: 16px; }
      .vendor-brand { font-size: 23pt; line-height: 1.1; font-weight: 800; color: #143d1a; }
      .vendor-prepared { border-left: 3px solid #d4af37; padding-left: 18px; margin: 22px 0; }
      .vendor-module { margin-top: 17px; break-inside: avoid; }
      .capability-statement { font-size: 9.8pt; line-height: 1.42; }
      .capability-header { border-top: 6px solid #d4af37; border-bottom: 1px solid #d4af37; padding: 18px 0; }
      .capability-brand { display: flex; align-items: center; gap: 18px; }
      .capability-kicker { margin: 0 !important; color: #143d1a; font-size: 10pt; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
      .capability-header h1 { margin: 5px 0 2px; font-size: 23pt; }
      .capability-tagline { color: #59645a; font-weight: 700; }
      .capability-prepared { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 12px; margin-top: 14px; padding: 10px 12px; background: #f4f7f3; border-left: 3px solid #143d1a; }
      .capability-prepared span { color: #647064; font-size: 8pt; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
      .capability-prepared strong { color: #143d1a; font-size: 11pt; }
      .capability-prepared small { flex-basis: 100%; color: #59645a; }
      .capability-layout { display: grid; grid-template-columns: minmax(0, 2fr) minmax(1.8in, .82fr); gap: 26px; }
      .capability-sidebar { border-left: 1px solid #dce4db; padding-left: 18px; }
      .capability-sidebar section { break-inside: avoid; }
      .capability-competency-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 18px; }
      .capability-competency { margin-top: 0 !important; border-top: 2px solid #d4af37; padding-top: 8px; break-inside: avoid; }
      .capability-feature-list li { margin-bottom: 6px; }
      .capability-data { margin: 0; }
      .capability-data div { border-bottom: 1px solid #e6ebe5; padding: 7px 0; break-inside: avoid; }
      .capability-data dt { color: #647064; font-size: 7.5pt; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; }
      .capability-data dd { margin-top: 2px; color: #143d1a; font-weight: 700; }
      .capability-footer { margin-top: 24px; border-top: 1px solid #d4af37; padding-top: 8px; color: #647064; font-size: 7.5pt; }
      @media (max-width: 720px) {
        .vendor-document { min-width: 0; padding: 24px 18px; }
        .vendor-brand-row, .capability-brand { align-items: flex-start; }
        .vendor-brand { font-size: 19pt; }
        .vendor-document h1, .capability-header h1 { font-size: 21pt; }
        .capability-logo { width: 68px !important; height: 68px !important; }
        .capability-layout { grid-template-columns: minmax(0, 1fr); gap: 0; }
        .capability-sidebar { border-left: 0; padding-left: 0; }
        .capability-competency-grid { grid-template-columns: minmax(0, 1fr); }
      }
      @media print {
        @page { size: letter; margin: .55in; }
        body > *:not(#vendor-document-print) { display: none !important; }
        body > #vendor-document-print { display: block !important; }
        html, body { background: white !important; margin: 0 !important; padding: 0 !important; }
        .vendor-document { max-width: none; padding: 0; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        .vendor-document h2, .vendor-document h3 { break-after: avoid; }
        .vendor-document p, .vendor-document li { orphans: 3; widows: 3; }
        .vendor-document section { break-inside: avoid; }
        .vendor-document .vendor-capabilities, .vendor-document .vendor-process, .vendor-document .vendor-strengths, .vendor-document .capability-competencies { break-inside: auto; }
        .vendor-process li { break-inside: avoid; }
        .capability-layout { grid-template-columns: minmax(0, 2fr) minmax(1.8in, .82fr); gap: 24px; }
        .capability-sidebar { border-left: 1px solid #dce4db; padding-left: 16px; }
        .capability-competency-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
    `}</style>
  </>;
}

function clientName(client: Client) {
  return client.company_name?.trim() || [client.first_name, client.last_name].filter(Boolean).join(" ") || "Unnamed client";
}

function propertyLabel(property: Property) {
  return [property.property_name, property.address, property.address_line_2, property.city, property.state, property.zip].filter(Boolean).join(", ");
}

function businessAddress(business: BusinessIdentitySettings) {
  const cityStateZip = [business.city, [business.state, business.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [business.address, cityStateZip].filter(Boolean).join(", ") || null;
}
