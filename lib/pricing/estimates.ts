import type {
  CalculatorInput,
  CommercialCalculatorInput,
  Condition,
  EstimateResult,
  PostConstructionCalculatorInput,
  ResidentialCalculatorInput,
} from "@/types/estimate";
import type { ServiceCatalogBundle } from "@/types/serviceCatalog";
import {
  calculateRecurringTotals,
  catalogConfigNumber,
  commercialCatalogContext,
  residentialCatalogPrice,
} from "@/lib/pricing/pricingEngine";
import { getAvailableServiceAddons } from "@/lib/services/serviceCatalog";
import {
  estimatedMonthlyTotal,
  estimatedVisitsPerMonth,
} from "@/lib/scheduling/frequency";
import { calculateUpkeepPlan } from "@/lib/pricing/upkeepPlan";
import {
  calculatePostConstructionEstimate,
  calculatePostConstructionV2,
} from "@/lib/pricing/postConstruction";
import type {
  PostConstructionV2Input,
  PostConstructionV2Result,
} from "@/types/estimate";
import {
  MINIMUM_WORKER_HOURLY_PAY,
  requireMinimumWorkerHourlyPay,
} from "@/lib/pricing/workerHourlyPay";

export type PostConstructionEstimateInput =
  PostConstructionCalculatorInput & {
    version?: 2;
    projectCosting?: PostConstructionV2Input;
  };

export type PostConstructionV2EstimateResult = EstimateResult & {
  version: 2;
  postConstructionV2: PostConstructionV2Result;
};

const TARGET_MARGIN_PERCENT = 35;
const NORMAL_MINIMUM_MARGIN_PERCENT = 30;

const conditionLaborMultiplier: Record<Condition, number> = {
  // Light improves delivery efficiency/margin; it is not a customer discount.
  Light: 1,
  Average: 1,
  Heavy: 1.25,
  Extreme: 1.5,
};

export function isPostConstructionV2Estimate(
  input: PostConstructionCalculatorInput,
): input is PostConstructionEstimateInput & {
  version: 2;
  projectCosting: PostConstructionV2Input;
} {
  return "version" in input && input.version === 2;
}

export function calculateEstimate(
  input: CalculatorInput,
  catalog: ServiceCatalogBundle,
): EstimateResult {
  if (isPostConstructionInput(input)) {
    return calculatePostConstructionCatalogEstimate(input, catalog);
  }

  return input.division === "Residential"
    ? calculateResidentialEstimate(input, catalog)
    : calculateCommercialEstimate(input, catalog);
}

export function calculatePostConstructionCatalogEstimate(
  input: PostConstructionCalculatorInput,
  catalog: ServiceCatalogBundle,
  service?: ServiceCatalogBundle["services"][number],
): EstimateResult {
  const resolved =
    service ??
    catalog.services.find(
      (item) =>
        (item.division === input.division || item.division === "Both") &&
        (item.service_code.toUpperCase() === "BOTH-POST-CONSTRUCTION" ||
          item.service_code.toUpperCase() === "COM-POST-CONSTRUCTION"),
    );

  if (!resolved) {
    throw new Error(
      "No active Post-Construction catalog service is configured for this division.",
    );
  }

  if (isPostConstructionV2Estimate(input)) {
    if (!input.projectCosting || input.projectCosting.version !== 2) {
      throw new Error("Version 2 project inputs are required.");
    }

    const project = calculatePostConstructionV2(input.projectCosting);

    const calculatorInput: PostConstructionEstimateInput = {
      ...input,
      projectCosting: project.calculatorInput,
      squareFeet: project.calculatorInput.totalSquareFeet,
      workerHourlyPay: project.calculatorInput.workerHourlyPay,
      targetProjectDays: project.calculatorInput.plannedProjectDays,
      workdayHours: project.calculatorInput.workdayHours,
      frequency: "One-Time",
      customIntervalDays: null,
      recurringPricingRuleId: null,
      additionalDiscountPercent: 0,
      taxRatePercent: 0,
      serviceCode: resolved.service_code,
    };

    const result: PostConstructionV2EstimateResult = {
      version: 2,
      postConstructionV2: project,
      calculatorInput,
      serviceName: resolved.service_name,
      serviceDescription: resolved.description,
      basePrice: project.recommendedProjectPrice,
      oneTimePrice: project.recommendedProjectPrice,
      calculatedFinalPrice: project.recommendedProjectPrice,
      finalPrice: project.approvedProjectPrice,
      manualPrice: project.calculatorInput.manualProjectPriceOverride ?? null,
      adjustments: [],
      recurringDiscount: 0,
      recurringDiscountPercent: 0,
      recurringPricingRuleId: null,
      recurringPricingRuleName: null,
      manualDiscount: 0,
      totalDiscount: 0,
      taxes: 0,
      monthlyPrice: null,
      visitsPerMonth: 1,
      laborHours: project.totalLaborHours,
      crewSize: project.calculatorInput.crewSize,
      estimatedDuration:
        project.totalLaborHours / project.calculatorInput.crewSize,
      laborCost: project.laborCost,
      supplyCost: project.calculatorInput.suppliesCost,
      estimatedProfit: project.projectedGrossProfit,
      scope: project.calculatorInput.scope ?? [],
    };

    return result;
  }

  const core = calculatePostConstructionEstimate({
    ...input,
    additionalDiscountPercent: 0,
    taxRatePercent: 0,
    recurringPricingRuleId: null,
    frequency: "One-Time",
    customIntervalDays: null,
  });

  const oneTimePrice = core.basePrice;

  const pricing = calculateRecurringTotals({
    subtotal: oneTimePrice,
    frequency: input.frequency,
    customIntervalDays: input.customIntervalDays,
    rules: catalog.recurringRules,
    serviceId: resolved.id,
    recurringPricingRuleId: input.recurringPricingRuleId,
    manualDiscountPercent: input.additionalDiscountPercent,
    taxRatePercent: input.taxRatePercent,
  });

  const calculatorInput = {
    ...(core.calculatorInput as PostConstructionCalculatorInput),
    ...input,
    serviceCode: resolved.service_code,
  };

  return {
    ...core,
    serviceName: resolved.service_name,
    serviceDescription: resolved.description,
    basePrice: core.basePrice,
    adjustments: [],
    catalogAddons: undefined,
    oneTimePrice: money(oneTimePrice),
    recurringPricingRuleId: pricing.recurringPricingRuleId,
    recurringPricingRuleName: pricing.recurringPricingRuleName,
    recurringDiscount: pricing.recurringDiscountAmount,
    recurringDiscountPercent: pricing.recurringDiscountPercent,
    manualDiscount: pricing.manualDiscount,
    totalDiscount: money(
      pricing.recurringDiscountAmount + pricing.manualDiscount,
    ),
    taxes: pricing.taxes,
    calculatedFinalPrice: pricing.finalPrice,
    finalPrice: pricing.finalPrice,
    monthlyPrice:
      pricing.finalPrice === 0
        ? 0
        : estimatedMonthlyTotal(
            pricing.finalPrice,
            input.frequency,
            input.customIntervalDays,
          ),
    visitsPerMonth: estimatedVisitsPerMonth(
      input.frequency,
      input.customIntervalDays,
    ),
    estimatedProfit: money(
      pricing.finalPrice - core.laborCost - core.supplyCost,
    ),
    calculatorInput,
  };
}

export function calculateResidentialEstimate(
  input: ResidentialCalculatorInput,
  catalog: ServiceCatalogBundle,
  upkeepAdjustmentPercent = 30,
): EstimateResult {
  if (input.serviceType === "StudioScrubz Upkeep Plan") {
    const standard = calculateResidentialEstimate(
      {
        ...input,
        serviceType: "Standard",
        frequency: "One-Time",
        customIntervalDays: null,
        recurringPricingRuleId: null,
        additionalDiscountPercent: 0,
      },
      catalog,
      upkeepAdjustmentPercent,
    );

    const upkeepPlan = calculateUpkeepPlan(
      standard.finalPrice,
      upkeepAdjustmentPercent,
    );

    return {
      ...standard,
      serviceName: "StudioScrubz Upkeep Plan",
      serviceDescription: "3 Light Maintenance Visits per Month",
      basePrice: upkeepPlan.standardCleaningValue,
      adjustments: [],
      oneTimePrice: upkeepPlan.standardCleaningValue,
      recurringDiscount: 0,
      recurringDiscountPercent: 0,
      totalDiscount: 0,
      calculatedFinalPrice: upkeepPlan.monthlyPackage,
      finalPrice: upkeepPlan.monthlyPackage,
      monthlyPrice: upkeepPlan.monthlyPackage,
      visitsPerMonth: 3,
      estimatedProfit: money(
        upkeepPlan.monthlyPackage - standard.laborCost - standard.supplyCost,
      ),
      calculatorInput: {
        ...input,
        frequency: "Monthly",
        customIntervalDays: null,
        recurringPricingRuleId: null,
      },
      upkeepPlan,
    };
  }

  const service = catalog.services.find(
    (item) =>
      item.division !== "Commercial" &&
      item.service_name === `${input.serviceType} Cleaning`,
  );

  if (!service) {
    throw new Error(
      `No active catalog service is configured for ${input.serviceType} Cleaning.`,
    );
  }

  const availableAddons = getAvailableServiceAddons(
    catalog,
    service.id,
    input.division,
  );

  if (service.pricing_model === "Custom") {
    return calculateResidentialProductionEstimate(input, catalog, service);
  }

  const configured = residentialCatalogPrice(
    input,
    service,
    catalog.tiers,
    availableAddons,
  );

  const serviceFloor = configured.basePrice;

  const includedBathrooms = residentialIncludedBathrooms(
    input.serviceType,
    input.bedrooms,
  );

  const additionalBathrooms = Math.max(
    0,
    input.bathrooms - includedBathrooms,
  );

  const expectedSquareFeet = residentialExpectedSquareFeet(input.bedrooms);
  const excessSquareFeet = Math.max(
    0,
    input.squareFeet - expectedSquareFeet,
  );

  const baseLaborHours = residentialBaseLaborHours(input);

  const bathroomLaborHours = additionalBathrooms * 0.5;
  const excessSquareFootLaborHours = excessSquareFeet / 650;

  const occupancyLaborHours =
    input.serviceType === "Move-In/Move-Out" && input.occupied ? 0.75 : 0;

  const laborHours =
    Math.max(
      1.5,
      baseLaborHours +
        bathroomLaborHours +
        excessSquareFootLaborHours +
        occupancyLaborHours,
    ) * conditionLaborMultiplier[input.condition];

  const crewSize = laborHours >= 7 ? 3 : laborHours >= 3.5 ? 2 : 1;

  const workerHourlyPay = Math.max(MINIMUM_WORKER_HOURLY_PAY, 22);
  const laborCost = laborHours * workerHourlyPay;

  const supplyCost = Math.max(12, input.squareFeet * 0.015);

  const addonTotal = configured.addonAdjustments.reduce(
    (sum, item) => sum + item.amount,
    0,
  );

  const scopeDirectCost = laborCost + supplyCost;

  const scopeLaborPrice = scopeDirectCost / (1 - TARGET_MARGIN_PERCENT / 100);

  const profitabilityFloor =
    scopeDirectCost / (1 - TARGET_MARGIN_PERCENT / 100);

  const calculatedServicePrice = Math.max(
    serviceFloor,
    scopeLaborPrice,
    profitabilityFloor,
  );

  const oneTimePrice = calculatedServicePrice + addonTotal;

  const adjustments: { label: string; amount: number }[] = [];

  if (additionalBathrooms > 0) {
    adjustments.push({
      label: `Additional bathroom labor (${additionalBathrooms})`,
      amount:
        (bathroomLaborHours * workerHourlyPay) /
        (1 - TARGET_MARGIN_PERCENT / 100),
    });
  }

  if (excessSquareFeet > 0) {
    adjustments.push({
      label: "Additional square-footage labor",
      amount:
        (excessSquareFootLaborHours * workerHourlyPay) /
        (1 - TARGET_MARGIN_PERCENT / 100),
    });
  }

  if (occupancyLaborHours > 0) {
    adjustments.push({
      label: "Occupied / furnished move labor",
      amount:
        (occupancyLaborHours * workerHourlyPay) /
        (1 - TARGET_MARGIN_PERCENT / 100),
    });
  }

  adjustments.push(...configured.addonAdjustments);

  const pricing = calculateRecurringTotals({
    subtotal: oneTimePrice,
    frequency: input.frequency,
    customIntervalDays: input.customIntervalDays,
    rules: catalog.recurringRules,
    serviceId: service.id,
    recurringPricingRuleId: input.recurringPricingRuleId,
    manualDiscountPercent: input.additionalDiscountPercent,
  });

  const directCostWithAddons = scopeDirectCost + addonDirectCost(
    input.addOns,
    availableAddons,
    input.addonSelections,
    workerHourlyPay,
  );

  const minimumFinalPrice =
    directCostWithAddons / (1 - NORMAL_MINIMUM_MARGIN_PERCENT / 100);

  const finalPrice = Math.max(pricing.finalPrice, minimumFinalPrice);

  const protectedDiscount =
    pricing.finalPrice < minimumFinalPrice
      ? Math.max(0, oneTimePrice - finalPrice)
      : pricing.recurringDiscountAmount + pricing.manualDiscount;

  const manualDiscount =
    pricing.finalPrice < minimumFinalPrice
      ? Math.max(0, protectedDiscount - pricing.recurringDiscountAmount)
      : pricing.manualDiscount;

  return result({
    input,
    serviceName: `${input.serviceType} Cleaning`,
    catalogAddons: snapshots(
      input.addOns,
      availableAddons,
      input.addonSelections,
    ),
    basePrice: serviceFloor,
    adjustments,
    oneTimePrice,
    recurringPricingRuleId: pricing.recurringPricingRuleId,
    recurringPricingRuleName: pricing.recurringPricingRuleName,
    recurringDiscount: Math.min(
      pricing.recurringDiscountAmount,
      protectedDiscount,
    ),
    recurringDiscountPercent: pricing.recurringDiscountPercent,
    manualDiscount,
    totalDiscount: protectedDiscount,
    taxes: 0,
    finalPrice,
    laborHours,
    crewSize,
    laborCost,
    supplyCost,
    scope: [],
  });
}

function calculateResidentialProductionEstimate(
  input: ResidentialCalculatorInput,
  catalog: ServiceCatalogBundle,
  service: ServiceCatalogBundle["services"][number],
): EstimateResult {
  const targetCompletionHours = catalogConfigNumber(
    service,
    "default_target_completion_hours",
  );

  const workerHourlyPay = Math.max(
    MINIMUM_WORKER_HOURLY_PAY,
    catalogConfigNumber(service, "default_worker_hourly_pay"),
  );

  const targetProfitMarginPercent = catalogConfigNumber(
    service,
    "default_target_profit_margin_percent",
  );

  if (
    targetCompletionHours <= 0 ||
    workerHourlyPay <= 0 ||
    targetProfitMarginPercent <= 0
  ) {
    throw new Error(
      `Custom Pricing Required for ${service.service_name}: configure residential completion hours, worker pay, and target margin.`,
    );
  }

  const commercialInput: CommercialCalculatorInput = {
    division: "Commercial",
    commercialType: input.serviceType,
    frequency: input.frequency,
    recurringPricingRuleId: input.recurringPricingRuleId,
    squareFeet: input.squareFeet,
    floors: 1,
    restrooms: input.bathrooms,
    kitchens: 1,
    stations: 0,
    units: input.bedrooms,
    condition: input.condition,
    targetCompletionHours,
    workerHourlyPay,
    targetProfitMarginPercent,
    additionalDiscountPercent: input.additionalDiscountPercent,
    taxRatePercent: 0,
    additionalServices: input.addOns,
    targetProjectDays: input.targetProjectDays ?? 3,
    workdayHours: input.workdayHours ?? 8,
  };

  const calculated = calculateCommercialEstimate(
    commercialInput,
    catalog,
    service,
    "Residential",
  );

  return {
    ...calculated,
    serviceName: service.service_name,
    scope: [],
    calculatorInput: input,
  };
}

export function calculateCommercialEstimate(
  input: CommercialCalculatorInput,
  catalog: ServiceCatalogBundle,
  resolvedService?: ServiceCatalogBundle["services"][number],
  addonDivision: "Residential" | "Commercial" = "Commercial",
): EstimateResult {
  const workerHourlyPay = requireMinimumWorkerHourlyPay(
    input.workerHourlyPay,
  );

  const service =
    resolvedService ??
    catalog.services.find(
      (item) =>
        item.division !== "Residential" &&
        item.service_name === `${input.commercialType} Cleaning`,
    );

  if (!service) {
    throw new Error(
      `No active catalog service is configured for ${input.commercialType} Cleaning.`,
    );
  }

  if (
    service.pricing_config.requires_complete_pricing_config &&
    (!input.targetProjectDays ||
      input.targetProjectDays <= 0 ||
      ![8, 10].includes(input.workdayHours ?? 0))
  ) {
    throw new Error(
      `Custom Pricing Required for ${service.service_name}: choose valid target days and workday hours.`,
    );
  }

  const availableAddons = getAvailableServiceAddons(
    catalog,
    service.id,
    addonDivision,
  );

  const configured = commercialCatalogContext(
    input,
    service,
    availableAddons,
  );

  const productionRate = productionRateForCondition(
    service,
    input.condition,
    configured.productionRate,
  );

  if (productionRate <= 0) {
    throw new Error(`Custom Pricing Required for ${service.service_name}.`);
  }

  const productionHours = input.squareFeet / productionRate;

  const fixtureHours =
    input.restrooms * configured.restroomHours +
    input.kitchens * configured.kitchenHours +
    input.stations * configured.stationHours +
    input.units * configured.unitHours +
    Math.max(0, input.floors - 1) * configured.additionalFloorHours;

  const selectedServices = availableAddons.filter((item) =>
    input.additionalServices.includes(item.addon_name),
  );

  const addonLaborHours = selectedServices.reduce(
    (sum, item) => sum + Number(item.pricing_config.labor_hours ?? 0),
    0,
  );

  const laborHours = Math.max(
    input.targetCompletionHours || 0,
    productionHours + fixtureHours + addonLaborHours,
  );

  const availableHoursPerWorker =
    input.targetProjectDays && input.workdayHours
      ? input.targetProjectDays * input.workdayHours
      : input.targetCompletionHours || 4;

  const crewSize = Math.max(
    1,
    Math.ceil(laborHours / Math.max(1, availableHoursPerWorker)),
  );

  const laborCost = laborHours * workerHourlyPay;

  const supplyCost =
    Math.max(
      configured.minimumSupplyCost,
      input.squareFeet * configured.supplyCostPerSquareFoot,
    ) +
    selectedServices.reduce(
      (sum, item) =>
        sum +
        Number(item.pricing_config.supply_cost ?? 0),
      0,
    );

  const directCost = laborCost + supplyCost;

  // Light condition may improve realized productivity, but must not reduce the
  // customer recommendation below the equivalent Average-condition price.
  const recommendationLaborHours =
    input.condition === "Light"
      ? Math.max(
          input.targetCompletionHours || 0,
          input.squareFeet /
            productionRateForCondition(
              service,
              "Average",
              configured.productionRate,
            ) +
            fixtureHours +
            addonLaborHours,
        )
      : laborHours;

  const recommendationDirectCost =
    recommendationLaborHours * workerHourlyPay + supplyCost;

  const requestedTargetMargin = clamp(
    input.targetProfitMarginPercent || TARGET_MARGIN_PERCENT,
    NORMAL_MINIMUM_MARGIN_PERCENT,
    configured.maximumMarginPercent,
  );

  const profitabilityPrice =
    recommendationDirectCost / (1 - requestedTargetMargin / 100);

  const serviceFloor = commercialServiceFloor(
    service,
    input,
    catalog.tiers,
  );

  const oneTimePrice = Math.max(serviceFloor, profitabilityPrice);

  const pricing = calculateRecurringTotals({
    subtotal: oneTimePrice,
    frequency: input.frequency,
    customIntervalDays: input.customIntervalDays,
    rules: catalog.recurringRules,
    serviceId: service.id,
    recurringPricingRuleId: input.recurringPricingRuleId,
    manualDiscountPercent: input.additionalDiscountPercent,
    taxRatePercent: input.taxRatePercent,
  });

  const minimumFinalPreTax =
    directCost / (1 - NORMAL_MINIMUM_MARGIN_PERCENT / 100);

  const discountedPreTax = Math.max(
    0,
    pricing.priceAfterRecurringDiscount - pricing.manualDiscount,
  );

  const protectedPreTax = Math.max(discountedPreTax, minimumFinalPreTax);
  const protectedTaxes =
    protectedPreTax * Math.max(0, input.taxRatePercent || 0) / 100;
  const protectedFinalPrice = protectedPreTax + protectedTaxes;

  const protectedTotalDiscount = Math.max(
    0,
    oneTimePrice - protectedPreTax,
  );

  const recurringDiscount = Math.min(
    pricing.recurringDiscountAmount,
    protectedTotalDiscount,
  );

  const manualDiscount = Math.max(
    0,
    protectedTotalDiscount - recurringDiscount,
  );

  return result({
    input,
    serviceName: service.service_name,
    catalogAddons: snapshots(
      input.additionalServices,
      availableAddons,
      input.addonSelections,
    ),
    basePrice: serviceFloor,
    adjustments: configured.addonAdjustments,
    oneTimePrice,
    recurringPricingRuleId: pricing.recurringPricingRuleId,
    recurringPricingRuleName: pricing.recurringPricingRuleName,
    recurringDiscount,
    recurringDiscountPercent: pricing.recurringDiscountPercent,
    manualDiscount,
    totalDiscount: protectedTotalDiscount,
    taxes: protectedTaxes,
    finalPrice: protectedFinalPrice,
    laborHours,
    crewSize,
    laborCost,
    supplyCost,
    scope: [],
  });
}

function commercialServiceFloor(
  service: ServiceCatalogBundle["services"][number],
  input: CommercialCalculatorInput,
  tiers: ServiceCatalogBundle["tiers"],
): number {
  const serviceTiers = tiers
    .filter((tier) => tier.service_id === service.id && tier.is_active)
    .sort((a, b) => a.display_order - b.display_order);

  let tierValue = input.squareFeet;

  if (service.service_code === "PM-COMMON") {
    tierValue = input.units;
  } else if (service.service_code === "COM-TATTOO") {
    tierValue = input.stations;
  }

  const tier = serviceTiers.find((item) => {
    const minimum = item.min_value ?? Number.NEGATIVE_INFINITY;
    const maximum = item.max_value ?? Number.POSITIVE_INFINITY;
    return tierValue >= minimum && tierValue <= maximum;
  });

  const tierFloor = tier?.pricing_config.custom_quote === true
    ? 0
    : Number(tier?.price || 0);

  return Math.max(
    Number(service.minimum_price || 0),
    Number(service.base_price || 0),
    tierFloor,
  );
}

function productionRateForCondition(
  service: ServiceCatalogBundle["services"][number],
  condition: Condition,
  fallback: number,
): number {
  if (service.service_code === "COM-OFFICE") {
    if (condition === "Light") {
      return catalogConfigNumber(service, "light_production_rate") || 1200;
    }

    if (condition === "Heavy" || condition === "Extreme") {
      return catalogConfigNumber(service, "heavy_production_rate") || 650;
    }

    return (
      catalogConfigNumber(service, "average_production_rate") ||
      fallback ||
      900
    );
  }

  if (condition === "Light") {
    return fallback / 0.9;
  }

  if (condition === "Heavy") {
    return fallback / 1.25;
  }

  if (condition === "Extreme") {
    return fallback / 1.5;
  }

  return fallback;
}

function residentialIncludedBathrooms(
  serviceType: ResidentialCalculatorInput["serviceType"],
  bedrooms: number,
): number {
  if (serviceType === "Move-In/Move-Out") {
    if (bedrooms <= 1) return 1;
    if (bedrooms === 2) return 1;
    return 2;
  }

  if (bedrooms <= 2) return 1;
  return 2;
}

function residentialExpectedSquareFeet(bedrooms: number): number {
  if (bedrooms <= 0) return 650;
  if (bedrooms === 1) return 900;
  if (bedrooms === 2) return 1250;
  if (bedrooms === 3) return 1750;
  return 2250 + Math.max(0, bedrooms - 4) * 450;
}

function residentialBaseLaborHours(
  input: ResidentialCalculatorInput,
): number {
  const squareFootHours = input.squareFeet / 550;
  const bedroomHours = input.bedrooms * 0.2;
  const bathroomHours = input.bathrooms * 0.35;

  const serviceMultiplier =
    input.serviceType === "Deep"
      ? 1.35
      : input.serviceType === "Move-In/Move-Out"
        ? 1.2
        : 1;

  return Math.max(
    1.5,
    (squareFootHours + bedroomHours + bathroomHours) * serviceMultiplier,
  );
}

function addonDirectCost(
  names: string[],
  addons: ServiceCatalogBundle["addons"],
  selected: EstimateResult["calculatorInput"]["addonSelections"],
  workerHourlyPay: number,
): number {
  return names.reduce((total, name) => {
    const addon = addons.find((item) => item.addon_name === name);
    if (!addon) return total;

    const selection = selected?.find(
      (item) => item.catalogAddonId === addon.id,
    );

    const quantity = Math.max(1, Number(selection?.quantity ?? 1));
    const laborHours = Number(addon.pricing_config.labor_hours ?? 0);
    const supplyCost = Number(addon.pricing_config.supply_cost ?? 0);

    if (laborHours > 0 || supplyCost > 0) {
      return total + (laborHours * workerHourlyPay + supplyCost) * quantity;
    }

    return total;
  }, 0);
}

function result(values: {
  input: ResidentialCalculatorInput | CommercialCalculatorInput;
  serviceName: string;
  catalogAddons: EstimateResult["catalogAddons"];
  basePrice: number;
  adjustments: { label: string; amount: number }[];
  oneTimePrice: number;
  recurringPricingRuleId: string | null;
  recurringPricingRuleName: string | null;
  recurringDiscount: number;
  recurringDiscountPercent: number;
  manualDiscount: number;
  totalDiscount: number;
  taxes: number;
  finalPrice: number;
  laborHours: number;
  crewSize: number;
  laborCost: number;
  supplyCost: number;
  scope: string[];
}): EstimateResult {
  const frequency = values.input.frequency;

  return {
    ...values,
    serviceDescription: null,
    basePrice: money(values.basePrice),
    adjustments: values.adjustments.map((item) => ({
      ...item,
      amount: money(item.amount),
    })),
    oneTimePrice: money(values.oneTimePrice),
    recurringDiscount: money(values.recurringDiscount),
    manualDiscount: money(values.manualDiscount),
    totalDiscount: money(values.totalDiscount),
    taxes: money(values.taxes),
    finalPrice: money(values.finalPrice),
    monthlyPrice: estimatedMonthlyTotal(
      values.finalPrice,
      frequency,
      values.input.customIntervalDays,
    ),
    visitsPerMonth: estimatedVisitsPerMonth(
      frequency,
      values.input.customIntervalDays,
    ),
    laborHours: tenth(values.laborHours),
    crewSize: values.crewSize,
    estimatedDuration: tenth(values.laborHours / values.crewSize),
    laborCost: money(values.laborCost),
    supplyCost: money(values.supplyCost),
    estimatedProfit: money(
      values.finalPrice - values.laborCost - values.supplyCost,
    ),
    calculatorInput: values.input,
  };
}

function snapshots(
  names: string[],
  addons: ServiceCatalogBundle["addons"],
  selected: EstimateResult["calculatorInput"]["addonSelections"],
): EstimateResult["catalogAddons"] {
  return names
    .map((name) => addons.find((addon) => addon.addon_name === name))
    .filter(
      (addon): addon is NonNullable<typeof addon> => Boolean(addon),
    )
    .map(
      (addon) =>
        selected?.find(
          (item) => item.catalogAddonId === addon.id,
        ) ?? {
          id: addon.id,
          catalogAddonId: addon.id,
          name: addon.addon_name,
          description: addon.description,
          price: addon.price,
          pricingModel: addon.pricing_model,
          unitLabel: addon.unit_label,
        },
    );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value || 0));
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

function tenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function isPostConstructionInput(
  input: CalculatorInput,
): input is PostConstructionCalculatorInput {
  return (
    "calculatorType" in input &&
    input.calculatorType === "Post-Construction"
  );
}
