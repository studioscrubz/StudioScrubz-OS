import type { CommercialCalculatorInput, Condition, EstimateResult, Frequency, ResidentialCalculatorInput } from "@/types/estimate";
import type { ServiceCatalogBundle } from "@/types/serviceCatalog";
import { applyRecurringRule, calculateAddons, commercialCatalogContext, residentialCatalogPrice } from "@/lib/pricing/pricingEngine";
import { estimatedMonthlyTotal, estimatedVisitsPerMonth } from "@/lib/scheduling/frequency";

const conditionMultiplier: Record<Condition, number> = { Light: 0.92, Average: 1, Heavy: 1.22, Extreme: 1.48 };

export function calculateResidentialEstimate(input: ResidentialCalculatorInput, catalog: ServiceCatalogBundle): EstimateResult {
  const service=catalog.services.find(x=>x.division!=="Commercial"&&x.service_name===`${input.serviceType} Cleaning`);
  if(!service)throw new Error(`No active catalog service is configured for ${input.serviceType} Cleaning.`);
  const configured= residentialCatalogPrice(input,service,catalog.tiers,catalog.addons.filter(x=>x.division!=="Commercial"));
  const basePrice = configured.basePrice;
  const adjustments = [];
  const conditionAmount = basePrice * (conditionMultiplier[input.condition] - 1);
  if (conditionAmount) adjustments.push({ label: `${input.condition} condition`, amount: conditionAmount });
  const extraBaths = configured.isExactConfiguration ? 0 : Math.max(0, input.bathrooms - Math.max(1, input.bedrooms * 0.6));
  if (extraBaths) adjustments.push({ label: "Additional bathrooms", amount: extraBaths * 22 });
  const expectedSquareFeet = 650 + input.bedrooms * 450;
  const excessSquareFeet = Math.max(0, input.squareFeet - expectedSquareFeet);
  if (excessSquareFeet) adjustments.push({ label: "Additional square footage", amount: excessSquareFeet * 0.065 });
  if (input.occupied) adjustments.push({ label: "Occupied property", amount: basePrice * 0.06 });
  if (input.pets) adjustments.push({ label: "Pets / heavy pet hair", amount: 35 });
  adjustments.push(...configured.addonAdjustments);
  const oneTimePrice = basePrice + adjustments.reduce((sum, item) => sum + item.amount, 0);
  const recurring=applyRecurringRule(oneTimePrice,input.frequency,catalog.recurringRules,service.id);
  const recurringDiscountPercent = recurring.percent;
  const recurringDiscount = recurring.discount;
  const manualDiscount = oneTimePrice * clamp(input.additionalDiscountPercent, 0, 100) / 100;
  const totalDiscount = recurringDiscount + manualDiscount;
  const subtotal = Math.max(0, oneTimePrice - totalDiscount);
  const taxes = subtotal * clamp(input.taxRatePercent, 0, 100) / 100;
  const finalPrice = subtotal + taxes;
  const laborHours = Math.max(1.5, input.squareFeet / 550 + input.bathrooms * 0.35 + input.bedrooms * 0.2) * conditionMultiplier[input.condition];
  const crewSize = laborHours >= 7 ? 3 : laborHours >= 3.5 ? 2 : 1;
  const laborCost = laborHours * 22;
  const supplyCost = Math.max(12, finalPrice * 0.07);
  return result({ input, serviceName: `${input.serviceType} Cleaning`, basePrice, adjustments, oneTimePrice, recurringDiscount, recurringDiscountPercent, manualDiscount, totalDiscount, taxes, finalPrice, laborHours, crewSize, laborCost, supplyCost, scope: [`${input.serviceType} residential cleaning`, ...input.addOns] });
}

export function calculateCommercialEstimate(input: CommercialCalculatorInput, catalog: ServiceCatalogBundle): EstimateResult {
  const service=catalog.services.find(x=>x.division!=="Residential"&&x.service_name===`${input.commercialType} Cleaning`);
  if(!service)throw new Error(`No active catalog service is configured for ${input.commercialType} Cleaning.`);
  const configured=commercialCatalogContext(input,service,catalog.addons.filter(x=>x.division!=="Residential"));
  const baseProductionRate = configured.productionRate;
  if(baseProductionRate<=0)throw new Error(`Custom Pricing Required for ${service.service_name}.`);
  const productionHours = input.squareFeet / baseProductionRate;
  const fixtureHours = input.restrooms * configured.restroomHours + input.kitchens * configured.kitchenHours + input.stations * configured.stationHours + input.units * configured.unitHours + Math.max(0, input.floors - 1) * configured.additionalFloorHours;
  const selectedServices=catalog.addons.filter(x=>input.additionalServices.includes(x.addon_name));
  const laborHours = Math.max(input.targetCompletionHours || 0, (productionHours + fixtureHours + selectedServices.reduce((sum, item) => sum + Number(item.pricing_config.labor_hours??0), 0)) * conditionMultiplier[input.condition]);
  const crewSize = Math.max(1, Math.ceil(laborHours / Math.max(1, input.targetCompletionHours || 4)));
  const laborCost = laborHours * Math.max(0, input.workerHourlyPay);
  const supplyCost = Math.max(configured.minimumSupplyCost, input.squareFeet * configured.supplyCostPerSquareFoot) + selectedServices.reduce((sum, item) => sum + Number(item.pricing_config.supply_cost??item.price), 0);
  const directCost = laborCost + supplyCost;
  const margin = clamp(input.targetProfitMarginPercent, 0, configured.maximumMarginPercent) / 100;
  const basePrice = directCost / Math.max(configured.minimumMarginDenominator, 1 - margin);
  const adjustments = configured.addonAdjustments;
  const oneTimePrice = basePrice;
  const recurring=applyRecurringRule(oneTimePrice,input.frequency,catalog.recurringRules,service.id);
  const recurringDiscountPercent = recurring.percent;
  const recurringDiscount = recurring.discount;
  const manualDiscount = oneTimePrice * clamp(input.additionalDiscountPercent, 0, 100) / 100;
  const totalDiscount = recurringDiscount + manualDiscount;
  const subtotal = Math.max(0, oneTimePrice - totalDiscount);
  const taxes = subtotal * clamp(input.taxRatePercent, 0, 100) / 100;
  const finalPrice = subtotal + taxes;
  return result({ input, serviceName: `${input.commercialType} Cleaning`, basePrice, adjustments, oneTimePrice, recurringDiscount, recurringDiscountPercent, manualDiscount, totalDiscount, taxes, finalPrice, laborHours, crewSize, laborCost, supplyCost, scope: [`${input.commercialType} commercial cleaning`, ...input.additionalServices] });
}

function result(values: { input: ResidentialCalculatorInput | CommercialCalculatorInput; serviceName: string; basePrice: number; adjustments: { label: string; amount: number }[]; oneTimePrice: number; recurringDiscount: number; recurringDiscountPercent: number; manualDiscount: number; totalDiscount: number; taxes: number; finalPrice: number; laborHours: number; crewSize: number; laborCost: number; supplyCost: number; scope: string[] }): EstimateResult {
  const frequency = values.input.frequency;
  return { ...values, serviceDescription: null, basePrice: money(values.basePrice), adjustments: values.adjustments.map((item) => ({ ...item, amount: money(item.amount) })), oneTimePrice: money(values.oneTimePrice), recurringDiscount: money(values.recurringDiscount), manualDiscount: money(values.manualDiscount), totalDiscount: money(values.totalDiscount), taxes: money(values.taxes), finalPrice: money(values.finalPrice), monthlyPrice: estimatedMonthlyTotal(values.finalPrice,frequency), visitsPerMonth: estimatedVisitsPerMonth(frequency), laborHours: tenth(values.laborHours), crewSize: values.crewSize, estimatedDuration: tenth(values.laborHours / values.crewSize), laborCost: money(values.laborCost), supplyCost: money(values.supplyCost), estimatedProfit: money(values.finalPrice - values.laborCost - values.supplyCost), calculatorInput: values.input };
}
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value || 0)); }
function money(value: number): number { return Math.round(value * 100) / 100; }
function tenth(value: number): number { return Math.round(value * 10) / 10; }
