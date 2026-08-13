"use client";

import { useState, type FormEvent } from "react";
import { CLIENT_STATUSES, CLIENT_TYPES, type Client, type ClientInput, type ClientStatus, type ClientType } from "@/types/client";

interface ClientFormModalProps {
  client: Client | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (input: ClientInput) => Promise<void>;
}

export function ClientFormModal({ client, saving, onClose, onSubmit }: ClientFormModalProps) {
  const [clientType, setClientType] = useState<ClientType>(client?.client_type ?? "Residential");
  const [firstName, setFirstName] = useState(client?.first_name ?? "");
  const [lastName, setLastName] = useState(client?.last_name ?? "");
  const [companyName, setCompanyName] = useState(client?.company_name ?? "");
  const [phone, setPhone] = useState(client?.phone ?? "");
  const [email, setEmail] = useState(client?.email ?? "");
  const [status, setStatus] = useState<ClientStatus>(client?.status ?? "Lead");
  const [notes, setNotes] = useState(client?.notes ?? "");
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!firstName.trim() && !lastName.trim() && !companyName.trim()) {
      setValidationError("Enter at least a first name, last name, or company name.");
      return;
    }

    setValidationError(null);
    await onSubmit({
      client_type: clientType,
      first_name: clean(firstName),
      last_name: clean(lastName),
      company_name: clean(companyName),
      phone: clean(phone),
      email: clean(email),
      status,
      notes: clean(notes),
    });
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-[#07190a]/60 p-0 backdrop-blur-[2px] sm:items-center sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="client-form-title" className="max-h-[94vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:max-w-2xl sm:rounded-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-[#143d1a]/10 bg-white px-6 py-5 sm:px-7">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#9a7a17]">Client record</p>
            <h2 id="client-form-title" className="mt-1 text-xl font-extrabold text-[#143d1a]">{client ? "Edit Client" : "Add Client"}</h2>
          </div>
          <button type="button" aria-label="Close client form" onClick={onClose} disabled={saving} className="grid size-9 place-items-center rounded-lg border border-neutral-200 text-xl text-neutral-500 hover:bg-neutral-50 disabled:opacity-50">×</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 px-6 py-6 sm:px-7">
          <fieldset>
            <legend className="mb-2 text-xs font-bold text-neutral-700">Client Type</legend>
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-[#f1f4f0] p-1.5">
              {CLIENT_TYPES.map((type) => (
                <label key={type} className={`cursor-pointer rounded-lg px-4 py-2.5 text-center text-sm font-bold transition ${clientType === type ? "bg-white text-[#143d1a] shadow-sm" : "text-neutral-500"}`}>
                  <input type="radio" name="clientType" value={type} checked={clientType === type} onChange={() => setClientType(type)} className="sr-only" />
                  {type}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="First Name"><input value={firstName} onChange={(event) => setFirstName(event.target.value)} className={inputClass} autoComplete="given-name" /></Field>
            <Field label="Last Name"><input value={lastName} onChange={(event) => setLastName(event.target.value)} className={inputClass} autoComplete="family-name" /></Field>
            <div className="sm:col-span-2"><Field label="Company Name" hint={clientType === "Residential" ? "Optional for residential clients" : undefined}><input value={companyName} onChange={(event) => setCompanyName(event.target.value)} className={inputClass} autoComplete="organization" /></Field></div>
            <Field label="Phone Number"><input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} className={inputClass} autoComplete="tel" /></Field>
            <Field label="Email Address"><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} autoComplete="email" /></Field>
            <Field label="Status">
              <select value={status} onChange={(event) => setStatus(event.target.value as ClientStatus)} className={inputClass}>
                {CLIENT_STATUSES.map((item) => <option key={item}>{item}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Notes"><textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} className={`${inputClass} resize-y`} /></Field>

          {validationError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{validationError}</p>}

          <div className="flex flex-col-reverse gap-3 border-t border-neutral-100 pt-5 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-neutral-200 px-5 py-2.5 text-sm font-bold text-neutral-600 hover:bg-neutral-50 disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-lg bg-[#143d1a] px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-[#0d2b12] disabled:cursor-not-allowed disabled:opacity-60">{saving ? "Saving…" : client ? "Save Changes" : "Create Client"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center justify-between text-xs font-bold text-neutral-700"><span>{label}</span>{hint && <span className="font-medium text-neutral-400">{hint}</span>}</span>
      {children}
    </label>
  );
}

const inputClass = "w-full rounded-lg border border-neutral-200 bg-white px-3.5 py-2.5 text-sm text-neutral-800 outline-none transition placeholder:text-neutral-300 focus:border-[#d4af37] focus:ring-2 focus:ring-[#d4af37]/15";

function clean(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}
