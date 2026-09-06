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
  { title: "Commercial Cleaning", copy: "Cleaning for offices and commercial facilities, with recurring janitorial service, one-time detail cleaning, and common-area care. Facility walkthroughs help define priorities and service frequency." },
  { title: "Property Management & Common Areas", copy: "Recurring cleaning for apartment communities and multifamily properties: lobbies, hallways, stairwells, laundry rooms, leasing and community areas, and fitness and amenity spaces. Property walkthroughs establish the areas and service plan." },
  { title: "Unit Turns", copy: "Vacant-unit cleaning for move-in readiness, including kitchens, bathrooms, floors, and fixtures, with cabinets and closets when included in scope. Turnover schedules and access are coordinated before service. Cleaning does not include repairs, painting, or maintenance." },
  { title: "Post-Construction Cleaning", copy: "Fine construction dust removal and surface detailing for floors, baseboards, trim, fixtures, kitchens, bathrooms, cabinets, and suitable built-ins. Interior glass is included when scoped, with final presentation and readiness cleaning. Hazardous-material cleanup, asbestos handling, mold remediation, heavy debris hauling, and trade work are excluded." },
  { title: "Pressure Washing", copy: "Exterior cleaning for suitable concrete, walkways, patios, entry areas, driveways, and property common areas. Surface material, condition, access, and cleaning needs are assessed before scope is confirmed; not every surface is suitable for pressure washing." },
  { title: "Recording & Production Facilities", copy: "Cleaning for recording studios and production environments, including control-room and common-area surfaces, lounges, kitchens, restrooms, and floors. Work is planned around facility layout and operating needs. Sensitive electronic and audio equipment servicing, internal cleaning, and repairs are excluded." },
  { title: "Residential Cleaning", copy: "Standard cleaning, deep cleaning, move-in and move-out cleaning, and recurring upkeep based on the home's condition and priorities. Requested add-ons are confirmed as part of the service scope." },
  { title: "Airbnb / Turnover Cleaning", copy: "Cleaning for bedrooms, living spaces, kitchens, bathrooms, floors, and surfaces, with a property reset and presentation review. Laundry, linen handling, and restocking are included only when agreed. Timing, access, and property-specific turnover requirements are confirmed in advance." },
] as const;
const strengths = ["Clear service scope", "Professional estimates and proposals", "Walkthrough or project assessment when appropriate", "Residential and commercial capability", "One-time and recurring service options", "Professional customer communication", "Secure payment process", "Final service review", "Customizable service and add-on scope"];
const process = ["Understand the property or project", "Confirm cleaning needs", "Walkthrough or assessment when appropriate", "Define the scope", "Prepare an estimate or proposal", "Coordinate scheduling", "Perform the service", "Complete a final review"];
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
        .vendor-document .vendor-capabilities { break-inside: auto; }
      }
    `}</style>
  </>;
}

function Packet({ client, property, business, chosen }: { client: Client; property?: Property; business: BusinessSettings; chosen: ReadonlyArray<(typeof modules)[number]> }) {
  const contact = [business.business_phone, business.business_email, business.website].filter(Boolean);
  return <article className="vendor-document">
    <header className="vendor-cover"><div className="vendor-brand">{business.business_name}</div><p>No mess. No stress.</p><h1>Professional Cleaning &amp; Property Service Capabilities</h1><div className="vendor-prepared"><p>Prepared For</p><h2>{clientName(client)}</h2>{property && <p>{propertyLabel(property)}</p>}</div><p>This packet introduces StudioScrubz and the capabilities relevant to your property, facility, or project. The selected services provide a starting point for a conversation about your cleaning needs and priorities.</p></header>
    <section><h2>About StudioScrubz</h2><p>StudioScrubz began by cleaning recording studios and production environments, where attention to detail, equipment-conscious work, and respect for active professional spaces were essential.</p><p>The company expanded that service approach into residential, commercial, property-management, post-construction, turnover, and exterior cleaning services.</p></section>
    <section><h2>How We Work</h2><ol>{process.map(step => <li key={step}>{step}</li>)}</ol></section>
    <section className="vendor-capabilities"><h2>Capabilities for Your Property or Project</h2>{chosen.map(item => <div className="vendor-module" key={item.title}><h3>{item.title}</h3><p>{item.copy}</p></div>)}</section>
    <section><h2>Why StudioScrubz</h2><ul>{strengths.map(item => <li key={item}>{item}</li>)}</ul></section>
    <section><h2>Let&apos;s Review Your Property or Project</h2><p>We can review your facility, property, or project and prepare a cleaning plan and estimate based on the required scope. Together, we confirm service details, access, and scheduling needs before work begins.</p><p><strong>{business.business_name}</strong></p>{contact.map(value => <p key={value}>{value}</p>)}<p>This capability overview is not an estimate, proposal, or service agreement. Specific work and pricing are confirmed separately.</p></section>
  </article>;
}

function clientName(client: Client) { return client.company_name?.trim() || [client.first_name, client.last_name].filter(Boolean).join(" ") || "Unnamed client"; }
function propertyLabel(property: Property) { return [property.property_name, property.address, property.address_line_2, property.city, property.state, property.zip].filter(Boolean).join(", "); }
