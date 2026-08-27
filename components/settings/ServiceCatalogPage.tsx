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
  getOrCreateServiceLabel,
  getServiceLabelAssignments,
  getServiceLabels,
  getServicePriceTiers,
  getServices,
  setServiceLabels,
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
  type ServiceLabel,
  type ServiceLabelAssignment,
  type ServicePriceTier,
} from "@/types/serviceCatalog";

type Tab = "Services" | "Price Tiers" | "Add-Ons" | "Recurring Pricing";
type RecordRow = CatalogService | ServicePriceTier | ServiceAddon | RecurringPricingRule;
type FormField = { key: string; label: string; type?: "text" | "number" | "checkbox" | "textarea"; options?: readonly { label: string; value: string }[] };
type PricingConfig = Record<string, string | number | boolean>;

export function ServiceCatalogPage() {
  const [tab, setTab] = useState<Tab>("Services");
  const [services, setServices] = useState<CatalogService[]>([]);
  const [tiers, setTiers] = useState<ServicePriceTier[]>([]);
  const [addons, setAddons] = useState<ServiceAddon[]>([]);
  const [rules, setRules] = useState<RecurringPricingRule[]>([]);
  const [labels, setLabels] = useState<ServiceLabel[]>([]);
  const [labelAssignments, setLabelAssignments] = useState<ServiceLabelAssignment[]>([]);
  const [modal, setModal] = useState<{ kind: Tab; value?: RecordRow } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [nextServices, nextTiers, nextAddons, nextRules, nextLabels, nextLabelAssignments] = await Promise.all([
      getServices(), getServicePriceTiers(), getAddons(), getRecurringPricingRules(), getServiceLabels(), getServiceLabelAssignments(),
    ]);
    setServices(nextServices); setTiers(nextTiers); setAddons(nextAddons); setRules(nextRules); setLabels(nextLabels); setLabelAssignments(nextLabelAssignments);
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
    {tab === "Recurring Pricing" && <p className="mt-4 rounded-xl border border-[#d4af37]/40 bg-[#fffdf5] p-4 text-sm text-neutral-700"><b className="text-[#143d1a]">All Services</b> applies the configured frequency rule to every eligible Service Catalog service across Estimates, Proposals, and directly created Service Agreements. A service-specific rule for the same frequency takes precedence. Proposal-generated Agreements preserve the accepted Proposal pricing snapshot.</p>}
    {loading ? <div className="mt-6 h-60 animate-pulse rounded-xl bg-neutral-100" /> :
      <div className="mt-6 overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[900px] text-sm">
        <thead><tr>{headers(tab).map((heading) => <th key={heading} className="p-3 text-left">{heading}</th>)}</tr></thead>
        <tbody>{rows.map((row) => <CatalogRow key={row.id} tab={tab} row={row} services={services} labels={labels} labelAssignments={labelAssignments}
          edit={() => setModal({ kind: tab, value: row })} run={run} />)}</tbody>
      </table>{!rows.length && <p className="p-8 text-center text-neutral-500">No {tab.toLowerCase()} configured.</p>}</div>}
    {modal && <CatalogForm {...modal} services={services} labels={labels} labelAssignments={labelAssignments} close={() => setModal(null)} saved={async () => { setModal(null); await load(); setNotice("Catalog saved."); }} />}
  </>;
}

function CatalogRow({ tab, row, services, labels, labelAssignments, edit, run }: { tab: Tab; row: RecordRow; services: CatalogService[]; labels: ServiceLabel[]; labelAssignments: ServiceLabelAssignment[]; edit: () => void; run: (action: () => Promise<unknown>, success: string) => Promise<void> }) {
  let values: string[];
  let archive: (() => void) | null = null;
  if (tab === "Services") {
    const item = row as CatalogService;
    const itemLabels = labelAssignments.filter(assignment => assignment.service_id === item.id).map(assignment => labels.find(label => label.id === assignment.label_id)).filter((label): label is ServiceLabel => Boolean(label));
    if (!item.archived_at) archive = () => void run(() => archiveService(item.id), "Service archived.");
    return <tr className="border-t"><Cells values={[item.service_name, item.service_code, item.division, item.category]} /><td className="p-3"><div className="flex max-w-64 flex-wrap gap-1">{itemLabels.map(label => <span key={label.id} className="rounded-full bg-[#143d1a]/10 px-2 py-1 text-xs font-bold text-[#143d1a]">{label.name}</span>)}{!itemLabels.length && <span className="text-neutral-400">—</span>}</div></td><Cells values={[item.pricing_model, money(Math.max(item.base_price, item.minimum_price)), item.is_recurring_available ? "Yes" : "No", item.archived_at ? "Archived" : item.is_active ? "Active" : "Inactive"]} /><td className="p-3"><button className={secondary} onClick={edit}>Edit</button>{archive && <button className={secondary} onClick={archive}>Archive</button>}</td></tr>;
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

function CatalogForm({ kind, value, services, labels, labelAssignments, close, saved }: { kind: Tab; value?: RecordRow; services: CatalogService[]; labels: ServiceLabel[]; labelAssignments: ServiceLabelAssignment[]; close: () => void; saved: () => Promise<void> }) {
  const [data, setData] = useState<Record<string, unknown>>(() => initial(kind, value));
  const [availableLabels, setAvailableLabels] = useState(labels);
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>(() => value && kind === "Services" ? labelAssignments.filter(assignment => assignment.service_id === value.id).map(assignment => assignment.label_id) : []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: string, next: string | number | boolean | null) => setData((current) => ({ ...current, [key]: next }));
  async function save() {
    setBusy(true); setError(null);
    try {
      if (kind === "Services") {
        const input = { ...data, pricing_config: pricingConfig(data.pricing_config) } as ServiceInput;
        const service = value ? await updateService(value.id, input) : await createService(input);
        await setServiceLabels(service.id, selectedLabelIds);
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
    {kind === "Services" && <ServiceLabelsField labels={availableLabels} selected={selectedLabelIds} setSelected={setSelectedLabelIds} addLabel={async name => { const label=await getOrCreateServiceLabel(name); setAvailableLabels(current => [...current.filter(item => item.id !== label.id), label].sort((a,b) => a.name.localeCompare(b.name))); setSelectedLabelIds(current => current.includes(label.id) ? current : [...current, label.id]); }} />}
    {kind === "Services" && data.pricing_model === "Custom" && <ProductionPricingFields config={pricingConfig(data.pricing_config)} set={(key, next) => setData((current) => ({ ...current, pricing_config: { ...pricingConfig(current.pricing_config), [key]: next } }))} />}
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

function ServiceLabelsField({ labels, selected, setSelected, addLabel }: { labels: ServiceLabel[]; selected: string[]; setSelected: (ids: string[]) => void; addLabel: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function create() {
    const nextName = name.trim();
    if (!nextName) return;
    setBusy(true); setError(null);
    try { await addLabel(nextName); setName(""); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  return <section className="mt-6 rounded-xl border border-[#143d1a]/10 bg-neutral-50 p-4">
    <h3 className="font-extrabold text-[#143d1a]">Internal Labels</h3>
    <p className="mt-1 text-sm text-neutral-600">Reusable internal tags for catalog organization and future promotion targeting. They are not customer-facing.</p>
    <div className="mt-4 flex flex-wrap gap-2">{labels.map(label => {
      const active=selected.includes(label.id);
      return <button type="button" key={label.id} aria-pressed={active} className={`rounded-full border px-3 py-1.5 text-xs font-bold ${active ? "border-[#143d1a] bg-[#143d1a] text-white" : "border-neutral-300 bg-white text-neutral-700"}`} onClick={() => setSelected(active ? selected.filter(id => id !== label.id) : [...selected, label.id])}>{label.name}</button>;
    })}{!labels.length && <span className="text-sm text-neutral-500">No labels created yet.</span>}</div>
    <div className="mt-4 flex max-w-md gap-2"><input aria-label="New internal label" className="h-10 flex-1 rounded-lg border bg-white px-3 text-sm" value={name} maxLength={80} placeholder="Create a label" onChange={event => setName(event.target.value)} onKeyDown={event => { if(event.key==="Enter"){event.preventDefault();void create();} }} /><button type="button" disabled={busy || !name.trim()} className={secondary} onClick={() => void create()}>{busy ? "Adding…" : "Add label"}</button></div>
    {error && <Alert text={error} />}
  </section>;
}

const productionPricingFields = [
  ["production_rate", "Production Rate", "Square feet per labor hour"],
  ["restroom_hours", "Restroom Labor Hours", "Hours per restroom"],
  ["kitchen_hours", "Kitchen Labor Hours", "Hours per kitchen"],
  ["station_hours", "Station Labor Hours", "Hours per workstation"],
  ["unit_hours", "Unit / Bedroom Labor Hours", "Hours per unit or bedroom"],
  ["additional_floor_hours", "Additional Floor Labor Hours", "Hours per additional floor"],
  ["minimum_supply_cost", "Minimum Supply / Material Cost", "Dollars"],
  ["supply_cost_per_square_foot", "Supply / Material Cost Per Square Foot", "Dollars per square foot"],
  ["maximum_margin_percent", "Maximum Margin Percent", "Percent"],
  ["minimum_margin_denominator", "Minimum Margin Denominator", "Decimal, for example 0.15"],
] as const;
const completePricingFields = [
  ["default_target_completion_hours", "Default Target Completion Hours", "Hours"],
  ["default_worker_hourly_pay", "Default Worker Hourly Pay", "Dollars per hour"],
  ["default_target_profit_margin_percent", "Default Target Profit Margin Percent", "Percent"],
] as const;

function ProductionPricingFields({ config, set }: { config: PricingConfig; set: (key: string, value: number) => void }) {
  const fields = config.requires_complete_pricing_config ? [...productionPricingFields, ...completePricingFields] : productionPricingFields;
  return <section className="mt-6 rounded-xl border border-[#143d1a]/10 bg-neutral-50 p-4"><h3 className="font-extrabold text-[#143d1a]">Production Pricing</h3><p className="mt-1 text-sm text-neutral-600">Configure the labor, material, and margin inputs used by the estimate calculator.</p><div className="mt-4 grid gap-4 sm:grid-cols-2">{fields.map(([key, label, hint]) => <label className="text-sm font-bold" key={key}>{label}<input className={inputClass} type="number" min="0" step="any" value={Number(config[key] ?? 0)} onChange={(event) => set(key, Number(event.target.value))}/><span className="mt-1 block text-xs font-normal text-neutral-500">{hint}</span></label>)}</div></section>;
}

function formFields(kind: Tab, services: CatalogService[]): FormField[] {
  const serviceOptions = [{ label: "Select service", value: "" }, ...services.map((service) => ({ label: service.service_name, value: service.id }))];
  const options = (values: readonly string[]) => values.map((value) => ({ label: value, value }));
  if (kind === "Services") return [{ key: "service_name", label: "Service Name" }, { key: "service_code", label: "Service Code" }, { key: "division", label: "Division", options: options(SERVICE_DIVISIONS) }, { key: "category", label: "Category" }, { key: "description", label: "Service Description", type: "textarea" }, { key: "pricing_model", label: "Pricing Model", options: options(SERVICE_PRICING_MODELS) }, { key: "base_price", label: "Base Price", type: "number" }, { key: "minimum_price", label: "Minimum Price", type: "number" }, { key: "unit_label", label: "Unit Label" }, { key: "display_order", label: "Display Order", type: "number" }, { key: "is_recurring_available", label: "Recurring Available", type: "checkbox" }, { key: "is_active", label: "Active", type: "checkbox" }, { key: "notes", label: "Notes" }];
  if (kind === "Price Tiers") return [{ key: "service_id", label: "Service", options: serviceOptions }, { key: "tier_name", label: "Tier Name" }, { key: "min_value", label: "Minimum", type: "number" }, { key: "max_value", label: "Maximum", type: "number" }, { key: "price", label: "Price", type: "number" }, { key: "unit_label", label: "Unit" }, { key: "display_order", label: "Display Order", type: "number" }, { key: "is_active", label: "Active", type: "checkbox" }];
  if (kind === "Add-Ons") return [{ key: "addon_name", label: "Add-On Name" }, { key: "addon_code", label: "Add-On Code" }, { key: "description", label: "Description" }, { key: "division", label: "Division", options: options(SERVICE_DIVISIONS) }, { key: "pricing_model", label: "Pricing Model", options: options(SERVICE_PRICING_MODELS) }, { key: "price", label: "Price", type: "number" }, { key: "unit_label", label: "Unit" }, { key: "display_order", label: "Display Order", type: "number" }, { key: "is_active", label: "Active", type: "checkbox" }];
  return [{ key: "service_id", label: "Service", options: [{ label: "All Services", value: "" }, ...serviceOptions.slice(1)] }, { key: "frequency", label: "Frequency", options: options(["Daily", "Weekly", "Biweekly", "Monthly", "One-Time", "Every 4 Weeks", "Multiple Days Per Week"]) }, { key: "adjustment_type", label: "Adjustment Type", options: options(RECURRING_ADJUSTMENT_TYPES) }, { key: "adjustment_value", label: "Adjustment Value", type: "number" }, { key: "is_active", label: "Active", type: "checkbox" }];
}

function initial(kind: Tab, value?: RecordRow): Record<string, unknown> {
  if (value) return { ...value };
  if (kind === "Services") return { service_name: "", service_code: "", division: "Residential", category: "Standard Cleaning", description: null, pricing_model: "Flat Rate", pricing_config: {}, base_price: 0, minimum_price: 0, unit_label: null, is_recurring_available: false, is_active: true, display_order: 0, notes: null };
  if (kind === "Price Tiers") return { service_id: "", tier_name: "", min_value: null, max_value: null, price: 0, unit_label: null, pricing_config: {}, display_order: 0, is_active: true };
  if (kind === "Add-Ons") return { addon_code: "", addon_name: "", description: null, division: "Both", pricing_model: "Flat Rate", pricing_config: {}, price: 0, unit_label: null, is_active: true, display_order: 0 };
  return { service_id: null, frequency: "Weekly", adjustment_type: "Percentage", adjustment_value: 0, is_active: true };
}

function Cells({ values }: { values: string[] }) { return <>{values.map((value, index) => <td className="p-3" key={`${index}-${value}`}>{value}</td>)}</>; }
function headers(tab: Tab) { return tab === "Services" ? ["Service", "Code", "Division", "Category", "Internal Labels", "Pricing Model", "Starting Price", "Recurring", "Status", "Actions"] : tab === "Price Tiers" ? ["Service", "Tier", "Minimum", "Maximum", "Price", "Unit", "Status", "Actions"] : tab === "Add-Ons" ? ["Add-On", "Code", "Division", "Pricing Model", "Price", "Status", "Archive", "Actions"] : ["Service", "Frequency", "Adjustment", "Value", "Status", "Actions"]; }
function serviceName(services: CatalogService[], id: string) { return services.find((service) => service.id === id)?.service_name ?? "Service"; }
function textOrNull(value: unknown) { const text = String(value ?? "").trim(); return text || null; }
function numberOrNull(value: unknown) { return value === "" || value == null ? null : Number(value); }
function pricingConfig(value: unknown): PricingConfig { return value && !Array.isArray(value) && typeof value === "object" ? value as PricingConfig : {}; }
function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value); }
function message(cause: unknown) { if(cause instanceof Error)return cause.message;if(cause&&typeof cause==="object"&&"message" in cause&&typeof cause.message==="string")return cause.message;return "Catalog operation failed. Please try again or contact an administrator."; }
function Alert({ text, good }: { text: string; good?: boolean }) { return <p className={`mt-4 rounded-lg p-3 text-sm font-bold ${good ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{text}</p>; }
const inputClass = "mt-1 h-11 w-full rounded-lg border px-3";
const primary = "rounded-lg bg-[#143d1a] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50";
const secondary = "mr-1 rounded-lg border px-3 py-2 text-xs font-bold text-[#143d1a]";
