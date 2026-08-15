"use client";

import { useCallback, useEffect, useState } from "react";
import {
  archiveAddon,
  archiveService,
  createAddon,
  createRecurringPricingRule,
  createService,
  createServicePriceTier,
  getAddons,
  getRecurringPricingRules,
  getServicePriceTiers,
  getServices,
  updateAddon,
  updateRecurringPricingRule,
  updateService,
  updateServicePriceTier,
} from "@/lib/services/serviceCatalog";
import {
  RECURRING_ADJUSTMENT_TYPES,
  SERVICE_DIVISIONS,
  SERVICE_PRICING_MODELS,
  type CatalogService,
  type RecurringPricingRule,
  type ServiceAddon,
  type ServiceInput,
  type ServicePriceTier,
} from "@/types/serviceCatalog";

type Tab = "Services" | "Price Tiers" | "Add-Ons" | "Recurring Pricing";
type RecordRow = CatalogService | ServicePriceTier | ServiceAddon | RecurringPricingRule;
type FormField = { key: string; label: string; type?: "text" | "number" | "checkbox" | "textarea"; options?: readonly { label: string; value: string }[] };

export function ServiceCatalogPage() {
  const [tab, setTab] = useState<Tab>("Services");
  const [services, setServices] = useState<CatalogService[]>([]);
  const [tiers, setTiers] = useState<ServicePriceTier[]>([]);
  const [addons, setAddons] = useState<ServiceAddon[]>([]);
  const [rules, setRules] = useState<RecurringPricingRule[]>([]);
  const [modal, setModal] = useState<{ kind: Tab; value?: RecordRow } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [nextServices, nextTiers, nextAddons, nextRules] = await Promise.all([
      getServices(), getServicePriceTiers(), getAddons(), getRecurringPricingRules(),
    ]);
    setServices(nextServices); setTiers(nextTiers); setAddons(nextAddons); setRules(nextRules);
  }, []);

  useEffect(() => {
    // Initial client-side hydration from the catalog service.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().catch((cause) => setError(message(cause))).finally(() => setLoading(false));
  }, [load]);

  async function run(action: () => Promise<unknown>, success: string) {
    try { await action(); await load(); setNotice(success); setError(null); }
    catch (cause) { setError(message(cause)); }
  }

  const rows: RecordRow[] = tab === "Services" ? services : tab === "Price Tiers" ? tiers : tab === "Add-Ons" ? addons : rules;
  return <>
    <header className="border-b pb-7">
      <h1 className="text-3xl font-extrabold text-[#143d1a]">Service Catalog</h1>
      <p className="mt-3 text-neutral-600">Manage StudioScrubz services, pricing, tiers, add-ons, and recurring rates.</p>
      <button className={`${primary} mt-5`} onClick={() => setModal({ kind: tab })}>+ Add {tab === "Services" ? "Service" : tab.slice(0, -1)}</button>
    </header>
    {error && <Alert text={error} />}{notice && <Alert text={notice} good />}
    <div className="mt-6 flex flex-wrap gap-2">{(["Services", "Price Tiers", "Add-Ons", "Recurring Pricing"] as Tab[]).map((item) =>
      <button key={item} className={item === tab ? primary : secondary} onClick={() => setTab(item)}>{item}</button>)}</div>
    {loading ? <div className="mt-6 h-60 animate-pulse rounded-xl bg-neutral-100" /> :
      <div className="mt-6 overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[900px] text-sm">
        <thead><tr>{headers(tab).map((heading) => <th key={heading} className="p-3 text-left">{heading}</th>)}</tr></thead>
        <tbody>{rows.map((row) => <CatalogRow key={row.id} tab={tab} row={row} services={services}
          edit={() => setModal({ kind: tab, value: row })} run={run} />)}</tbody>
      </table>{!rows.length && <p className="p-8 text-center text-neutral-500">No {tab.toLowerCase()} configured.</p>}</div>}
    {modal && <CatalogForm {...modal} services={services} close={() => setModal(null)} saved={async () => { setModal(null); await load(); setNotice("Catalog saved."); }} />}
  </>;
}

function CatalogRow({ tab, row, services, edit, run }: { tab: Tab; row: RecordRow; services: CatalogService[]; edit: () => void; run: (action: () => Promise<unknown>, success: string) => Promise<void> }) {
  let values: string[];
  let archive: (() => void) | null = null;
  if (tab === "Services") {
    const item = row as CatalogService;
    values = [item.service_name, item.service_code, item.division, item.category, item.pricing_model, money(Math.max(item.base_price, item.minimum_price)), item.is_recurring_available ? "Yes" : "No", item.archived_at ? "Archived" : item.is_active ? "Active" : "Inactive"];
    if (!item.archived_at) archive = () => void run(() => archiveService(item.id), "Service archived.");
  } else if (tab === "Price Tiers") {
    const item = row as ServicePriceTier;
    values = [serviceName(services, item.service_id), item.tier_name, String(item.min_value ?? "—"), String(item.max_value ?? "—"), money(item.price), item.unit_label ?? "—", item.is_active ? "Active" : "Inactive"];
  } else if (tab === "Add-Ons") {
    const item = row as ServiceAddon;
    values = [item.addon_name, item.addon_code, item.division, item.pricing_model, money(item.price), item.is_active ? "Active" : "Inactive", item.archived_at ? "Archived" : "Current"];
    if (!item.archived_at) archive = () => void run(() => archiveAddon(item.id), "Add-on archived.");
  } else {
    const item = row as RecurringPricingRule;
    values = [item.service_id ? serviceName(services, item.service_id) : "All Services", item.frequency, item.adjustment_type, String(item.adjustment_value), item.is_active ? "Active" : "Inactive"];
  }
  return <tr className="border-t"><Cells values={values} /><td className="p-3"><button className={secondary} onClick={edit}>Edit</button>{archive && <button className={secondary} onClick={archive}>Archive</button>}</td></tr>;
}

function CatalogForm({ kind, value, services, close, saved }: { kind: Tab; value?: RecordRow; services: CatalogService[]; close: () => void; saved: () => Promise<void> }) {
  const [data, setData] = useState<Record<string, unknown>>(() => initial(kind, value));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: string, next: string | number | boolean | null) => setData((current) => ({ ...current, [key]: next }));
  async function save() {
    setBusy(true); setError(null);
    try {
      if (kind === "Services") {
        const input = { ...data, pricing_config: (data.pricing_config as Record<string, string | number | boolean> | undefined) ?? {} } as ServiceInput;
        if (value) await updateService(value.id, input); else await createService(input);
      } else if (kind === "Price Tiers") {
        const input = { service_id: String(data.service_id), tier_name: String(data.tier_name), min_value: numberOrNull(data.min_value), max_value: numberOrNull(data.max_value), price: Number(data.price), unit_label: textOrNull(data.unit_label), pricing_config: (data.pricing_config as ServicePriceTier["pricing_config"] | undefined) ?? {}, display_order: Number(data.display_order), is_active: Boolean(data.is_active) };
        if (value) await updateServicePriceTier(value.id, input); else await createServicePriceTier(input);
      } else if (kind === "Add-Ons") {
        const input = { addon_code: String(data.addon_code), addon_name: String(data.addon_name), description: textOrNull(data.description), division: String(data.division) as ServiceAddon["division"], pricing_model: String(data.pricing_model) as ServiceAddon["pricing_model"], pricing_config: (data.pricing_config as Record<string, string | number | boolean> | undefined) ?? {}, price: Number(data.price), unit_label: textOrNull(data.unit_label), is_active: Boolean(data.is_active), display_order: Number(data.display_order) };
        if (value) await updateAddon(value.id, input); else await createAddon(input);
      } else {
        const input = { service_id: textOrNull(data.service_id), frequency: String(data.frequency), adjustment_type: String(data.adjustment_type) as RecurringPricingRule["adjustment_type"], adjustment_value: Number(data.adjustment_value), is_active: Boolean(data.is_active) };
        if (value) await updateRecurringPricingRule(value.id, input); else await createRecurringPricingRule(input);
      }
      await saved();
    } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <div className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-4"><section className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6">
    <button className="float-right" onClick={close}>×</button><h2 className="text-xl font-extrabold text-[#143d1a]">{value ? "Edit" : "Add"} {kind}</h2>
    <div className="mt-5 grid gap-4 sm:grid-cols-2">{formFields(kind, services).map((field) => <Field key={field.key} field={field} value={data[field.key]} set={set} />)}</div>
    {error && <Alert text={error} />}<button disabled={busy} className={`${primary} mt-5`} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button>
  </section></div>;
}

function Field({ field, value, set }: { field: FormField; value: unknown; set: (key: string, value: string | number | boolean | null) => void }) {
  if (field.type === "checkbox") return <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(value)} onChange={(event) => set(field.key, event.target.checked)} />{field.label}</label>;
  if (field.type === "textarea") return <label className="text-sm font-bold sm:col-span-2">{field.label}<textarea className="mt-1 min-h-32 w-full rounded-lg border px-3 py-2" value={String(value ?? "")} onChange={(event) => set(field.key, event.target.value)} /></label>;
  return <label className="text-sm font-bold">{field.label}{field.options ?
    <select className={inputClass} value={String(value ?? "")} onChange={(event) => set(field.key, event.target.value)}>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> :
    <div className="relative">{field.type === "number" && <span className="absolute left-3 top-1/2 -translate-y-1/2">$</span>}<input className={`${inputClass} ${field.type === "number" ? "pl-7" : ""}`} type={field.type ?? "text"} value={String(value ?? "")} onChange={(event) => set(field.key, field.type === "number" ? Number(event.target.value) : event.target.value)} /></div>}</label>;
}

function formFields(kind: Tab, services: CatalogService[]): FormField[] {
  const serviceOptions = [{ label: "Select service", value: "" }, ...services.map((service) => ({ label: service.service_name, value: service.id }))];
  const options = (values: readonly string[]) => values.map((value) => ({ label: value, value }));
  if (kind === "Services") return [{ key: "service_name", label: "Service Name" }, { key: "service_code", label: "Service Code" }, { key: "division", label: "Division", options: options(SERVICE_DIVISIONS) }, { key: "category", label: "Category" }, { key: "description", label: "Service Description", type: "textarea" }, { key: "pricing_model", label: "Pricing Model", options: options(SERVICE_PRICING_MODELS) }, { key: "base_price", label: "Base Price", type: "number" }, { key: "minimum_price", label: "Minimum Price", type: "number" }, { key: "unit_label", label: "Unit Label" }, { key: "display_order", label: "Display Order", type: "number" }, { key: "is_recurring_available", label: "Recurring Available", type: "checkbox" }, { key: "is_active", label: "Active", type: "checkbox" }, { key: "notes", label: "Notes" }];
  if (kind === "Price Tiers") return [{ key: "service_id", label: "Service", options: serviceOptions }, { key: "tier_name", label: "Tier Name" }, { key: "min_value", label: "Minimum", type: "number" }, { key: "max_value", label: "Maximum", type: "number" }, { key: "price", label: "Price", type: "number" }, { key: "unit_label", label: "Unit" }, { key: "display_order", label: "Display Order", type: "number" }, { key: "is_active", label: "Active", type: "checkbox" }];
  if (kind === "Add-Ons") return [{ key: "addon_name", label: "Add-On Name" }, { key: "addon_code", label: "Add-On Code" }, { key: "description", label: "Description" }, { key: "division", label: "Division", options: options(SERVICE_DIVISIONS) }, { key: "pricing_model", label: "Pricing Model", options: options(SERVICE_PRICING_MODELS) }, { key: "price", label: "Price", type: "number" }, { key: "unit_label", label: "Unit" }, { key: "display_order", label: "Display Order", type: "number" }, { key: "is_active", label: "Active", type: "checkbox" }];
  return [{ key: "service_id", label: "Service", options: [{ label: "All Services", value: "" }, ...serviceOptions.slice(1)] }, { key: "frequency", label: "Frequency", options: options(["Weekly", "Biweekly", "Monthly", "Every 4 Weeks", "Multiple Days Per Week"]) }, { key: "adjustment_type", label: "Adjustment Type", options: options(RECURRING_ADJUSTMENT_TYPES) }, { key: "adjustment_value", label: "Adjustment Value", type: "number" }, { key: "is_active", label: "Active", type: "checkbox" }];
}

function initial(kind: Tab, value?: RecordRow): Record<string, unknown> {
  if (value) return { ...value };
  if (kind === "Services") return { service_name: "", service_code: "", division: "Residential", category: "Standard Cleaning", description: null, pricing_model: "Flat Rate", pricing_config: {}, base_price: 0, minimum_price: 0, unit_label: null, is_recurring_available: false, is_active: true, display_order: 0, notes: null };
  if (kind === "Price Tiers") return { service_id: "", tier_name: "", min_value: null, max_value: null, price: 0, unit_label: null, pricing_config: {}, display_order: 0, is_active: true };
  if (kind === "Add-Ons") return { addon_code: "", addon_name: "", description: null, division: "Both", pricing_model: "Flat Rate", pricing_config: {}, price: 0, unit_label: null, is_active: true, display_order: 0 };
  return { service_id: null, frequency: "Weekly", adjustment_type: "Percentage", adjustment_value: 0, is_active: true };
}

function Cells({ values }: { values: string[] }) { return <>{values.map((value, index) => <td className="p-3" key={`${index}-${value}`}>{value}</td>)}</>; }
function headers(tab: Tab) { return tab === "Services" ? ["Service", "Code", "Division", "Category", "Pricing Model", "Starting Price", "Recurring", "Status", "Actions"] : tab === "Price Tiers" ? ["Service", "Tier", "Minimum", "Maximum", "Price", "Unit", "Status", "Actions"] : tab === "Add-Ons" ? ["Add-On", "Code", "Division", "Pricing Model", "Price", "Status", "Archive", "Actions"] : ["Service", "Frequency", "Adjustment", "Value", "Status", "Actions"]; }
function serviceName(services: CatalogService[], id: string) { return services.find((service) => service.id === id)?.service_name ?? "Service"; }
function textOrNull(value: unknown) { const text = String(value ?? "").trim(); return text || null; }
function numberOrNull(value: unknown) { return value === "" || value == null ? null : Number(value); }
function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value); }
function message(cause: unknown) { return cause instanceof Error ? cause.message : "Catalog operation failed."; }
function Alert({ text, good }: { text: string; good?: boolean }) { return <p className={`mt-4 rounded-lg p-3 text-sm font-bold ${good ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{text}</p>; }
const inputClass = "mt-1 h-11 w-full rounded-lg border px-3";
const primary = "rounded-lg bg-[#143d1a] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50";
const secondary = "mr-1 rounded-lg border px-3 py-2 text-xs font-bold text-[#143d1a]";
