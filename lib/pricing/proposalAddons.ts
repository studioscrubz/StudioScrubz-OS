import type { ProposalAdjustment } from "@/types/proposal";
import type { CatalogAddonSnapshot, ServiceAddon } from "@/types/serviceCatalog";

export function proposalAddonSnapshots(adjustments: ProposalAdjustment[], addons: ServiceAddon[]): CatalogAddonSnapshot[] {
  return adjustments.flatMap((adjustment) => {
    if (!adjustment.catalogAddonId) return [];
    const addon = addons.find((candidate) => candidate.id === adjustment.catalogAddonId);
    if (!addon) return [];
    return [snapshot(addon, addon.pricing_config.pricing_type === "Per Unit" ? adjustment.quantity ?? 1 : 1)];
  });
}

export function selectProposalCatalogAddons(current: ProposalAdjustment[], names: string[], addons: ServiceAddon[]): ProposalAdjustment[] {
  const selected = names.map((name) => {
    const addon = addons.find((candidate) => candidate.addon_name === name);
    if (!addon) throw new Error(`Pricing is unavailable for add-on: ${name}`);
    const existing = current.find((adjustment) => adjustment.catalogAddonId === addon.id);
    return snapshot(addon, addon.pricing_config.pricing_type === "Per Unit" ? existing?.quantity ?? 1 : 1);
  });
  return replaceProposalCatalogAddons(current, selected, addons);
}

export function replaceProposalCatalogAddons(current: ProposalAdjustment[], selected: CatalogAddonSnapshot[], addons: ServiceAddon[]): ProposalAdjustment[] {
  const catalogAdjustments = selected.map((selection) => {
    const addon = addons.find((candidate) => candidate.id === selection.catalogAddonId);
    if (!addon) throw new Error(`Pricing is unavailable for add-on: ${selection.name}`);
    const authoritative = snapshot(addon, addon.pricing_config.pricing_type === "Per Unit" ? selection.quantity : 1);
    const existing = current.find((adjustment) => adjustment.catalogAddonId === addon.id);
    return {
      id: addon.id,
      label: addon.addon_name,
      amount: authoritative.lineTotal!,
      catalogAddonId: addon.id,
      description: addon.description,
      pricingModel: addon.pricing_model,
      unitLabel: addon.unit_label,
      ...(authoritative.pricingType === "Per Unit" ? {
        quantity: authoritative.quantity,
        unitName: authoritative.unitName,
        unitPrice: authoritative.unitPrice,
      } : {}),
      inherited: existing?.inherited,
    } satisfies ProposalAdjustment;
  });
  return [...current.filter((adjustment) => !adjustment.catalogAddonId), ...catalogAdjustments];
}

function snapshot(addon: ServiceAddon, quantity: number | undefined): CatalogAddonSnapshot {
  const pricingType = addon.pricing_config.pricing_type === "Per Unit" ? "Per Unit" : "Flat Price";
  const normalizedQuantity = pricingType === "Per Unit" ? Number(quantity) : 1;
  if (!Number.isInteger(normalizedQuantity) || normalizedQuantity < 1) throw new Error(`Enter a whole-number quantity of at least 1 for ${addon.addon_name}.`);
  const unitName = String(addon.pricing_config.unit_name ?? addon.unit_label ?? "").trim() || null;
  const unitPrice = Number(addon.pricing_config.unit_price ?? addon.price);
  if (pricingType === "Per Unit" && !unitName) throw new Error(`Configure a unit name for ${addon.addon_name}.`);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error(`Configure a valid price for ${addon.addon_name}.`);
  return {
    id: addon.id,
    catalogAddonId: addon.id,
    name: addon.addon_name,
    description: addon.description,
    price: addon.price,
    pricingModel: addon.pricing_model,
    unitLabel: addon.unit_label,
    pricingType,
    quantity: normalizedQuantity,
    unitName: pricingType === "Per Unit" ? unitName : null,
    unitPrice: pricingType === "Per Unit" ? unitPrice : addon.price,
    lineTotal: pricingType === "Per Unit" ? money(normalizedQuantity * unitPrice) : money(addon.price),
  };
}

function money(value: number) { return Math.round(value * 100) / 100; }
