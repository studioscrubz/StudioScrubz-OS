import type { CommercialCalculatorInput, Condition, EstimateResult, Frequency, ResidentialCalculatorInput } from "@/types/estimate";
import type { ServiceCatalogBundle } from "@/types/serviceCatalog";
import { calculateRecurringTotals, catalogConfigNumber, commercialCatalogContext, residentialCatalogPrice } from "@/lib/pricing/pricingEngine";
import { getAvailableServiceAddons } from "@/lib/services/serviceCatalog";
import { estimatedMonthlyTotal, estimatedVisitsPerMonth } from "@/lib/scheduling/frequency";

const conditionMultiplier: Record<Condition, number> = { Light: 0.92, Average: 1, Heavy: 1.22, Extreme: 1.48 };

export function calculateResidentialEstimate(input: ResidentialCalculatorInput, catalog: ServiceCatalogBundle): EstimateResult {
  const service=catalog.services.find(x=>x.division!=="Commercial"&&x.service_name===`${input.serviceType} Cleaning`);
  if(!service)throw new Error(`No active catalog service is configured for ${input.serviceType} Cleaning.`);
  const availableAddons=getAvailableServiceAddons(catalog,service.id,input.division);
  if(service.pricing_model==="Custom")return calculateResidentialProductionEstimate(input,catalog,service);
  const configured= residentialCatalogPrice(input,service,catalog.tiers,availableAddons);
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
  const pricing=calculateRecurringTotals({subtotal:oneTimePrice,frequency:input.frequency,rules:catalog.recurringRules,serviceId:service.id,manualDiscountPercent:input.additionalDiscountPercent,taxRatePercent:input.taxRatePercent});
  const recurringDiscountPercent = pricing.recurringDiscountPercent;
  const recurringDiscount = pricing.recurringDiscountAmount;
  const manualDiscount = pricing.manualDiscount;
  const totalDiscount = recurringDiscount + manualDiscount;
  const taxes = pricing.taxes;
  const finalPrice = pricing.finalPrice;
  const laborHours = Math.max(1.5, input.squareFeet / 550 + input.bathrooms * 0.35 + input.bedrooms * 0.2) * conditionMultiplier[input.condition];
  const crewSize = laborHours >= 7 ? 3 : laborHours >= 3.5 ? 2 : 1;
  const laborCost = laborHours * 22;
  const supplyCost = Math.max(12, finalPrice * 0.07);
  return result({ input, serviceName: `${input.serviceType} Cleaning`, catalogAddons:snapshots(input.addOns,availableAddons), basePrice, adjustments, oneTimePrice, recurringDiscount, recurringDiscountPercent, manualDiscount, totalDiscount, taxes, finalPrice, laborHours, crewSize, laborCost, supplyCost, scope: [`${input.serviceType} residential cleaning`, ...input.addOns] });
}

function calculateResidentialProductionEstimate(input:ResidentialCalculatorInput,catalog:ServiceCatalogBundle,service:ServiceCatalogBundle["services"][number]):EstimateResult{
  const targetCompletionHours=catalogConfigNumber(service,"default_target_completion_hours"),workerHourlyPay=catalogConfigNumber(service,"default_worker_hourly_pay"),targetProfitMarginPercent=catalogConfigNumber(service,"default_target_profit_margin_percent");
  if(targetCompletionHours<=0||workerHourlyPay<=0||targetProfitMarginPercent<=0)throw new Error(`Custom Pricing Required for ${service.service_name}: configure residential completion hours, worker pay, and target margin.`);
  const commercialInput:CommercialCalculatorInput={division:"Commercial",commercialType:input.serviceType,frequency:input.frequency,squareFeet:input.squareFeet,floors:1,restrooms:input.bathrooms,kitchens:1,stations:0,units:input.bedrooms,condition:input.condition,targetCompletionHours,workerHourlyPay,targetProfitMarginPercent,additionalDiscountPercent:input.additionalDiscountPercent,taxRatePercent:input.taxRatePercent,additionalServices:input.addOns,targetProjectDays:input.targetProjectDays??3,workdayHours:input.workdayHours??8};
  const calculated=calculateCommercialEstimate(commercialInput,catalog,service,"Residential");
  return{...calculated,serviceName:service.service_name,scope:[`${input.serviceType} residential cleaning`,...input.addOns],calculatorInput:input};
}

export function calculateCommercialEstimate(input: CommercialCalculatorInput, catalog: ServiceCatalogBundle, resolvedService?:ServiceCatalogBundle["services"][number], addonDivision:"Residential"|"Commercial"="Commercial"): EstimateResult {
  const service=resolvedService??catalog.services.find(x=>x.division!=="Residential"&&x.service_name===`${input.commercialType} Cleaning`);
  if(!service)throw new Error(`No active catalog service is configured for ${input.commercialType} Cleaning.`);
  if(service.pricing_config.requires_complete_pricing_config&&(!input.targetProjectDays||input.targetProjectDays<=0||![8,10].includes(input.workdayHours??0)))throw new Error(`Custom Pricing Required for ${service.service_name}: choose valid target days and workday hours.`);
  const availableAddons=getAvailableServiceAddons(catalog,service.id,addonDivision);
  const configured=commercialCatalogContext(input,service,availableAddons);
  const baseProductionRate = configured.productionRate;
  if(baseProductionRate<=0)throw new Error(`Custom Pricing Required for ${service.service_name}.`);
  const productionHours = input.squareFeet / baseProductionRate;
  const fixtureHours = input.restrooms * configured.restroomHours + input.kitchens * configured.kitchenHours + input.stations * configured.stationHours + input.units * configured.unitHours + Math.max(0, input.floors - 1) * configured.additionalFloorHours;
  const selectedServices=availableAddons.filter(x=>input.additionalServices.includes(x.addon_name));
  const laborHours = Math.max(input.targetCompletionHours || 0, (productionHours + fixtureHours + selectedServices.reduce((sum, item) => sum + Number(item.pricing_config.labor_hours??0), 0)) * conditionMultiplier[input.condition]);
  const availableHoursPerWorker=input.targetProjectDays&&input.workdayHours?input.targetProjectDays*input.workdayHours:input.targetCompletionHours||4;
  const crewSize = Math.max(1, Math.ceil(laborHours / Math.max(1, availableHoursPerWorker)));
  const laborCost = laborHours * Math.max(0, input.workerHourlyPay);
  const supplyCost = Math.max(configured.minimumSupplyCost, input.squareFeet * configured.supplyCostPerSquareFoot) + selectedServices.reduce((sum, item) => sum + Number(item.pricing_config.supply_cost??item.price), 0);
  const directCost = laborCost + supplyCost;
  const margin = clamp(input.targetProfitMarginPercent, 0, configured.maximumMarginPercent) / 100;
  const basePrice = directCost / Math.max(configured.minimumMarginDenominator, 1 - margin);
  const adjustments = configured.addonAdjustments;
  const oneTimePrice = basePrice;
  const pricing=calculateRecurringTotals({subtotal:oneTimePrice,frequency:input.frequency,rules:catalog.recurringRules,serviceId:service.id,manualDiscountPercent:input.additionalDiscountPercent,taxRatePercent:input.taxRatePercent});
  const recurringDiscountPercent = pricing.recurringDiscountPercent;
  const recurringDiscount = pricing.recurringDiscountAmount;
  const manualDiscount = pricing.manualDiscount;
  const totalDiscount = recurringDiscount + manualDiscount;
  const taxes = pricing.taxes;
  const finalPrice = pricing.finalPrice;
  return result({ input, serviceName: `${input.commercialType} Cleaning`, catalogAddons:snapshots(input.additionalServices,availableAddons), basePrice, adjustments, oneTimePrice, recurringDiscount, recurringDiscountPercent, manualDiscount, totalDiscount, taxes, finalPrice, laborHours, crewSize, laborCost, supplyCost, scope: [`${input.commercialType} commercial cleaning`, ...input.additionalServices] });
}

function result(values: { input: ResidentialCalculatorInput | CommercialCalculatorInput; serviceName: string; catalogAddons:EstimateResult["catalogAddons"]; basePrice: number; adjustments: { label: string; amount: number }[]; oneTimePrice: number; recurringDiscount: number; recurringDiscountPercent: number; manualDiscount: number; totalDiscount: number; taxes: number; finalPrice: number; laborHours: number; crewSize: number; laborCost: number; supplyCost: number; scope: string[] }): EstimateResult {
  const frequency = values.input.frequency;
  return { ...values, serviceDescription: null, basePrice: money(values.basePrice), adjustments: values.adjustments.map((item) => ({ ...item, amount: money(item.amount) })), oneTimePrice: money(values.oneTimePrice), recurringDiscount: money(values.recurringDiscount), manualDiscount: money(values.manualDiscount), totalDiscount: money(values.totalDiscount), taxes: money(values.taxes), finalPrice: money(values.finalPrice), monthlyPrice: estimatedMonthlyTotal(values.finalPrice,frequency), visitsPerMonth: estimatedVisitsPerMonth(frequency), laborHours: tenth(values.laborHours), crewSize: values.crewSize, estimatedDuration: tenth(values.laborHours / values.crewSize), laborCost: money(values.laborCost), supplyCost: money(values.supplyCost), estimatedProfit: money(values.finalPrice - values.laborCost - values.supplyCost), calculatorInput: values.input };
}
function snapshots(names:string[],addons:ServiceCatalogBundle["addons"]):EstimateResult["catalogAddons"]{return names.map(name=>addons.find(addon=>addon.addon_name===name)).filter((addon):addon is NonNullable<typeof addon>=>Boolean(addon)).map(addon=>({id:addon.id,catalogAddonId:addon.id,name:addon.addon_name,description:addon.description,price:addon.price,pricingModel:addon.pricing_model,unitLabel:addon.unit_label}))}
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value || 0)); }
function money(value: number): number { return Math.round(value * 100) / 100; }
function tenth(value: number): number { return Math.round(value * 10) / 10; }
