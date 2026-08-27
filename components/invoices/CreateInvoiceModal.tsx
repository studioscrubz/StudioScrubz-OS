"use client";
import { useEffect, useMemo, useState } from "react";
import { getBusinessSettings } from "@/lib/services/businessSettings";
import { getClients } from "@/lib/services/clients";
import {
  createStandaloneInvoice,
  previewInvoiceAmounts,
} from "@/lib/services/invoices";
import { getProperties } from "@/lib/services/properties";
import { getActiveServices } from "@/lib/services/serviceCatalog";
import type { Client } from "@/types/client";
import type { InvoiceLineItem, InvoiceWithRelations } from "@/types/invoice";
import type { PropertyWithClient } from "@/types/property";
import type { CatalogService } from "@/types/serviceCatalog";

const input =
  "w-full rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-sm";
const primary =
  "rounded-lg bg-[#143d1a] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50";
const secondary =
  "rounded-lg border border-neutral-200 px-3 py-2 text-sm font-bold text-[#143d1a] disabled:opacity-50";
const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const displayClient = (x: Client) =>
  x.company_name?.trim() ||
  [x.first_name, x.last_name].filter(Boolean).join(" ") ||
  "Unnamed Client";
const displayProperty = (x: PropertyWithClient) =>
  x.property_name?.trim() ||
  [x.address, x.city, x.state, x.zip].filter(Boolean).join(", ");
type InvoiceLineDraft = {
  id: string;
  description: string;
  quantity: string;
  rate: string;
};
const newItem = (): InvoiceLineDraft => ({
  id: crypto.randomUUID(),
  description: "",
  quantity: "1",
  rate: "",
});
const draftItems = (items: InvoiceLineDraft[]): InvoiceLineItem[] =>
  items.map((item) => ({
    id: item.id,
    description: item.description,
    quantity: item.quantity.trim() === "" ? Number.NaN : Number(item.quantity),
    rate: item.rate.trim() === "" ? Number.NaN : Number(item.rate),
    amount: 0,
  }));

export function CreateInvoiceModal({
  close,
  saved,
}: {
  close: () => void;
  saved: (invoice: InvoiceWithRelations) => Promise<void>;
}) {
  const [clients, setClients] = useState<Client[]>([]),
    [properties, setProperties] = useState<PropertyWithClient[]>([]),
    [services, setServices] = useState<CatalogService[]>([]);
  const [clientId, setClientId] = useState(""),
    [propertyId, setPropertyId] = useState(""),
    [clientName, setClientName] = useState(""),
    [propertyName, setPropertyName] = useState("");
  const [email, setEmail] = useState(""),
    [phone, setPhone] = useState(""),
    [serviceId, setServiceId] = useState("custom"),
    [serviceName, setServiceName] = useState("");
  const [issueDate, setIssueDate] = useState(localDate()),
    [dueDate, setDueDate] = useState(""),
    [items, setItems] = useState<InvoiceLineDraft[]>([newItem()]);
  const [discount, setDiscount] = useState(0),
    [tax, setTax] = useState(0),
    [notes, setNotes] = useState(""),
    [customerNotes, setCustomerNotes] = useState(""),
    [terms, setTerms] = useState("");
  const [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.all([
      getClients(),
      getProperties(),
      getActiveServices(),
      getBusinessSettings(),
    ])
      .then(([clientRows, propertyRows, serviceRows, settings]) => {
        if (!active) return;
        setClients(clientRows.filter((x) => !x.archived_at));
        setProperties(propertyRows.filter((x) => !x.archived_at));
        setServices(serviceRows);
        setTerms(
          settings.default_invoice_terms ??
            settings.default_payment_terms ??
            "",
        );
        const due = new Date(`${localDate()}T12:00:00`);
        due.setDate(due.getDate() + settings.default_invoice_due_days);
        setDueDate(localDate(due));
      })
      .catch((cause) =>
        setError(message(cause, "Invoice form data could not be loaded.")),
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const availableProperties = useMemo(
    () => properties.filter((x) => x.client_id === clientId),
    [clientId, properties],
  );
  const totals = useMemo(
    () => previewInvoiceAmounts(draftItems(items), discount, tax),
    [discount, items, tax],
  );
  function chooseClient(id: string) {
    setClientId(id);
    setPropertyId("");
    setPropertyName("");
    const client = clients.find((x) => x.id === id);
    setClientName(client ? displayClient(client) : "");
    setEmail(client?.email ?? "");
    setPhone(client?.phone ?? "");
  }
  function chooseProperty(id: string) {
    setPropertyId(id);
    const property = properties.find((x) => x.id === id);
    setPropertyName(property ? displayProperty(property) : "");
  }
  function chooseService(id: string) {
    setServiceId(id);
    const service = services.find((x) => x.id === id);
    if (!service) return;
    setServiceName(service.service_name);
    setItems((current) =>
      current.map((line, index) =>
        index === 0 && !line.description.trim()
          ? {
              ...line,
              description: service.description?.trim() || service.service_name,
            }
          : line,
      ),
    );
  }
  function changeItem(
    id: string,
    key: "description" | "quantity" | "rate",
    value: string,
  ) {
    setItems((current) =>
      current.map((line) =>
        line.id === id ? { ...line, [key]: value } : line,
      ),
    );
  }
  async function submit() {
    setError(null);
    setSaving(true);
    try {
      const created = await createStandaloneInvoice({
        client_id: clientId,
        property_id: propertyId,
        client_name: clientName,
        property_name: propertyName,
        customer_email: email || null,
        customer_phone: phone || null,
        service_name: serviceName,
        issue_date: issueDate,
        due_date: dueDate || null,
        line_items: draftItems(items),
        discount,
        tax,
        notes: notes || null,
        customer_notes: customerNotes || null,
        terms: terms || null,
      });
      await saved(created);
    } catch (cause) {
      setError(message(cause, "Invoice could not be created."));
      setSaving(false);
    }
  }
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center overflow-y-auto bg-[#07190a]/70 p-5">
      <section className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white p-6">
        <button onClick={close} className="float-right text-xl">
          ×
        </button>
        <h2 className="text-xl font-extrabold text-[#143d1a]">
          Create Standalone Invoice
        </h2>
        <p className="mt-2 text-sm text-neutral-600">
          Create an Invoice directly from an existing Client and Property. No
          upstream workflow record will be created.
        </p>
        {error && (
          <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">
            {error}
          </p>
        )}
        {loading ? (
          <div className="mt-6 h-48 animate-pulse rounded-xl bg-neutral-100" />
        ) : (
          <div className="mt-6 space-y-6">
            <section>
              <h3 className="font-extrabold text-[#143d1a]">
                Customer & Service Location
              </h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Label text="Existing Client *">
                  <select
                    className={input}
                    value={clientId}
                    onChange={(e) => chooseClient(e.target.value)}
                  >
                    <option value="">Select Client</option>
                    {clients.map((x) => (
                      <option key={x.id} value={x.id}>
                        {displayClient(x)}
                      </option>
                    ))}
                  </select>
                </Label>
                <Label text="Existing Property *">
                  <select
                    className={input}
                    value={propertyId}
                    onChange={(e) => chooseProperty(e.target.value)}
                    disabled={!clientId}
                  >
                    <option value="">Select Property</option>
                    {availableProperties.map((x) => (
                      <option key={x.id} value={x.id}>
                        {displayProperty(x)}
                      </option>
                    ))}
                  </select>
                </Label>
                <Field
                  label="Invoice Customer Name *"
                  value={clientName}
                  set={setClientName}
                />
                <Field
                  label="Invoice Property / Location *"
                  value={propertyName}
                  set={setPropertyName}
                />
                <Field
                  label="Email"
                  type="email"
                  value={email}
                  set={setEmail}
                />
                <Field label="Phone" type="tel" value={phone} set={setPhone} />
              </div>
            </section>
            <section>
              <h3 className="font-extrabold text-[#143d1a]">Invoice</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Label text="Catalog Service">
                  <select
                    className={input}
                    value={serviceId}
                    onChange={(e) => chooseService(e.target.value)}
                  >
                    <option value="custom">Custom service</option>
                    {services.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.service_name}
                      </option>
                    ))}
                  </select>
                </Label>
                <Field
                  label="Service Name *"
                  value={serviceName}
                  set={setServiceName}
                />
                <Field
                  label="Issue Date *"
                  type="date"
                  value={issueDate}
                  set={setIssueDate}
                />
                <Field
                  label="Due Date"
                  type="date"
                  value={dueDate}
                  set={setDueDate}
                />
              </div>
            </section>
            <section>
              <div className="flex items-center justify-between">
                <h3 className="font-extrabold text-[#143d1a]">Line Items</h3>
                <button
                  type="button"
                  className={secondary}
                  onClick={() => setItems((current) => [...current, newItem()])}
                >
                  Add Line Item
                </button>
              </div>
              <div className="mt-3 space-y-3">
                {items.map((line, index) => (
                  <div
                    key={line.id}
                    className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[1fr_90px_120px_110px_auto]"
                  >
                    <input
                      aria-label="Description"
                      className={input}
                      placeholder="Description"
                      value={line.description}
                      onChange={(e) =>
                        changeItem(line.id, "description", e.target.value)
                      }
                    />
                    <input
                      aria-label="Quantity"
                      className={input}
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={line.quantity}
                      onChange={(e) =>
                        changeItem(line.id, "quantity", e.target.value)
                      }
                    />
                    <input
                      aria-label="Rate"
                      className={input}
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.rate}
                      onChange={(e) =>
                        changeItem(line.id, "rate", e.target.value)
                      }
                    />
                    <div className="px-2 py-2.5 text-right text-sm font-bold">
                      {money(totals.line_items[index]?.amount ?? 0)}
                    </div>
                    <button
                      type="button"
                      className={secondary}
                      disabled={items.length === 1}
                      onClick={() =>
                        setItems((current) =>
                          current.filter((x) => x.id !== line.id),
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </section>
            <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
              <section className="space-y-3">
                <TextArea label="Internal Notes" value={notes} set={setNotes} />
                <TextArea
                  label="Customer Notes"
                  value={customerNotes}
                  set={setCustomerNotes}
                />
                <TextArea label="Terms" value={terms} set={setTerms} />
              </section>
              <section className="rounded-xl bg-neutral-50 p-4">
                <Field
                  label="Discount Amount"
                  type="number"
                  value={String(discount)}
                  set={(value) => setDiscount(Number(value))}
                />
                <div className="mt-3">
                  <Field
                    label="Tax Amount"
                    type="number"
                    value={String(tax)}
                    set={(value) => setTax(Number(value))}
                  />
                </div>
                <dl className="mt-5 space-y-2 text-sm">
                  <Total label="Subtotal" value={totals.subtotal} />
                  <Total label="Discount" value={totals.discount} />
                  <Total label="Tax" value={totals.tax} />
                  <Total label="Total" value={totals.total} strong />
                </dl>
              </section>
            </div>
            <div className="flex gap-3">
              <button
                disabled={saving}
                onClick={() => void submit()}
                className={primary}
              >
                {saving ? "Creating…" : "Create Invoice"}
              </button>
              <button disabled={saving} onClick={close} className={secondary}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
function Label({
  text,
  children,
}: {
  text: string;
  children: React.ReactNode;
}) {
  return (
    <label className="text-sm font-bold">
      {text}
      <div className="mt-2">{children}</div>
    </label>
  );
}
function Field({
  label,
  value,
  set,
  type = "text",
}: {
  label: string;
  value: string;
  set: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="text-sm font-bold">
      {label}
      <input
        className={`${input} mt-2`}
        type={type}
        min={type === "number" ? "0" : undefined}
        step={type === "number" ? "0.01" : undefined}
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );
}
function TextArea({
  label,
  value,
  set,
}: {
  label: string;
  value: string;
  set: (value: string) => void;
}) {
  return (
    <label className="block text-sm font-bold">
      {label}
      <textarea
        className={`${input} mt-2 min-h-24`}
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );
}
function Total({
  label,
  value,
  strong,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex justify-between ${strong ? "border-t pt-3 text-base font-extrabold text-[#143d1a]" : ""}`}
    >
      <dt>{label}</dt>
      <dd>{money(value)}</dd>
    </div>
  );
}
function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value || 0);
}
function message(value: unknown, fallback: string) {
  return value instanceof Error ? value.message : fallback;
}
