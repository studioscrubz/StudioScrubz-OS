import "server-only";

import { calculateCommercialEstimate, calculatePostConstructionCatalogEstimate, calculateResidentialEstimate, isPostConstructionV2Estimate } from "@/lib/pricing/estimates";
import { withAuthoritativeEstimatePrice } from "@/lib/pricing/authoritativePrice";
import type { CalculatorInput, CommercialCalculatorInput, EstimateResult, PostConstructionCalculatorInput } from "@/types/estimate";
import type { CatalogAddonSnapshot, ServiceCatalogBundle } from "@/types/serviceCatalog";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

export async function loadPrivatePricingCatalog(admin: AdminClient): Promise<ServiceCatalogBundle> {
  const [services, tiers, addons, addonLinks, recurringRules] = await Promise.all([
    admin.from("services").select("*").eq("is_active", true).is("archived_at", null),
    admin.from("service_price_tiers").select("*").eq("is_active", true),
    admin.from("service_addons").select("*").eq("is_active", true).is("archived_at", null),
    admin.from("service_addon_links").select("service_id,addon_id"),
    admin.from("recurring_pricing_rules").select("*").eq("is_active", true),
  ]);
  const failed = [services, tiers, addons, addonLinks, recurringRules].find(item => item.error);
  if (failed?.error) throw failed.error;
  return { services: services.data ?? [], tiers: tiers.data ?? [], addons: addons.data ?? [], addonLinks: addonLinks.data ?? [], recurringRules: recurringRules.data ?? [] } as ServiceCatalogBundle;
}

export function calculateSalesEstimate(rawInput: unknown, catalog: ServiceCatalogBundle, manualPrice: unknown, description: unknown): EstimateResult {
  const input = canonicalSalesInput(rawInput, catalog);
  // High dusting is an independent, assessed scope. Never blend it into
  // recurring janitorial pricing or create a zero-dollar automatic quote.
  if (input.division === "Commercial" && !("calculatorType" in input)) {
    const selected = catalog.services.find(service =>
      service.service_code === "COM-HIGH-DUST" &&
      (service.service_name === input.commercialType ||
        service.service_name.replace(/ Cleaning$/, "") === input.commercialType));
    if (selected) {
      if (manualPrice !== null && manualPrice !== undefined) {
        throw new Error("High Dusting pricing is calculated from the dedicated project inputs.");
      }
      if (input.frequency !== "One-Time" || input.additionalServices.length) {
        throw new Error("Prepare High Dusting as its own one-time estimate without bundled add-ons.");
      }
    }
  }
  const calculated = isPostConstruction(input)
    ? calculatePostConstructionCatalogEstimate(input, catalog)
    : input.division === "Residential"
      ? calculateResidentialEstimate(input, catalog)
      : calculateCommercialEstimate(input, catalog);
  const requestedPrice = manualPrice === null || manualPrice === undefined ? null : finiteNonnegative(manualPrice, "manual price");
  if (calculated.weeklyMixedVisits?.length && requestedPrice !== null) throw new Error("Mixed-scope weekly pricing cannot use a manual per-visit override.");
  const result = isPostConstruction(input)
    ? calculated
    : withAuthoritativeEstimatePrice(calculated, requestedPrice);
  return { ...result, serviceDescription: typeof description === "string" && description.trim() ? description.trim() : result.serviceDescription };
}

export function publicEstimateResult(result: EstimateResult): Record<string, unknown> {
  return stripUndefined({
    serviceName: result.serviceName, serviceDescription: result.serviceDescription, scope: result.scope,
    calculatorInput: publicCalculatorInput(result.calculatorInput),
    basePrice: result.basePrice, oneTimePrice: result.oneTimePrice, calculatedFinalPrice: result.calculatedFinalPrice,
    finalPrice: result.finalPrice, weeklyContractTotal: result.weeklyContractTotal, monthlyPrice: result.monthlyPrice,
    recurringDiscount: result.recurringDiscount, recurringDiscountPercent: result.recurringDiscountPercent,
    manualDiscount: result.manualDiscount, totalDiscount: result.totalDiscount, taxes: result.taxes,
    visitsPerMonth: result.visitsPerMonth, manualPrice: result.manualPrice, catalogAddons: result.catalogAddons,
    adjustments: result.adjustments,
    weeklyMixedVisits: result.weeklyMixedVisits?.map(item => ({ day: item.day, serviceLevel: item.serviceLevel, scope: item.scope, price: item.price })),
  });
}

function publicCalculatorInput(input: CalculatorInput): Record<string, unknown> {
  const value = { ...input } as Record<string, unknown>;
  delete value.workerHourlyPay;
  delete value.targetProfitMarginPercent;
  delete value.projectCosting;
  return value;
}

function canonicalSalesInput(value: unknown, catalog: ServiceCatalogBundle): CalculatorInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Calculator input is required.");
  const input = structuredClone(value) as CalculatorInput & { version?: number };
  if (input.division !== "Residential" && input.division !== "Commercial") throw new Error("A valid division is required.");
  if (isPostConstruction(input)) {
    if (isPostConstructionV2Estimate(input as PostConstructionCalculatorInput)) {
      throw new Error("Post-Construction project costing requires management review because it contains protected internal costs.");
    }
    const service = findService(catalog, input.division, input.serviceType);
    return canonicalInternalRates({ ...input, frequency: "One-Time", customIntervalDays: null, taxRatePercent: 0, additionalServices: selectedAddonNames(input) }, service.pricing_config, catalog, service.id) as PostConstructionCalculatorInput;
  }
  if (input.division === "Commercial" && !("calculatorType" in input)) {
    const service = findService(catalog, "Commercial", input.commercialType);
    return canonicalInternalRates({ ...input, taxRatePercent: 0, additionalServices: selectedAddonNames(input) }, service.pricing_config, catalog, service.id) as CommercialCalculatorInput;
  }
  if (input.division === "Residential" && !("calculatorType" in input)) {
    const service = findService(catalog, "Residential", input.serviceType);
    return { ...input, taxRatePercent: 0, addOns: selectedAddonNames(input), addonSelections: canonicalAddons(input, catalog, service.id) };
  }
  throw new Error("A valid calculator type is required.");
}

function canonicalInternalRates<T extends CommercialCalculatorInput | PostConstructionCalculatorInput>(input: T, config: Record<string, string | number | boolean>, catalog: ServiceCatalogBundle, serviceId: string): T {
  const workerHourlyPay = positiveConfig(config.default_worker_hourly_pay, "service worker rate");
  const targetProfitMarginPercent = percentConfig(config.default_target_profit_margin_percent, "service target margin");
  return { ...input, workerHourlyPay, targetProfitMarginPercent, addonSelections: canonicalAddons(input, catalog, serviceId) };
}

function canonicalAddons(input: CalculatorInput, catalog: ServiceCatalogBundle, serviceId: string): CatalogAddonSnapshot[] {
  const names = selectedAddonNames(input);
  if (new Set(names).size !== names.length) throw new Error("Duplicate add-ons are not allowed.");
  const linked = new Set(catalog.addonLinks.filter(link => link.service_id === serviceId).map(link => link.addon_id));
  return names.map(name => {
    const addon = catalog.addons.find(item => linked.has(item.id) && item.addon_name === name && (item.division === input.division || item.division === "Both"));
    if (!addon) throw new Error("An add-on is not available for this service.");
    const submitted = input.addonSelections?.find(item => item.catalogAddonId === addon.id || item.name === name);
    const pricingType = addon.pricing_config.pricing_type === "Per Unit" ? "Per Unit" : "Flat Price";
    const quantity = pricingType === "Per Unit" ? positiveInteger(submitted?.quantity, `${name} quantity`) : 1;
    const unitPrice = Number(addon.pricing_config.unit_price ?? addon.price);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error("The add-on price is invalid.");
    return { id: addon.id, catalogAddonId: addon.id, name, description: addon.description, price: addon.price, pricingModel: addon.pricing_model, unitLabel: addon.unit_label, pricingType, quantity, unitName: String(addon.pricing_config.unit_name ?? addon.unit_label ?? "").trim() || null, unitPrice, lineTotal: pricingType === "Per Unit" ? quantity * unitPrice : addon.price };
  });
}

function selectedAddonNames(input: CalculatorInput): string[] {
  const value = input.division === "Residential" && !("calculatorType" in input) ? input.addOns : input.additionalServices;
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) throw new Error("Invalid add-on selection.");
  return value.map(item => item.trim()).filter(Boolean);
}

function isPostConstruction(input: CalculatorInput): input is PostConstructionCalculatorInput {
  return "calculatorType" in input && input.calculatorType === "Post-Construction";
}

function findService(catalog: ServiceCatalogBundle, division: "Residential" | "Commercial", name: string) {
  const normalized = name.trim().toLowerCase();
  const service = catalog.services.find(item => (item.division === division || item.division === "Both") && (item.service_name.toLowerCase() === normalized || item.service_name.toLowerCase() === `${normalized} cleaning`));
  if (!service) throw new Error("Select an active Service Catalog service.");
  return service;
}

function positiveConfig(value: unknown, label: string): number { const number = Number(value); if (!Number.isFinite(number) || number <= 0) throw new Error(`The ${label} is not configured.`); return number; }
function percentConfig(value: unknown, label: string): number { const number = Number(value); if (!Number.isFinite(number) || number < 0 || number >= 100) throw new Error(`The ${label} is not configured.`); return number; }
function finiteNonnegative(value: unknown, label: string): number { const number = Number(value); if (!Number.isFinite(number) || number < 0) throw new Error(`A valid ${label} is required.`); return number; }
function positiveInteger(value: unknown, label: string): number { const number = Number(value); if (!Number.isInteger(number) || number < 1) throw new Error(`A valid ${label} is required.`); return number; }
function stripUndefined(value: Record<string, unknown>) { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)); }
