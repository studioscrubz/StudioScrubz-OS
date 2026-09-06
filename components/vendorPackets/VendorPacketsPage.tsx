"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getClients } from "@/lib/services/clients";
import { getProperties } from "@/lib/services/properties";
import { getBusinessSettings } from "@/lib/services/businessSettings";
import type { Client } from "@/types/client";
import type { Property } from "@/types/property";
import type { BusinessSettings } from "@/types/businessSettings";

// Packet sections are presentation copy, not catalog services or pricing records.
const modules = [
  { title: "Commercial Cleaning", bullets: ["Offices and professional spaces","Floor cleaning","Restrooms","Breakrooms and shared areas","High-touch surfaces","Interior glass","Trash removal when included","Detail cleaning","Recurring and custom facility scopes"], note: "" },
  { title: "Property Management & Common Areas", bullets: ["Common-area cleaning","Lobbies, corridors, and stairwells","Laundry rooms","Shared amenities","Interior glass and touchpoints","Unit-turn coordination","Pressure washing and exterior cleaning for suitable surfaces","Recurring property-specific scopes"], note: "Exterior work and unit turns are confirmed as part of the property service scope." },
  { title: "Unit Turns", bullets: ["Move-out cleaning and move-in preparation","Kitchens and bathrooms","Cabinets and drawers when included","Appliances when included","Interior glass when included","Dust and light debris within the cleaning scope","Floors","Final presentation cleaning"], note: "Cleaning does not include repairs, painting, or maintenance." },
  { title: "Post-Construction Cleaning", bullets: ["Construction dust removal","Detailed surface cleaning","Cabinets and built-ins","Baseboards, trim, and doors","Fixtures","Interior glass when included","Floors","Kitchens and bathrooms","Final-detail cleaning","Phased cleaning based on project readiness"], note: "Hazardous-material cleanup, asbestos handling, mold remediation, heavy debris hauling, and trade work are excluded." },
  { title: "Pressure Washing", bullets: ["Walkways and entries","Courtyards and patios","Exterior common areas","Suitable hardscape surfaces","Trash-area exterior cleaning","Property-specific exterior projects"], note: "Surface material, condition, access, and cleaning needs are reviewed before scope is confirmed. Not every surface is suitable for pressure washing." },
  { title: "Recording & Production Facilities", bullets: ["Recording rooms","Control rooms and production rooms","Lounges and common areas","Kitchens and restrooms","Floors and accessible surfaces","Interior glass","Equipment-conscious, facility-specific cleaning"], note: "Sensitive electronic and audio equipment servicing, internal cleaning, and repairs are excluded." },
  { title: "Residential Cleaning", bullets: ["Standard and deep cleaning","Move-in and move-out cleaning","Kitchens and bathrooms","Bedrooms and living areas","Floors","Interior detail work","Add-ons within the confirmed scope","Recurring service"], note: "" },
  { title: "Airbnb / Turnover Cleaning", bullets: ["Turnover cleaning","Kitchen and bathroom reset","Bedrooms and living areas","Floors","Trash removal when included","Laundry and bed reset when included","Restocking coordination when included","Property-condition observations"], note: "Timing, access, laundry, and special turnover requirements are confirmed before service." },
] as const;
const strengths = [{"title":"Clearly Defined Scope","copy":"We confirm the areas, tasks, and service expectations before work begins so you know what is included."},{"title":"Professional Communication","copy":"Clear communication keeps property priorities, access details, and scheduling needs part of the service plan."},{"title":"Flexible Service Capabilities","copy":"Selected services can support one-time projects or recurring needs across residential and commercial environments."},{"title":"Documented Workflow","copy":"Assessment, scope, and completion details provide a clear record of the service process."},{"title":"Property-Aware Service","copy":"We plan around the space, its surfaces, and how it is used, with respect for customer property and operating needs."}];
const process = [{"title":"Assessment","copy":"We review your property, priorities, and cleaning needs, with a walkthrough or project assessment when needed."},{"title":"Defined Scope","copy":"We confirm the areas, tasks, inclusions, and service expectations."},{"title":"Proposal & Scheduling","copy":"We prepare a proposal and coordinate scheduling and access once service details are confirmed."},{"title":"Professional Service","copy":"We perform the confirmed cleaning scope with attention to the property and its operating needs."},{"title":"Review & Documentation","copy":"We review the completed service and document completion details and relevant observations."}];
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
  const chosen = modules.filter(item => selected.includes(item.title));
  const packet = client && business && chosen.length > 0 ? <Packet client={client} property={property} business={business} chosen={chosen} /> : null;

  return <>
    <header className="mb-7 border-b border-[#143d1a]/10 pb-7"><p className="text-xs font-bold uppercase tracking-widest text-[#9a7a17]">Business development</p><h1 className="mt-3 text-3xl font-extrabold text-[#143d1a]">Vendor Packets</h1><p className="mt-3 text-sm text-neutral-600">Prepare a capability packet for an existing prospect or client. Selections are not saved.</p></header>
    {loading ? <p role="status">Loading clients and business information...</p> : error ? <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">{error}</p> : <>
      <section aria-label="Packet options" className="mb-8 rounded-2xl border border-neutral-200 bg-white p-5 sm:p-7">
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="text-sm font-bold">Prospect / Client<select className={fieldClass} value={clientId} onChange={event => { setClientId(event.target.value); setPropertyId(""); }}><option value="">Select a client</option>{clients.map(item => <option key={item.id} value={item.id}>{clientName(item)}</option>)}</select></label>
          <label className="text-sm font-bold">Property (optional)<select className={fieldClass} value={propertyId} disabled={!client} onChange={event => setPropertyId(event.target.value)}><option value="">No property selected</option>{availableProperties.map(item => <option key={item.id} value={item.id}>{propertyLabel(item)}</option>)}</select></label>
        </div>
        {!clients.length && <p className="mt-3 text-sm text-neutral-600">No unarchived clients are available. Add a prospect through Clients first.</p>}
        <fieldset className="mt-6"><legend className="font-bold text-[#143d1a]">Capability modules</legend><div className="mt-3 grid gap-3 sm:grid-cols-2">{modules.map(item => <label key={item.title} className="flex items-start gap-3 rounded-lg border border-neutral-200 p-3 text-sm"><input type="checkbox" className="mt-1 accent-[#143d1a]" checked={selected.includes(item.title)} onChange={event => setSelected(current => event.target.checked ? [...current, item.title] : current.filter(value => value !== item.title))}/>{item.title}</label>)}</div></fieldset>
        <div className="mt-6 flex flex-wrap items-center gap-4"><button type="button" disabled={!packet} onClick={() => window.print()} className="rounded-lg bg-[#143d1a] px-5 py-3 text-sm font-bold text-white disabled:opacity-40">Print / Save PDF</button><p className="text-sm text-neutral-500">Select a client and at least one module to preview. For a clean PDF, turn off browser headers and footers.</p></div>
      </section>
      {packet && <section aria-label="Vendor packet preview" className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">{packet}</section>}
    </>}
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
    <header className="vendor-cover"><div className="vendor-brand">{business.business_name}</div><p>Cleaning &bull; Property Services &bull; Specialty Cleaning</p><p>No mess. No stress.</p><h1>Professional Cleaning &amp; Property Service Capabilities</h1><div className="vendor-prepared"><p>Prepared for:</p><h2>{clientName(client)}</h2>{property && <p><strong>Property/Project:</strong> {propertyLabel(property)}</p>}</div>{contact.map(value => <p key={value}>{value}</p>)}<p>StudioScrubz provides professional cleaning and property-service solutions for residential, commercial, property-management, construction, hospitality, and production environments.</p><p>Our approach is built around clearly defined scope, dependable communication, professional service, and documented completion so clients know what is being handled before, during, and after service.</p></header>
    <section><h2>About StudioScrubz</h2><p>StudioScrubz began by cleaning recording studios and production environments, where attention to detail, equipment-conscious work, and respect for active professional spaces were essential.</p><p>The company expanded that service approach into residential, commercial, property-management, post-construction, turnover, and exterior cleaning services.</p><p>Today, StudioScrubz works with clients who need more than a basic cleaning appointment. Our goal is to provide clearly defined service, dependable communication, professional execution, and a documented process from assessment through completion.</p></section>
    <section className="vendor-capabilities"><h2>Selected Service Capabilities</h2>{chosen.map(item => <div className="vendor-module" key={item.title}><h3>{item.title}</h3><ul>{item.bullets.map(bullet => <li key={bullet}>{bullet}</li>)}</ul>{item.note && <p>{item.note}</p>}</div>)}</section>
    <section className="vendor-process"><h2>How We Work</h2><ol>{process.map(step => <li key={step.title}><h3>{step.title}</h3><p>{step.copy}</p></li>)}</ol></section>
    <section className="vendor-strengths"><h2>Why StudioScrubz</h2>{strengths.map(item => <div className="vendor-module" key={item.title}><h3>{item.title}</h3><p>{item.copy}</p></div>)}</section>
    <section><h2>Let&apos;s Build the Right Service Plan</h2><p>Every property and project has different needs. StudioScrubz can assess your facility, define the appropriate scope, and prepare a service proposal based on your priorities.</p><p><strong>{business.business_name}</strong></p>{contact.map(value => <p key={value}>{value}</p>)}<p>This capability overview is not an estimate, proposal, or service agreement. Specific work and pricing are confirmed separately.</p></section>
  </article>;
}

function clientName(client: Client) { return client.company_name?.trim() || [client.first_name, client.last_name].filter(Boolean).join(" ") || "Unnamed client"; }
function propertyLabel(property: Property) { return [property.property_name, property.address, property.address_line_2, property.city, property.state, property.zip].filter(Boolean).join(", "); }
