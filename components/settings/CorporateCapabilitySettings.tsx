"use client";

import { useEffect, useState } from "react";
import { getCorporateCapabilityProfile, saveCorporateCapabilityProfile } from "@/lib/services/corporateCapability";
import {
  CORPORATE_CAPABILITY_LIMITS,
  emptyCorporateCapabilityProfile,
  type CorporateCapabilityProfile,
} from "@/types/corporateCapability";

const fieldClass = "mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 font-normal text-neutral-900";

export function CorporateCapabilitySettings() {
  const [profile, setProfile] = useState<CorporateCapabilityProfile>(emptyCorporateCapabilityProfile);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; good: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    void getCorporateCapabilityProfile()
      .then((value) => { if (active) setProfile(value); })
      .catch((error: unknown) => { if (active) setMessage({ text: messageFrom(error), good: false }); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function set<K extends keyof CorporateCapabilityProfile>(key: K, value: CorporateCapabilityProfile[K]) {
    setProfile((current) => ({ ...current, [key]: value }));
    setMessage(null);
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setMessage(null);
    try {
      setProfile(await saveCorporateCapabilityProfile(profile));
      setMessage({ text: "Corporate capability profile saved.", good: true });
    } catch (error) {
      setMessage({ text: messageFrom(error), good: false });
    } finally {
      setSaving(false);
    }
  }

  return <section className="mt-6 rounded-xl border bg-white p-4 sm:p-6" aria-labelledby="corporate-capability-heading">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id="corporate-capability-heading" className="text-lg font-extrabold text-[#143d1a]">Corporate Capability Profile</h2>
        <p className="mt-1 max-w-3xl text-sm text-neutral-600">Enter only verified company facts. Leave unknown identifiers, certifications, and performance claims blank; the capability statement generator will not invent them.</p>
      </div>
      <button type="button" disabled={loading || saving} onClick={() => void save()} className="rounded-lg bg-[#143d1a] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? "Saving…" : "Save Capability Profile"}</button>
    </div>

    {message && <p role={message.good ? "status" : "alert"} className={`mt-3 rounded-lg p-3 text-sm ${message.good ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{message.text}</p>}
    {loading ? <div className="mt-4 h-28 animate-pulse rounded-lg bg-neutral-100" /> : <div className="mt-4 space-y-5">
      <label className="block text-sm font-bold">Company Overview<textarea rows={4} maxLength={CORPORATE_CAPABILITY_LIMITS.overview} className={fieldClass} value={profile.overview} onChange={(event) => set("overview", event.target.value)} /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="UEI" value={profile.uei} maxLength={12} placeholder="12 characters" setValue={(value) => set("uei", value.toUpperCase())} />
        <TextField label="CAGE Code" value={profile.cageCode} maxLength={5} placeholder="5 characters" setValue={(value) => set("cageCode", value.toUpperCase())} />
        <TextField label="Primary Contact" value={profile.contactName} maxLength={CORPORATE_CAPABILITY_LIMITS.contactName} setValue={(value) => set("contactName", value)} />
        <TextField label="Contact Title" value={profile.contactTitle} maxLength={CORPORATE_CAPABILITY_LIMITS.contactTitle} setValue={(value) => set("contactTitle", value)} />
      </div>
      <label className="block text-sm font-bold">Service Areas<textarea rows={2} maxLength={CORPORATE_CAPABILITY_LIMITS.serviceAreas} className={fieldClass} placeholder="Verified geographic coverage or service regions" value={profile.serviceAreas} onChange={(event) => set("serviceAreas", event.target.value)} /></label>
      <div className="grid gap-5 xl:grid-cols-2">
        <ListEditor label="Differentiators" items={profile.differentiators} maxItems={CORPORATE_CAPABILITY_LIMITS.differentiators.count} maxLength={CORPORATE_CAPABILITY_LIMITS.differentiators.item} setItems={(items) => set("differentiators", items)} />
        <ListEditor label="Past Performance" items={profile.pastPerformance} maxItems={CORPORATE_CAPABILITY_LIMITS.pastPerformance.count} maxLength={CORPORATE_CAPABILITY_LIMITS.pastPerformance.item} setItems={(items) => set("pastPerformance", items)} />
        <ListEditor label="NAICS Codes" items={profile.naicsCodes} maxItems={CORPORATE_CAPABILITY_LIMITS.naicsCodes.count} maxLength={CORPORATE_CAPABILITY_LIMITS.naicsCodes.item} placeholder="2–6 digits" inputMode="numeric" setItems={(items) => set("naicsCodes", items)} />
        <ListEditor label="Certifications" items={profile.certifications} maxItems={CORPORATE_CAPABILITY_LIMITS.certifications.count} maxLength={CORPORATE_CAPABILITY_LIMITS.certifications.item} setItems={(items) => set("certifications", items)} />
      </div>
    </div>}
  </section>;
}

function TextField({ label, value, maxLength, placeholder, setValue }: { label: string; value: string; maxLength: number; placeholder?: string; setValue: (value: string) => void }) {
  return <label className="text-sm font-bold">{label}<input className={fieldClass} value={value} maxLength={maxLength} placeholder={placeholder} onChange={(event) => setValue(event.target.value)} /></label>;
}

function ListEditor({ label, items, maxItems, maxLength, placeholder, inputMode, setItems }: { label: string; items: string[]; maxItems: number; maxLength: number; placeholder?: string; inputMode?: "numeric"; setItems: (items: string[]) => void }) {
  return <fieldset className="rounded-lg border border-neutral-200 p-3">
    <legend className="px-1 text-sm font-bold text-[#143d1a]">{label}</legend>
    <div className="space-y-2">
      {items.map((item, index) => <div className="flex items-center gap-2" key={`${label}-${index}`}>
        <input aria-label={`${label} ${index + 1}`} className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm" value={item} maxLength={maxLength} placeholder={placeholder} inputMode={inputMode} onChange={(event) => setItems(items.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} />
        <button type="button" className="shrink-0 rounded-lg border px-3 py-2 text-sm font-bold text-neutral-700" aria-label={`Remove ${label} ${index + 1}`} onClick={() => setItems(items.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
      </div>)}
      {!items.length && <p className="text-sm text-neutral-500">No verified entries saved.</p>}
      <button type="button" disabled={items.length >= maxItems} className="rounded-lg border border-[#143d1a]/30 px-3 py-2 text-sm font-bold text-[#143d1a] disabled:opacity-40" onClick={() => setItems([...items, ""])}>Add {label.replace(/s$/, "")}</button>
    </div>
  </fieldset>;
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "The corporate capability profile operation failed.";
}
