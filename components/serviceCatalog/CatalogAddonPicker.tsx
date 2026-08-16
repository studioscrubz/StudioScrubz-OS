"use client";

import type { ServiceAddon } from "@/types/serviceCatalog";

export function CatalogAddonPicker({ addons, selected, setSelected }: { addons: ServiceAddon[]; selected: string[]; setSelected: (value: string[]) => void }) {
  const remaining = addons.filter((addon) => !selected.includes(addon.addon_name));
  return <fieldset><legend className="mb-2 text-xs font-bold text-neutral-700">Catalog Add-Ons</legend>{addons.length === 0 ? <p className="rounded-lg border border-dashed bg-neutral-50 p-3 text-sm text-neutral-500">No Add-Ons configured for this service.</p> : <select value="" disabled={remaining.length === 0} onChange={(event) => { if (event.target.value && !selected.includes(event.target.value)) setSelected([...selected, event.target.value]); }} className={inputClass}><option value="">{remaining.length === 0 ? "All available Add-Ons selected" : "Select Add-On"}</option>{remaining.map((addon) => <option key={addon.id} value={addon.addon_name}>{addon.addon_name} — {money(addon.price)}</option>)}</select>}<div className="mt-3 space-y-2">{selected.map((name) => { const addon = addons.find((item) => item.addon_name === name); return addon ? <div key={addon.id} className="flex items-start justify-between gap-4 rounded-lg border bg-neutral-50 p-3"><div><p className="text-sm font-bold text-[#143d1a]">{addon.addon_name} — {money(addon.price)}</p>{addon.description && <p className="mt-1 text-xs text-neutral-500">{addon.description}</p>}<p className="mt-1 text-xs text-neutral-400">{addon.pricing_model}{addon.unit_label ? ` · ${addon.unit_label}` : ""}</p></div><button type="button" onClick={() => setSelected(selected.filter((item) => item !== name))} className="text-xs font-bold text-red-700">Remove</button></div> : null; })}</div></fieldset>;
}

function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value); }
const inputClass = "w-full rounded-lg border border-neutral-200 bg-white px-3.5 py-2.5 text-sm text-neutral-800 outline-none focus:border-[#d4af37] focus:ring-2 focus:ring-[#d4af37]/15 disabled:bg-neutral-50 disabled:text-neutral-500";
