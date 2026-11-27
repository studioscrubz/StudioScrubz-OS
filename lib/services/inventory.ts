import { getSupabaseClient } from "@/lib/supabase/client";
import { withImmediateAttentionPush } from "@/lib/push/client";

export type InventoryItem = { item_key: string; item_name: string; kit: string; target: number; restock_at: number | null; unit: string; standard_version: string; stock_state: string; parent_key: string | null };
export type InventoryLocation = { id: string; name: string; location_type: string; employee_id: string | null; crew_id: string | null };
export type InventoryStock = { location_id: string; item_key: string; quantity: number; capacity: number | null };
export type RestockRequest = { id: string; location_id: string; item_key: string; current_quantity: number; requested_quantity: number; issued_quantity: number; received_quantity: number; reason: string; priority: string; status: string; created_at: string };
export type InventoryTransaction = { id: string; location_id: string; item_key: string; quantity_delta: number; transaction_type: string; reason: string; created_at: string; movement_id: string };
export type ChemicalFormula = { id: string; name: string; version: number; status: string; preparation: string; label_url: string | null; sds_url: string | null };
export type EquipmentAsset = { id: string; equipment_number: string; item_key: string; location_id: string | null; condition: string; acknowledged_at: string | null; maintenance_interval: string | null; maintenance_due_at: string | null; manufacturer_instructions: string | null };
export type EquipmentMaintenance = { id: string; asset_id: string; report_type: string; description: string; status: string; photo_reference: string | null; resolution: string | null; reported_at: string };
export type KitDefinition = { id: string; name: string; version: number; service_names: string[] };
export type KitMember = { kit_id: string; item_key: string; minimum_quantity: number };
export type KitAssignment = { id: string; kit_number: string; kit_id: string; location_id: string; assigned_at: string; acknowledged_at: string | null; return_required: boolean; returned_at: string | null };
export type InventoryInspection = { id: string; job_id: string; employee_id: string; ready: boolean; created_at: string; requirements: Array<{ key: string; name: string; version: string }>; results: Array<{ key: string; status: string; quantity: number; notes: string }> };
export type TrainingAssessment = { version: number; trainer: string; training_date: string; passed: boolean; practical: boolean; notes: string; acknowledged_at: string | null };
export type InventoryTraining = { case_id: string; employee_id: string; employee_name: string; assessments: Record<string, TrainingAssessment> };
type QueryResult = { data: unknown; error: { message: string } | null };
type InventoryClient = {
  from: (table: string) => { select: (columns: string) => { order: (column: string, options?: { ascending: boolean }) => PromiseLike<QueryResult> } };
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<QueryResult>;
};
const client = () => getSupabaseClient() as unknown as InventoryClient;
export async function inventoryAction<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
  const run = async () => {
    const { data, error } = await client().rpc(name, args);
    if (error) throw new Error(error.message);
    if (typeof window !== "undefined" && !["inventory_training_records", "inventory_chemical_authorization", "inventory_job_requirements"].includes(name)) window.dispatchEvent(new Event("studioscrubz:inventory-updated"));
    return data as T;
  };
  return ["inventory_request_restock", "inventory_report_equipment", "inventory_submit_inspection"].includes(name) ? withImmediateAttentionPush(run) : run();
}
export async function getInventoryRestockAlerts() { return rows<RestockRequest>("technician_restock_requests", "created_at"); }
async function rows<T>(table: string, sort: string): Promise<T[]> {
  const { data, error } = await client().from(table).select("*").order(sort);
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}
export async function loadInventory() {
  const [items, locations, stock, requests, transactions, formulas, assets, maintenance, kits, assignments, inspections, training, chemicalAuthorized, kitMembers] = await Promise.all([
    rows<InventoryItem>("technician_kit_standard_items", "item_name"),
    rows<InventoryLocation>("technician_inventory_locations", "name"),
    rows<InventoryStock>("technician_inventory_stock", "item_key"),
    rows<RestockRequest>("technician_restock_requests", "created_at"),
    rows<InventoryTransaction>("technician_inventory_transactions", "created_at"),
    rows<ChemicalFormula>("technician_chemical_formulas", "name"),
    rows<EquipmentAsset>("technician_equipment_assets", "equipment_number"),
    rows<EquipmentMaintenance>("technician_equipment_maintenance", "reported_at"),
    rows<KitDefinition>("technician_kit_definitions", "name"),
    rows<KitAssignment>("technician_kit_assignments", "assigned_at"),
    rows<InventoryInspection>("job_inventory_inspections", "inspection_sequence"),
    inventoryAction<InventoryTraining[]>("inventory_training_records", {}),
    inventoryAction<boolean>("inventory_chemical_authorization", {}),
    rows<KitMember>("technician_kit_members", "item_key"),
  ]);
  return { items, locations, stock, requests, transactions, formulas, assets, maintenance, kits, assignments, inspections, training, chemicalAuthorized, kitMembers, loadedAt: Date.now() };
}
export type InventoryData = Awaited<ReturnType<typeof loadInventory>>;
export function stockThreshold(item: InventoryItem, stock?: InventoryStock) {
  const capacity = stock?.capacity;
  // Container-specific capacity overrides bottled-product targets. Alcohol requires a recorded capacity.
  if (item.item_key === "bulk_alcohol" && !capacity) return null;
  return capacity ? { target: capacity, threshold: capacity * 0.25 } : { target: item.target, threshold: item.restock_at };
}
