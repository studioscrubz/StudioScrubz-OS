"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { Client } from "@/types/client";
import { PROPERTY_TYPES, type PropertyInput, type PropertyType, type PropertyWithClient } from "@/types/property";
import { UsStateSelect } from "@/components/forms/UsStateSelect";

type Props = { property: PropertyWithClient | null; clients: Client[]; saving: boolean; onClose: () => void; onSubmit: (input: PropertyInput) => Promise<void> };

export function PropertyFormModal({ property, clients, saving, onClose, onSubmit }: Props) {
  const [clientId, setClientId] = useState(property?.client_id ?? "");
  const [clientSearch, setClientSearch] = useState("");
  const [propertyName, setPropertyName] = useState(property?.property_name ?? "");
  const [propertyType, setPropertyType] = useState<PropertyType>(property?.property_type ?? "Residential");
  const [address, setAddress] = useState(property?.address ?? "");
  const [addressLine2, setAddressLine2] = useState(property?.address_line_2 ?? "");
  const [city, setCity] = useState(property?.city ?? "");
  const [state, setState] = useState(property?.state ?? "");
  const [zip, setZip] = useState(property?.zip ?? "");
  const [squareFeet, setSquareFeet] = useState(numberText(property?.square_feet));
  const [floors, setFloors] = useState(numberText(property?.floors));
  const [bedrooms, setBedrooms] = useState(numberText(property?.bedrooms));
  const [bathrooms, setBathrooms] = useState(numberText(property?.bathrooms));
  const [accessInstructions, setAccessInstructions] = useState(property?.access_instructions ?? "");
  const [notes, setNotes] = useState(property?.notes ?? "");
  const [validationError, setValidationError] = useState<string | null>(null);

  const visibleClients = useMemo(() => {
    const term = clientSearch.trim().toLocaleLowerCase();
    return clients.filter((client) => !term || clientDisplayName(client).toLocaleLowerCase().includes(term));
  }, [clientSearch, clients]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clientId) return setValidationError("Select a client for this property.");
    if (!address.trim()) return setValidationError("Enter a street address.");
    setValidationError(null);
    await onSubmit({
      client_id: clientId,
      property_name: clean(propertyName), property_type: propertyType, address: address.trim(),
      address_line_2: clean(addressLine2), city: clean(city), state: clean(state), zip: clean(zip),
      square_feet: numeric(squareFeet), floors: numeric(floors), bedrooms: numeric(bedrooms), bathrooms: numeric(bathrooms),
      access_instructions: clean(accessInstructions), notes: clean(notes),
    });
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-[#07190a]/60 backdrop-blur-[2px] sm:items-center sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="property-form-title" className="max-h-[94vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:max-w-3xl sm:rounded-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between border-b border-[#143d1a]/10 bg-white px-6 py-5 sm:px-7">
          <div><p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-[#9a7a17]">Service location</p><h2 id="property-form-title" className="mt-1 text-xl font-extrabold text-[#143d1a]">{property ? "Edit Property" : "Add Property"}</h2></div>
          <button type="button" aria-label="Close property form" onClick={onClose} disabled={saving} className="grid size-9 place-items-center rounded-lg border border-neutral-200 text-xl text-neutral-500 disabled:opacity-50">×</button>
        </header>
        <form onSubmit={submit} className="space-y-6 px-6 py-6 sm:px-7">
          <Field label="Client" required>
            <div className="space-y-2"><input type="search" value={clientSearch} onChange={(event) => setClientSearch(event.target.value)} placeholder="Search clients" className={inputClass} /><select value={clientId} onChange={(event) => setClientId(event.target.value)} className={inputClass} required><option value="">Select a client</option>{visibleClients.map((client) => <option key={client.id} value={client.id}>{clientDisplayName(client)}{client.archived_at ? " (Archived)" : ""}</option>)}</select></div>
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Property Name"><input value={propertyName} onChange={(e) => setPropertyName(e.target.value)} className={inputClass} /></Field>
            <Field label="Property Type" required><select value={propertyType} onChange={(e) => setPropertyType(e.target.value as PropertyType)} className={inputClass}>{PROPERTY_TYPES.map((type) => <option key={type}>{type}</option>)}</select></Field>
            <div className="sm:col-span-2"><Field label="Street Address" required><input value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} autoComplete="street-address" required /></Field></div>
            <div className="sm:col-span-2"><Field label="Address Line 2"><input value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} className={inputClass} /></Field></div>
            <Field label="City"><input value={city} onChange={(e) => setCity(e.target.value)} className={inputClass} autoComplete="address-level2" /></Field>
            <div className="grid grid-cols-2 gap-3"><Field label="State"><UsStateSelect value={state} onChange={setState} className={inputClass} /></Field><Field label="ZIP Code"><input value={zip} onChange={(e) => setZip(e.target.value)} className={inputClass} autoComplete="postal-code" /></Field></div>
            <Field label="Square Feet"><NumberField value={squareFeet} setValue={setSquareFeet} /></Field>
            <Field label="Floors"><NumberField value={floors} setValue={setFloors} /></Field>
            <Field label="Bedrooms"><NumberField value={bedrooms} setValue={setBedrooms} /></Field>
            <Field label="Bathrooms"><NumberField value={bathrooms} setValue={setBathrooms} step="0.5" /></Field>
            <div className="sm:col-span-2"><Field label="Access Instructions"><textarea value={accessInstructions} onChange={(e) => setAccessInstructions(e.target.value)} rows={3} className={inputClass} /></Field></div>
            <div className="sm:col-span-2"><Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={inputClass} /></Field></div>
          </div>
          {validationError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{validationError}</p>}
          <footer className="flex flex-col-reverse gap-3 border-t border-neutral-100 pt-5 sm:flex-row sm:justify-end"><button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-neutral-200 px-5 py-2.5 text-sm font-bold text-neutral-600 disabled:opacity-50">Cancel</button><button type="submit" disabled={saving} className="rounded-lg bg-[#143d1a] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60">{saving ? "Saving…" : property ? "Save Changes" : "Create Property"}</button></footer>
        </form>
      </section>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) { return <label className="block"><span className="mb-2 block text-xs font-bold text-neutral-700">{label}{required && <span className="ml-1 text-[#9a7a17]">*</span>}</span>{children}</label>; }
function NumberField({ value, setValue, step = "1" }: { value: string; setValue: (value: string) => void; step?: string }) { return <input type="number" min="0" step={step} value={value} onChange={(e) => setValue(e.target.value)} className={inputClass} />; }
export function clientDisplayName(client: Client | null): string { if (!client) return "Deleted Client"; const contact = [client.first_name, client.last_name].filter(Boolean).join(" "); return client.client_type !== "Residential" ? client.company_name || contact || "Unnamed client" : contact || client.company_name || "Unnamed client"; }
const inputClass = "w-full rounded-lg border border-neutral-200 bg-white px-3.5 py-2.5 text-sm text-neutral-800 outline-none transition focus:border-[#d4af37] focus:ring-2 focus:ring-[#d4af37]/15";
function clean(value: string): string | null { return value.trim() || null; }
function numeric(value: string): number | null { return value === "" ? null : Number(value); }
function numberText(value: number | null | undefined): string { return value == null ? "" : String(value); }
