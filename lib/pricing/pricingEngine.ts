import type {
  CommercialCalculatorInput,
  ResidentialCalculatorInput,
} from "@/types/estimate";

import type {
  CatalogAddonSnapshot,
  CatalogService,
  RecurringPricingRule,
  ServiceAddon,
  ServicePriceTier,
} from "@/types/serviceCatalog";

import { estimatedMonthlyTotal } from "@/lib/scheduling/frequency";

export function findMatchingTier(
  tiers: ServicePriceTier[],
  value: number,
) {
  return (
    tiers
      .filter(
        (tier) =>
          tier.is_active &&
          (tier.min_value == null || value >= tier.min_value) &&
          (tier.max_value == null || value <= tier.max_value),
      )
      .sort((a, b) => a.display_order - b.display_order)[0] ?? null
  );
}

export function calculateAddons(
  names: string[],
  addons: ServiceAddon[],
  hourlyRate = 0,
  selections?: CatalogAddonSnapshot[],
) {
  return names.map((name) => {
    const addon = addons.find(
      (item) => item.addon_name === name,
    );

    if (!addon) {
      throw new Error(
        `Pricing is unavailable for add-on: ${name}`,
      );
    }

    const selected = selections?.find(
      (item) => item.catalogAddonId === addon.id,
    );

    const pricingType = String(
      addon.pricing_config.pricing_type ?? "Flat Price",
    );

    const quantity =
      selected?.quantity ??
      (pricingType === "Per Unit" ? undefined : 1);

    const unitName =
      String(
        addon.pricing_config.unit_name ??
          addon.unit_label ??
          "",
      ).trim() || null;

    const rawUnitPrice =
      addon.pricing_config.unit_price ?? addon.price;

    const unitPrice = Number(rawUnitPrice);

    if (
      pricingType === "Per Unit" &&
      (!Number.isInteger(quantity) || Number(quantity) < 1)
    ) {
      throw new Error(
        `Enter a whole-number quantity of at least 1 for ${addon.addon_name}.`,
      );
    }

    if (pricingType === "Per Unit" && !unitName) {
      throw new Error(
        `Configure a unit name for ${addon.addon_name}.`,
      );
    }

    if (
      rawUnitPrice == null ||
      !Number.isFinite(unitPrice) ||
      unitPrice < 0
    ) {
      throw new Error(
        `Configure a valid price for ${addon.addon_name}.`,
      );
    }

    const laborHours = Number(
      addon.pricing_config.labor_hours ?? 0,
    );

    const rawSupplyCost =
      addon.pricing_config.supply_cost ?? 0;

    const supplyCost = Number(rawSupplyCost);

    if (
      !Number.isFinite(laborHours) ||
      laborHours < 0 ||
      !Number.isFinite(supplyCost) ||
      supplyCost < 0
    ) {
      throw new Error(
        `Configure valid labor and supply pricing for ${addon.addon_name}.`,
      );
    }

    const configuredMinimum = Number(
      addon.pricing_config.minimum_price ?? addon.price ?? 0,
    );

    const safeMinimum =
      Number.isFinite(configuredMinimum) &&
      configuredMinimum >= 0
        ? configuredMinimum
        : 0;

    let base: number;

    if (addon.pricing_model === "Custom") {
      const calculatedCost =
        laborHours * Math.max(0, hourlyRate) + supplyCost;

      base = Math.max(
        safeMinimum,
        calculatedCost,
      );
    } else if (pricingType === "Per Unit") {
      base = unitPrice * Number(quantity);
    } else {
      base = Math.max(
        safeMinimum,
        unitPrice,
      );
    }

    if (!Number.isFinite(base)) {
      throw new Error(
        `Pricing is unavailable for add-on: ${addon.addon_name}`,
      );
    }

    return {
      label: name,
      amount: round(base),
      catalogAddonId: addon.id,
      description: addon.description,
      pricingModel: addon.pricing_model,
      unitLabel: addon.unit_label,
      quantity:
        pricingType === "Per Unit"
          ? Number(quantity)
          : undefined,
      unitName:
        pricingType === "Per Unit"
          ? unitName
          : undefined,
      unitPrice:
        pricingType === "Per Unit"
          ? unitPrice
          : undefined,
    };
  });
}

export function matchingRecurringRules(
  frequency: string,
  rules: RecurringPricingRule[],
  serviceId: string,
) {
  const specific = rules.filter(
    (rule) =>
      rule.is_active &&
      rule.frequency === frequency &&
      rule.service_id === serviceId,
  );

  if (specific.length) {
    return specific;
  }

  return rules.filter(
    (rule) =>
      rule.is_active &&
      rule.frequency === frequency &&
      rule.service_id === null,
  );
}

export function applyRecurringRule(
  amount: number,
  frequency: string,
  rules: RecurringPricingRule[],
  serviceId: string,
  ruleId?: string | null,
) {
  const matches = matchingRecurringRules(
    frequency,
    rules,
    serviceId,
  );

  const rule = ruleId
    ? matches.find((item) => item.id === ruleId)
    : matches.length === 1
      ? matches[0]
      : undefined;

  if (ruleId && !rule) {
    throw new Error(
      "The selected recurring pricing rule is unavailable for this service and frequency.",
    );
  }

  if (!rule && matches.length > 1) {
    throw new Error(
      "Select a recurring pricing rule before calculating this frequency.",
    );
  }

  if (!rule) {
    return {
      amount,
      discount: 0,
      percent: 0,
      rule: null,
    };
  }

  if (rule.adjustment_type === "Percentage") {
    const percentage = clampPercent(
      rule.adjustment_value,
    );

    const discount =
      amount * (percentage / 100);

    return {
      amount: Math.max(0, amount - discount),
      discount,
      percent: percentage,
      rule,
    };
  }

  if (rule.adjustment_type === "Flat Amount") {
    const discount = Math.min(
      amount,
      Math.max(0, rule.adjustment_value),
    );

    return {
      amount: Math.max(0, amount - discount),
      discount,
      percent:
        amount > 0
          ? (discount / amount) * 100
          : 0,
      rule,
    };
  }

  const overridePrice = Math.max(
    0,
    rule.adjustment_value,
  );

  const discount = Math.max(
    0,
    amount - overridePrice,
  );

  return {
    amount: overridePrice,
    discount,
    percent:
      amount > 0
        ? (discount / amount) * 100
        : 0,
    rule,
  };
}

export function calculateRecurringTotals(input: {
  subtotal: number;
  frequency: string;
  customIntervalDays?: number | null;
  rules: RecurringPricingRule[];
  serviceId: string;
  recurringPricingRuleId?: string | null;
  manualDiscountAmount?: number;
  manualDiscountPercent?: number;
  taxRatePercent?: number;
  fixedTaxes?: number;
}) {
  const subtotal = Math.max(
    0,
    Number(input.subtotal) || 0,
  );

  const recurring = applyRecurringRule(
    subtotal,
    input.frequency,
    input.rules,
    input.serviceId,
    input.recurringPricingRuleId,
  );

  const requestedManualDiscount =
    input.manualDiscountAmount ??
    subtotal *
      (clampPercent(
        input.manualDiscountPercent ?? 0,
      ) /
        100);

  const manualDiscount = Math.min(
    recurring.amount,
    Math.max(0, requestedManualDiscount),
  );

  const taxable = Math.max(
    0,
    recurring.amount - manualDiscount,
  );

  const taxes =
    input.fixedTaxes != null
      ? Math.max(0, input.fixedTaxes)
      : taxable *
        (clampPercent(
          input.taxRatePercent ?? 0,
        ) /
          100);

  const finalPrice =
    taxable + Math.max(0, taxes);

  return {
    subtotal: round(subtotal),
    recurringPricingRuleId:
      recurring.rule?.id ?? null,
    recurringPricingRuleName:
      recurring.rule?.rule_name ?? null,
    recurringDiscountPercent: round(
      recurring.percent,
    ),
    recurringDiscountAmount: round(
      recurring.discount,
    ),
    priceAfterRecurringDiscount: round(
      recurring.amount,
    ),
    manualDiscount: round(manualDiscount),
    taxes: round(taxes),
    finalPrice: round(finalPrice),
    monthlyPrice: estimatedMonthlyTotal(
      finalPrice,
      input.frequency,
      input.customIntervalDays,
    ),
  };
}

export function residentialCatalogPrice(
  input: ResidentialCalculatorInput,
  service: CatalogService,
  tiers: ServicePriceTier[],
  addons: ServiceAddon[],
) {
  const serviceTiers = tiers
    .filter(
      (tier) =>
        tier.service_id === service.id &&
        tier.is_active,
    )
    .sort(
      (a, b) =>
        a.display_order - b.display_order,
    );

  if (!serviceTiers.length) {
    throw new Error(
      `No active price tiers are configured for ${service.service_name}.`,
    );
  }

  const exactBedBath = serviceTiers.find(
    (tier) =>
      tier.pricing_config.bedrooms ===
        input.bedrooms &&
      tier.pricing_config.bathrooms ===
        input.bathrooms,
  );

  const bedroomOnly = serviceTiers.find(
    (tier) =>
      tier.pricing_config.bedrooms ===
        input.bedrooms &&
      tier.pricing_config.bathrooms == null,
  );

  const numericBedroomTier = findMatchingTier(
    serviceTiers,
    input.bedrooms,
  );

  /*
   * Standard and Deep are bedroom-floor services.
   * Move-In/Move-Out prefers the exact bedroom/bathroom
   * configuration. Unsupported larger configurations use
   * the highest configured catalog floor, then the labor
   * calculator raises the recommendation as necessary.
   *
   * This prevents an unsupported home from silently
   * resolving to a cheaper smaller-home tier.
   */
  let tier =
    exactBedBath ??
    bedroomOnly ??
    numericBedroomTier;

  if (!tier) {
    const configuredBedroomTiers =
      serviceTiers.filter(
        (item) =>
          typeof item.pricing_config.bedrooms ===
          "number",
      );

    const largestConfigured =
      configuredBedroomTiers
        .slice()
        .sort(
          (a, b) =>
            Number(
              b.pricing_config.bedrooms ?? 0,
            ) -
            Number(
              a.pricing_config.bedrooms ?? 0,
            ),
        )[0] ?? null;

    if (
      largestConfigured &&
      input.bedrooms >
        Number(
          largestConfigured.pricing_config
            .bedrooms ?? 0,
        )
    ) {
      tier = largestConfigured;
    }
  }

  if (!tier) {
    throw new Error(
      `No catalog floor is configured for ${input.bedrooms} bedroom(s) / ${input.bathrooms} bathroom(s) for ${service.service_name}.`,
    );
  }

  return {
    basePrice: Math.max(
      Number(tier.price) || 0,
      Number(service.minimum_price) || 0,
    ),
    isExactConfiguration: Boolean(
      exactBedBath || bedroomOnly,
    ),
    addonAdjustments: calculateAddons(
      input.addOns,
      addons,
      0,
      input.addonSelections,
    ),
  };
}

export function catalogConfigNumber(
  service: CatalogService,
  key: string,
) {
  const raw = service.pricing_config[key];
  const value = Number(raw);

  if (
    raw == null ||
    raw === "" ||
    !Number.isFinite(value)
  ) {
    throw new Error(
      `Pricing configuration is missing ${key} for ${service.service_name}.`,
    );
  }

  return value;
}

export function commercialCatalogContext(
  input: CommercialCalculatorInput,
  service: CatalogService,
  addons: ServiceAddon[],
) {
  const context = {
    productionRate: catalogConfigNumber(
      service,
      "production_rate",
    ),
    restroomHours: catalogConfigNumber(
      service,
      "restroom_hours",
    ),
    kitchenHours: catalogConfigNumber(
      service,
      "kitchen_hours",
    ),
    stationHours: catalogConfigNumber(
      service,
      "station_hours",
    ),
    unitHours: catalogConfigNumber(
      service,
      "unit_hours",
    ),
    additionalFloorHours: catalogConfigNumber(
      service,
      "additional_floor_hours",
    ),
    minimumSupplyCost: catalogConfigNumber(
      service,
      "minimum_supply_cost",
    ),
    supplyCostPerSquareFoot:
      catalogConfigNumber(
        service,
        "supply_cost_per_square_foot",
      ),
    maximumMarginPercent:
      catalogConfigNumber(
        service,
        "maximum_margin_percent",
      ),
    minimumMarginDenominator:
      catalogConfigNumber(
        service,
        "minimum_margin_denominator",
      ),
    addonAdjustments: calculateAddons(
      input.additionalServices,
      addons,
      input.workerHourlyPay,
      input.addonSelections,
    ),
  };

  assertProductionPricing(
    service,
    context,
  );

  return context;
}

export function assertProductionPricing(
  service: CatalogService,
  context: {
    productionRate: number;
    minimumSupplyCost: number;
    supplyCostPerSquareFoot: number;
    maximumMarginPercent: number;
    minimumMarginDenominator: number;
  },
) {
  if (context.productionRate <= 0) {
    throw new Error(
      `Custom Pricing Required for ${service.service_name}: configure a production rate.`,
    );
  }

  if (
    service.pricing_config
      .requires_complete_pricing_config &&
    context.minimumSupplyCost <= 0 &&
    context.supplyCostPerSquareFoot <= 0
  ) {
    throw new Error(
      `Custom Pricing Required for ${service.service_name}: configure supply or material costs.`,
    );
  }

  if (
    context.maximumMarginPercent <= 0 ||
    context.maximumMarginPercent >= 100 ||
    context.minimumMarginDenominator <= 0
  ) {
    throw new Error(
      `Custom Pricing Required for ${service.service_name}: configure valid margin guardrails.`,
    );
  }
}

export function calculateServicePrice(
  service: CatalogService,
  quantity: number,
  tiers: ServicePriceTier[],
) {
  const basePrice = Number(
    service.base_price,
  );

  const minimumPrice = Number(
    service.minimum_price,
  );

  const safeBase =
    Number.isFinite(basePrice)
      ? Math.max(0, basePrice)
      : 0;

  const safeMinimum =
    Number.isFinite(minimumPrice)
      ? Math.max(0, minimumPrice)
      : 0;

  /*
   * Custom services with a real catalog floor may still
   * auto-populate Direct Jobs. Post-Construction now has
   * a $0 catalog anchor, so it correctly falls through to
   * manual/calculator pricing instead.
   */
  if (service.pricing_model === "Custom") {
    const configuredFloor = Math.max(
      safeBase,
      safeMinimum,
    );

    return configuredFloor > 0
      ? configuredFloor
      : null;
  }

  if (service.pricing_model === "Size Tier") {
    const tier = findMatchingTier(
      tiers.filter(
        (item) =>
          item.service_id === service.id,
      ),
      quantity,
    );

    if (!tier) {
      return null;
    }

    if (tier.pricing_config.custom_quote === true) {
      return null;
    }

    return Math.max(
      Number(tier.price) || 0,
      safeMinimum,
    );
  }

  if (
    service.pricing_model === "Flat Rate" ||
    service.pricing_model === "Per Visit"
  ) {
    return Math.max(
      safeBase,
      safeMinimum,
    );
  }

  return Math.max(
    safeBase * Math.max(0, quantity),
    safeMinimum,
  );
}

const round = (value: number) =>
  Math.round(value * 100) / 100;

const clampPercent = (value: number) =>
  Math.min(
    100,
    Math.max(0, Number(value) || 0),
  );
