import { getSupabaseClient } from "@/lib/supabase/client";
import type { ArchiveDeleteCheck, ArchivedRecord, ArchiveRecordType } from "@/types/archive";
import { getCurrentProfile, getCurrentUser } from "@/lib/services/auth";
import { canPermanentlyDelete } from "@/lib/auth/permissions";

type DbError = { message: string; code?: string };
type QueryResult = { data: unknown; error: DbError | null; count?: number | null };
interface ArchiveQuery extends PromiseLike<QueryResult> {
  select(columns?: string, options?: { count?: "exact"; head?: boolean }): ArchiveQuery;
  not(column: string, operator: string, value: unknown): ArchiveQuery;
  eq(column: string, value: unknown): ArchiveQuery;
  update(values: Record<string, unknown>): ArchiveQuery;
  delete(): ArchiveQuery;
  order(column: string, options?: { ascending?: boolean }): ArchiveQuery;
}
interface ArchiveDb { from(table: string): ArchiveQuery }

type ArchiveConfig = { type: ArchiveRecordType; table: string; href: string };
const CONFIGS: ArchiveConfig[] = [
  { type: "Clients", table: "clients", href: "/clients" },
  { type: "Properties", table: "properties", href: "/properties" },
  { type: "Estimates", table: "estimates", href: "/open-estimates" },
  { type: "Walkthroughs", table: "walkthroughs", href: "/walkthroughs" },
  { type: "Proposals", table: "proposals", href: "/open-proposals" },
  { type: "Jobs", table: "jobs", href: "/jobs" },
  { type: "Employees", table: "employees", href: "/employees" },
  { type: "Crews", table: "crews", href: "/employees" },
  { type: "Invoices", table: "invoices", href: "/invoices" },
  { type: "Expenses", table: "expenses", href: "/expenses" },
  { type: "Vehicles", table: "vehicles", href: "/vehicles" },
  { type: "Mileage", table: "mileage_entries", href: "/vehicles" },
  { type: "Time Entries", table: "time_entries", href: "/time-clock" },
  { type: "Service Agreements", table: "service_agreements", href: "/agreements" },
  { type: "Services", table: "services", href: "/settings/services" },
  { type: "Service Add-Ons", table: "service_addons", href: "/settings/services" },
];

const DEPENDENCIES: Partial<Record<ArchiveRecordType, Array<[string, string]>>> = {
  Clients: [["properties", "client_id"], ["estimates", "client_id"], ["walkthroughs", "client_id"], ["proposals", "client_id"], ["jobs", "client_id"], ["invoices", "client_id"], ["payments", "client_id"], ["expenses", "client_id"], ["mileage_entries", "client_id"], ["service_agreements", "client_id"]],
  Properties: [["estimates", "property_id"], ["walkthroughs", "property_id"], ["proposals", "property_id"], ["jobs", "property_id"], ["invoices", "property_id"], ["expenses", "property_id"], ["mileage_entries", "property_id"], ["service_agreements", "property_id"]],
  Estimates: [["walkthroughs", "estimate_id"], ["proposals", "estimate_id"], ["jobs", "estimate_id"]],
  Walkthroughs: [["proposals", "walkthrough_id"], ["jobs", "walkthrough_id"]],
  Proposals: [["jobs", "proposal_id"], ["invoices", "proposal_id"], ["proposal_history", "proposal_id"], ["service_agreements", "proposal_id"]],
  Jobs: [["invoices", "job_id"], ["payments", "job_id"], ["expenses", "job_id"], ["mileage_entries", "job_id"], ["time_entries", "job_id"], ["service_occurrences", "job_id"]],
  Employees: [["crews", "crew_lead_id"], ["crew_members", "employee_id"], ["expenses", "employee_id"], ["vehicles", "assigned_employee_id"], ["mileage_entries", "employee_id"], ["time_entries", "employee_id"]],
  Crews: [["crew_members", "crew_id"], ["jobs", "assigned_crew_id"], ["vehicles", "assigned_crew_id"], ["mileage_entries", "crew_id"], ["time_entries", "crew_id"], ["service_agreements", "assigned_crew_id"], ["service_occurrences", "assigned_crew_id"]],
  Invoices: [["payments", "invoice_id"]],
  Vehicles: [["mileage_entries", "vehicle_id"]],
  "Service Agreements": [["service_occurrences", "agreement_id"]],
  Services: [["service_price_tiers", "service_id"], ["service_addon_links", "service_id"], ["recurring_pricing_rules", "service_id"]],
  "Service Add-Ons": [["service_addon_links", "addon_id"]],
};

export async function getArchivedRecords(): Promise<ArchivedRecord[]> {
  const db = archiveDb();
  const groups = await Promise.all(CONFIGS.map(async (config) => {
    const { data, error } = await db.from(config.table).select("*").not("archived_at", "is", null).order("archived_at", { ascending: false });
    if (error) throw new Error(`${config.type} archives could not be loaded: ${error.message}`);
    return rows(data).map((row) => toArchivedRecord(config, row));
  }));
  return groups.flat().sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
}

export async function restoreArchivedRecord(record: ArchivedRecord): Promise<void> {
  const config = configFor(record.type);
  const values = restoreValues(record.type);
  const { error } = await archiveDb().from(config.table).update(values).eq("id", record.id).not("archived_at", "is", null);
  if (error) throw new Error(`Unable to restore ${record.label}: ${error.message}`);
}

export async function canPermanentlyDeleteRecord(record: ArchivedRecord): Promise<ArchiveDeleteCheck> {
  const db = archiveDb();
  let dependencyCount = 0;
  for (const [table, column] of DEPENDENCIES[record.type] ?? []) {
    const { error, count } = await db.from(table).select("id", { count: "exact", head: true }).eq(column, record.id);
    if (error) throw new Error(`Dependency check failed: ${error.message}`);
    dependencyCount += count ?? 0;
  }
  return dependencyCount > 0
    ? { allowed: false, dependencyCount, reason: "This record cannot be permanently deleted because it is linked to existing business records." }
    : { allowed: true, dependencyCount: 0, reason: null };
}

export async function permanentlyDeleteArchivedRecord(record: ArchivedRecord): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("You must be signed in to permanently delete archived records.");
  const profile = await getCurrentProfile(user.id);
  if (!canPermanentlyDelete(profile)) throw new Error("Master Admin authorization is required for permanent deletion.");
  const check = await canPermanentlyDeleteRecord(record);
  if (!check.allowed) throw new Error(check.reason ?? "This record cannot be permanently deleted.");
  const config = configFor(record.type);
  const { error } = await archiveDb().from(config.table).delete().eq("id", record.id).not("archived_at", "is", null);
  if (error?.code === "23503") throw new Error("This record cannot be permanently deleted because it is linked to existing business records.");
  if (error) throw new Error("Permanent deletion was rejected. Verify Master Admin security policies are active.");
}

function archiveDb() { return getSupabaseClient() as unknown as ArchiveDb; }
function configFor(type: ArchiveRecordType) { const config = CONFIGS.find((item) => item.type === type); if (!config) throw new Error("Unsupported archive record type."); return config; }
function rows(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null) : []; }
function text(row: Record<string, unknown>, key: string) { const value = row[key]; return typeof value === "string" ? value : ""; }
function first(row: Record<string, unknown>, keys: string[]) { return keys.map((key) => text(row, key)).find(Boolean) ?? "Archived record"; }
function toArchivedRecord(config: ArchiveConfig, row: Record<string, unknown>): ArchivedRecord {
  const person = [text(row, "first_name"), text(row, "last_name")].filter(Boolean).join(" ");
  const label = person || first(row, ["client_name", "company_name", "property_name", "address", "estimate_number", "contact_name", "proposal_number", "job_number", "employee_number", "crew_name", "invoice_number", "expense_number", "vehicle_number", "mileage_number", "time_entry_number", "agreement_number", "service_name", "addon_name", "description"]);
  const storedStatus = first(row, ["status", "employment_status"]);
  return { id: text(row, "id"), type: config.type, label, relatedName: first(row, ["property_name", "service_name", "vendor"]) === "Archived record" ? null : first(row, ["property_name", "service_name", "vendor"]), archivedAt: text(row, "archived_at"), status: storedStatus === "Archived record" ? "Archived" : storedStatus, href: `${config.href}?id=${text(row, "id")}` };
}
function restoreValues(type: ArchiveRecordType): Record<string, unknown> {
  const base: Record<string, unknown> = { archived_at: null };
  if (type === "Clients") return { ...base, status: "Inactive" };
  if (type === "Estimates") return { ...base, status: "Open" };
  if (type === "Walkthroughs") return { ...base, status: "New" };
  if (type === "Proposals") return { ...base, status: "Draft", approval_status: "Not Submitted" };
  if (type === "Jobs") return { ...base, status: "Completed" };
  if (type === "Employees") return { ...base, employment_status: "Inactive" };
  if (type === "Crews" || type === "Vehicles") return { ...base, status: "Inactive" };
  if (type === "Invoices") return { ...base, status: "Draft" };
  if (type === "Expenses" || type === "Mileage") return { ...base, status: "Active" };
  if (type === "Time Entries") return { ...base, status: "Completed" };
  if (type === "Service Agreements") return { ...base, status: "Draft" };
  if (type === "Services" || type === "Service Add-Ons") return { ...base, is_active: true };
  return base;
}
