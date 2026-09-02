import type { AcceptedPricingAllocation, ProposalAdjustment, ProposalResult } from "@/types/proposal";

export function buildAcceptedPricingAllocation(result: Pick<ProposalResult, "perVisitTotal" | "adjustments">): AcceptedPricingAllocation {
  const addons = result.adjustments.filter((adjustment) => Boolean(adjustment.catalogAddonId)).map(snapshotAddon);
  const totalAmount = money(result.perVisitTotal);
  const addonTotal = money(addons.reduce((sum, addon) => sum + addon.lineTotal, 0));
  const baseServiceAmount = money(totalAmount - addonTotal);
  if (baseServiceAmount < 0) throw new Error("The authoritative Proposal price cannot be less than its accepted add-on total.");
  return { version: 1, baseServiceAmount, addons, totalAmount };
}

export function validAcceptedPricingAllocation(value: unknown, totalAmount?: number): value is AcceptedPricingAllocation {
  if (!value || typeof value !== "object") return false;
  const allocation = value as Partial<AcceptedPricingAllocation>;
  if (allocation.version !== 1 || !Array.isArray(allocation.addons) || !currency(allocation.baseServiceAmount) || !currency(allocation.totalAmount)) return false;
  if (!allocation.addons.every(validAddon)) return false;
  const calculated = money(allocation.baseServiceAmount + allocation.addons.reduce((sum, addon) => sum + addon.lineTotal, 0));
  return calculated === money(allocation.totalAmount) && (totalAmount === undefined || money(allocation.totalAmount) === money(totalAmount));
}

function snapshotAddon(adjustment: ProposalAdjustment): AcceptedPricingAllocation["addons"][number] {
  const lineTotal = money(adjustment.amount);
  if (adjustment.quantity !== undefined || adjustment.unitName || adjustment.unitPrice !== undefined) {
    if (!Number.isInteger(adjustment.quantity) || !adjustment.quantity || adjustment.quantity < 1 || !adjustment.unitName?.trim() || !currency(adjustment.unitPrice)) throw new Error(`The accepted add-on snapshot for ${adjustment.label} is invalid.`);
    if (lineTotal !== money(adjustment.quantity * adjustment.unitPrice)) throw new Error(`The accepted add-on total for ${adjustment.label} is invalid.`);
    return { id: adjustment.catalogAddonId ?? adjustment.id, label: adjustment.label, pricingType: "Per Unit", quantity: adjustment.quantity, unitName: adjustment.unitName.trim(), unitPrice: money(adjustment.unitPrice), lineTotal };
  }
  return { id: adjustment.catalogAddonId ?? adjustment.id, label: adjustment.label, pricingType: "Flat Price", quantity: 1, unitName: null, unitPrice: lineTotal, lineTotal };
}

function validAddon(value: unknown): value is AcceptedPricingAllocation["addons"][number] {
  if (!value || typeof value !== "object") return false;
  const addon = value as Partial<AcceptedPricingAllocation["addons"][number]>;
  if (!addon.id || !addon.label || !currency(addon.lineTotal) || !currency(addon.unitPrice) || !Number.isInteger(addon.quantity) || !addon.quantity || addon.quantity < 1) return false;
  if (addon.pricingType === "Per Unit") return Boolean(addon.unitName?.trim()) && addon.lineTotal === money(addon.quantity * addon.unitPrice);
  return addon.pricingType === "Flat Price";
}

function currency(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function money(value: number) {
  return Math.round(value * 100) / 100;
}
