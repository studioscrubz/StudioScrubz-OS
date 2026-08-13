import type { CommercialCalculatorInput, Condition, EstimateResult, Frequency, ResidentialCalculatorInput } from "@/types/estimate";

export const RESIDENTIAL_ADD_ONS = [
  { name: "Inside Refrigerator", price: 45 }, { name: "Inside Oven", price: 40 },
  { name: "Interior Windows", price: 65 }, { name: "Inside Cabinets", price: 70 },
  { name: "Laundry", price: 30 }, { name: "Change Bed Linens", price: 18 },
  { name: "Wall Washing", price: 80 }, { name: "Garage Cleaning", price: 75 },
  { name: "Patio Cleaning", price: 55 },
] as const;

export const COMMERCIAL_TYPES = ["Office", "Barbershop / Salon", "Gym / Spa", "Restaurant", "Recording Studio", "Tattoo Shop", "Warehouse", "Retail", "Apartment Building / Complex", "Event Venue", "Other"] as const;
export const COMMERCIAL_SERVICES = [
  { name: "Interior Windows", laborHours: 1.5, supplyCost: 12 },
  { name: "Floor Detail", laborHours: 2, supplyCost: 18 },
  { name: "Appliance Detail", laborHours: 1, supplyCost: 10 },
  { name: "High Dusting", laborHours: 1.5, supplyCost: 8 },
] as const;

const residentialBase: Record<ResidentialCalculatorInput["serviceType"], number[]> = {
  Standard: [110, 135, 160, 240, 350], Deep: [160, 185, 240, 300, 425],
  "Move-In / Move-Out": [180, 225, 275, 385, 485],
};
const conditionMultiplier: Record<Condition, number> = { Light: 0.92, Average: 1, Heavy: 1.22, Extreme: 1.48 };
const frequencyDiscount: Record<Frequency, number> = { "One-Time": 0, Weekly: 15, Biweekly: 10, Monthly: 5 };
const visitsPerMonth: Record<Frequency, number> = { "One-Time": 1, Weekly: 4.33, Biweekly: 2.17, Monthly: 1 };

export function calculateResidentialEstimate(input: ResidentialCalculatorInput): EstimateResult {
  const bedroomIndex = Math.min(Math.max(Math.round(input.bedrooms), 0), 4);
  const basePrice = residentialBase[input.serviceType][bedroomIndex];
  const adjustments = [];
  const conditionAmount = basePrice * (conditionMultiplier[input.condition] - 1);
  if (conditionAmount) adjustments.push({ label: `${input.condition} condition`, amount: conditionAmount });
  const extraBaths = Math.max(0, input.bathrooms - Math.max(1, input.bedrooms * 0.6));
  if (extraBaths) adjustments.push({ label: "Additional bathrooms", amount: extraBaths * 22 });
  const expectedSquareFeet = 650 + input.bedrooms * 450;
  const excessSquareFeet = Math.max(0, input.squareFeet - expectedSquareFeet);
  if (excessSquareFeet) adjustments.push({ label: "Additional square footage", amount: excessSquareFeet * 0.065 });
  if (input.occupied) adjustments.push({ label: "Occupied property", amount: basePrice * 0.06 });
  if (input.pets) adjustments.push({ label: "Pets / heavy pet hair", amount: 35 });
  for (const addOn of RESIDENTIAL_ADD_ONS.filter((item) => input.addOns.includes(item.name))) adjustments.push({ label: addOn.name, amount: addOn.price });
  const oneTimePrice = basePrice + adjustments.reduce((sum, item) => sum + item.amount, 0);
  const recurringDiscountPercent = frequencyDiscount[input.frequency];
  const recurringDiscount = oneTimePrice * recurringDiscountPercent / 100;
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

export function calculateCommercialEstimate(input: CommercialCalculatorInput): EstimateResult {
  const baseProductionRate = commercialProductionRate(input.commercialType);
  const productionHours = input.squareFeet / baseProductionRate;
  const fixtureHours = input.restrooms * 0.4 + input.kitchens * 0.55 + input.stations * 0.08 + input.units * 0.22 + Math.max(0, input.floors - 1) * 0.5;
  const selectedServices = COMMERCIAL_SERVICES.filter((item) => input.additionalServices.includes(item.name));
  const laborHours = Math.max(input.targetCompletionHours || 0, (productionHours + fixtureHours + selectedServices.reduce((sum, item) => sum + item.laborHours, 0)) * conditionMultiplier[input.condition]);
  const crewSize = Math.max(1, Math.ceil(laborHours / Math.max(1, input.targetCompletionHours || 4)));
  const laborCost = laborHours * Math.max(0, input.workerHourlyPay);
  const supplyCost = Math.max(18, input.squareFeet * 0.018) + selectedServices.reduce((sum, item) => sum + item.supplyCost, 0);
  const directCost = laborCost + supplyCost;
  const margin = clamp(input.targetProfitMarginPercent, 0, 85) / 100;
  const basePrice = directCost / Math.max(0.15, 1 - margin);
  const adjustments = selectedServices.map((item) => ({ label: item.name, amount: item.laborHours * input.workerHourlyPay + item.supplyCost }));
  const oneTimePrice = basePrice;
  const recurringDiscountPercent = frequencyDiscount[input.frequency];
  const recurringDiscount = oneTimePrice * recurringDiscountPercent / 100;
  const manualDiscount = oneTimePrice * clamp(input.additionalDiscountPercent, 0, 100) / 100;
  const totalDiscount = recurringDiscount + manualDiscount;
  const subtotal = Math.max(0, oneTimePrice - totalDiscount);
  const taxes = subtotal * clamp(input.taxRatePercent, 0, 100) / 100;
  const finalPrice = subtotal + taxes;
  return result({ input, serviceName: `${input.commercialType} Cleaning`, basePrice, adjustments, oneTimePrice, recurringDiscount, recurringDiscountPercent, manualDiscount, totalDiscount, taxes, finalPrice, laborHours, crewSize, laborCost, supplyCost, scope: [`${input.commercialType} commercial cleaning`, ...input.additionalServices] });
}

function result(values: { input: ResidentialCalculatorInput | CommercialCalculatorInput; serviceName: string; basePrice: number; adjustments: { label: string; amount: number }[]; oneTimePrice: number; recurringDiscount: number; recurringDiscountPercent: number; manualDiscount: number; totalDiscount: number; taxes: number; finalPrice: number; laborHours: number; crewSize: number; laborCost: number; supplyCost: number; scope: string[] }): EstimateResult {
  const frequency = values.input.frequency;
  return { ...values, basePrice: money(values.basePrice), adjustments: values.adjustments.map((item) => ({ ...item, amount: money(item.amount) })), oneTimePrice: money(values.oneTimePrice), recurringDiscount: money(values.recurringDiscount), manualDiscount: money(values.manualDiscount), totalDiscount: money(values.totalDiscount), taxes: money(values.taxes), finalPrice: money(values.finalPrice), monthlyPrice: frequency === "One-Time" ? null : money(values.finalPrice * visitsPerMonth[frequency]), visitsPerMonth: visitsPerMonth[frequency], laborHours: tenth(values.laborHours), crewSize: values.crewSize, estimatedDuration: tenth(values.laborHours / values.crewSize), laborCost: money(values.laborCost), supplyCost: money(values.supplyCost), estimatedProfit: money(values.finalPrice - values.laborCost - values.supplyCost), calculatorInput: values.input };
}
function commercialProductionRate(type: string): number { return type === "Restaurant" ? 700 : type === "Gym / Spa" ? 900 : type === "Warehouse" ? 1800 : type === "Barbershop / Salon" || type === "Tattoo Shop" ? 800 : 1200; }
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value || 0)); }
function money(value: number): number { return Math.round(value * 100) / 100; }
function tenth(value: number): number { return Math.round(value * 10) / 10; }
