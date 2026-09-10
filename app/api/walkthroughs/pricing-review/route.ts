import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasPermission } from "@/lib/auth/permissions";
import { calculateCommercialEstimate, calculatePostConstructionCatalogEstimate, calculateResidentialEstimate } from "@/lib/pricing/estimates";
import { calculatePostConstructionV2 } from "@/lib/pricing/postConstruction";
import type { PostConstructionEstimateInput } from "@/lib/pricing/estimates";
import type { PostConstructionV2Input } from "@/types/estimate";
import { withAuthoritativeEstimatePrice } from "@/lib/pricing/authoritativePrice";
import { getAvailableServiceAddons, findCatalogService, isPostConstructionCatalogService } from "@/lib/services/serviceCatalog";
import { assessmentReadyForPricing, residentialPostConstructionScopeError } from "@/lib/walkthroughWorkflow";
import type { CalculatorInput, CommercialCalculatorInput, PostConstructionCalculatorInput, ResidentialCalculatorInput } from "@/types/estimate";
import type { ServiceCatalogBundle } from "@/types/serviceCatalog";
import type { UserProfile } from "@/types/auth";
import type { WalkthroughPricingReview, WalkthroughWithRelations } from "@/types/walkthrough";
import { AUTH_SYNCHRONIZATION_MESSAGE, AuthSynchronizationError, retryJwtIssuedAtFuture } from "@/lib/supabase/retry";

export async function POST(request: Request) {
  try {
    const sessionClient = await createSupabaseServerClient();
    const { data: userData } = await sessionClient.auth.getUser();
    if (!userData.user) return Response.json({ error: "Authentication is required." }, { status: 401 });

    const { data: profileData, error: profileError } = await retryJwtIssuedAtFuture(() =>
      sessionClient.from("user_profiles").select("*").eq("id", userData.user.id).single()
    );

    if (profileError) throw profileError;

    const profile = profileData as UserProfile;

    if (!hasPermission(profile, "proposals.create")) {
      return Response.json(
        { error: "Proposal pricing permission is required." },
        { status: 403 }
      );
    }

    const body = await request.json() as {
      walkthroughId?: unknown;
      calculatorInput?: unknown;
      manualPrice?: unknown;
    };

    if (typeof body.walkthroughId !== "string") {
      return Response.json(
        { error: "A Walkthrough is required." },
        { status: 400 }
      );
    }

    const admin = createSupabaseAdminClient();

    const { data: walkthroughData, error: walkthroughError } = await admin
      .from("walkthroughs")
      .select("*, estimate:estimates!walkthroughs_estimate_id_fkey(*)")
      .eq("id", body.walkthroughId)
      .single();

    if (walkthroughError) throw walkthroughError;

    const walkthrough = walkthroughData as WalkthroughWithRelations;

    const { data: proposal, error: proposalError } = await admin
      .from("proposals")
      .select("id")
      .eq("walkthrough_id", walkthrough.id)
      .is("archived_at", null)
      .maybeSingle();

    if (proposalError) throw proposalError;

    if (proposal) {
      return Response.json(
        { error: "This Walkthrough already has an active Proposal." },
        { status: 409 }
      );
    }

    if (walkthrough.status !== "Completed") {
      return Response.json(
        { error: "Complete the Walkthrough before approving pricing." },
        { status: 409 }
      );
    }

    const scopeError = residentialPostConstructionScopeError(walkthrough);
    if (scopeError) return Response.json({ error: scopeError }, { status: 400 });

    if (!assessmentReadyForPricing(walkthrough)) {
      return Response.json(
        {
          error:
            "Customer photo assessments must include submitted photos before pricing review.",
        },
        { status: 409 }
      );
    }

    const catalog = await loadCatalog(admin);
    let calculatorInput: CalculatorInput;
    try { calculatorInput = normalizeInput(body.calculatorInput, walkthrough.division); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid calculator input." }, { status: 400 }); }
    const assessmentServiceName = walkthrough.measurements.serviceType || walkthrough.estimate?.service_name || walkthrough.estimate?.result.serviceName || "";
    const assessmentService = findCatalogService(catalog.services, walkthrough.division, assessmentServiceName);
    const assessmentIsPostConstruction = isPostConstructionCatalogService(assessmentService) || /post[- ]construction/i.test(assessmentServiceName);
    if (assessmentIsPostConstruction !== isPostConstructionInput(calculatorInput)) {
      return Response.json({ error: "Calculator type must match the assessment service." }, { status: 400 });
    }
    if (isPostConstructionInput(calculatorInput) && body.manualPrice !== undefined) {
      return Response.json({ error: "Use projectCosting.manualProjectPriceOverride for V2 approved pricing." }, { status: 400 });
    }

    const service = findCatalogService(
      catalog.services,
      walkthrough.division,
      isPostConstructionInput(calculatorInput)
        ? calculatorInput.serviceType
        : calculatorInput.division === "Residential"
          ? calculatorInput.serviceType
          : calculatorInput.commercialType
    );

    if (!service) {
      return Response.json(
        { error: "Select an active Service Catalog service." },
        { status: 400 }
      );
    }

    if (isPostConstructionInput(calculatorInput) && !isPostConstructionCatalogService(service)) {
      return Response.json({ error: "Select an active Post-Construction catalog service." }, { status: 400 });
    }
    validateAddons(calculatorInput, catalog, service.id);

    const calculatedResult = isPostConstructionInput(calculatorInput)
      ? calculatePostConstructionCatalogEstimate(calculatorInput, catalog, service)
      : calculatorInput.division === "Residential"
        ? calculateResidentialEstimate(calculatorInput, catalog)
        : calculateCommercialEstimate(calculatorInput, catalog);

    const manualPrice =
      body.manualPrice === null || body.manualPrice === undefined
        ? null
        : nonnegative(body.manualPrice, "approved Walkthrough price");

    const estimateResult = isPostConstructionInput(calculatorInput) ? calculatedResult : withAuthoritativeEstimatePrice(
      calculatedResult,
      manualPrice
    );

    estimateResult.serviceDescription =
      walkthrough.measurements.serviceDescription ||
      service.description?.trim() ||
      null;

    const reviewedAt = new Date().toISOString();

    const review: WalkthroughPricingReview = {
      version: 1,
      calculatorInput: estimateResult.calculatorInput,
      estimateResult,
      serviceId: service.id,
      serviceName: estimateResult.serviceName,
      serviceDescription: estimateResult.serviceDescription,
      frequency: calculatorInput.frequency,
      catalogAddons: estimateResult.catalogAddons ?? [],
      scope: walkthrough.scope.map(item => item.label),
      finalReviewedPrice: estimateResult.finalPrice,
      reviewedAt,
      reviewedBy: {
        id: profile.id,
        displayName: profile.display_name || profile.email || profile.role,
      },
    };

    const { data: saved, error: saveError } = await admin
      .from("walkthroughs")
      .update({
        pricing_review: review,
        pricing_reviewed_at: reviewedAt,
        pricing_reviewed_by: profile.id,
      })
      .eq("id", walkthrough.id)
      .select("pricing_review,pricing_reviewed_at,pricing_reviewed_by")
      .single();

    if (saveError) throw saveError;

    return Response.json(saved);
  } catch (error) {
    console.error("Walkthrough pricing approval failed", error);

    if (error instanceof AuthSynchronizationError) {
      return Response.json(
        { error: AUTH_SYNCHRONIZATION_MESSAGE },
        { status: 503 }
      );
    }

    return Response.json(
      { error: "Walkthrough pricing could not be approved." },
      { status: 400 }
    );
  }
}

async function loadCatalog(
  admin: ReturnType<typeof createSupabaseAdminClient>
): Promise<ServiceCatalogBundle> {
  const [services, tiers, addons, addonLinks, recurringRules] = await Promise.all([
    admin.from("services").select("*").eq("is_active", true).is("archived_at", null),
    admin.from("service_price_tiers").select("*").eq("is_active", true),
    admin.from("service_addons").select("*").eq("is_active", true).is("archived_at", null),
    admin.from("service_addon_links").select("service_id,addon_id"),
    admin.from("recurring_pricing_rules").select("*").eq("is_active", true),
  ]);

  const failed = [services, tiers, addons, addonLinks, recurringRules].find(
    result => result.error
  );

  if (failed?.error) throw failed.error;

  return {
    services: services.data ?? [],
    tiers: tiers.data ?? [],
    addons: addons.data ?? [],
    addonLinks: addonLinks.data ?? [],
    recurringRules: recurringRules.data ?? [],
  } as ServiceCatalogBundle;
}

function normalizeInput(
  value: unknown,
  division: "Residential" | "Commercial"
): CalculatorInput {
  if (!value || typeof value !== "object") {
    throw new Error("Calculator input is required.");
  }

  const row = value as Record<string, unknown>;

  if (row.calculatorType === "Post-Construction") {
    if (row.version !== 2 || !row.projectCosting || typeof row.projectCosting !== "object" || Array.isArray(row.projectCosting)) {
      throw new Error("Explicit Post-Construction V2 project costing is required; legacy snapshots cannot be approved here.");
    }
    if (row.division !== division || row.serviceType !== "Post-Construction Cleaning" || row.frequency !== "One-Time") {
      throw new Error("Post-Construction V2 service, division, and one-time frequency must match the assessment.");
    }
    const raw = row.projectCosting as Record<string, unknown>;
    if (raw.version !== 2 || raw.calculatorType !== "Post-Construction") throw new Error("Mismatched V2 project costing version or type.");
    const projectCosting: PostConstructionV2Input = {
      version: 2, calculatorType: "Post-Construction",
      totalSquareFeet: division === "Residential" ? positive(raw.totalSquareFeet, "Total square feet") : number(raw.totalSquareFeet, "square feet"),
      estimatedPersonHours: number(raw.estimatedPersonHours, "person-hours"), crewSize: number(raw.crewSize, "crew size"),
      workerHourlyPay: number(raw.workerHourlyPay, "worker hourly pay"), plannedProjectDays: number(raw.plannedProjectDays, "project days"),
      workdayHours: workday(raw.workdayHours) ?? (() => { throw new Error("Workday hours are required."); })(),
      suppliesCost: number(raw.suppliesCost, "supplies"), equipmentRentalCost: number(raw.equipmentRentalCost, "equipment rental"),
      travelLogisticsCost: number(raw.travelLogisticsCost, "travel"), disposalDebrisCost: number(raw.disposalDebrisCost, "disposal"),
      supervisionAdminCost: number(raw.supervisionAdminCost, "supervision"), contingencyCost: number(raw.contingencyCost, "contingency"),
      desiredMarginPercent: number(raw.desiredMarginPercent, "margin"),
      ...(raw.scope === undefined ? {} : { scope: strings(raw.scope) }),
      ...(raw.manualProjectPriceOverride === undefined ? {} : { manualProjectPriceOverride: number(raw.manualProjectPriceOverride, "manual project price") }),
    };
    calculatePostConstructionV2(projectCosting);
    if (strings(row.additionalServices).length) throw new Error("V2 project costing does not include catalog add-ons.");
    const input: PostConstructionEstimateInput = {
      version: 2, projectCosting, calculatorType: "Post-Construction", division, serviceType: "Post-Construction Cleaning",
      frequency: "One-Time", condition: oneOf(row.condition, ["Light", "Average", "Heavy", "Extreme"] as const, "condition"),
      squareFeet: projectCosting.totalSquareFeet, floors: division === "Residential" ? positive(row.floors, "Floors") : 1,
      rooms: division === "Residential" ? nonnegative(row.rooms, "Bedrooms") : 0,
      bathrooms: division === "Residential" ? nonnegative(row.bathrooms, "Bathrooms") : 0,
      kitchens: division === "Residential" ? nonnegative(row.kitchens, "Kitchens") : 0,
      dustSeverity: "Average", debrisSeverity: "Average", detailLevel: "Detailed", windowsOrGlassCount: 0,
      cabinetOrDrawerCount: 0, applianceInteriorCount: 0, stairFlights: 0,
      targetProjectDays: projectCosting.plannedProjectDays, workdayHours: projectCosting.workdayHours,
      workerHourlyPay: projectCosting.workerHourlyPay, targetProfitMarginPercent: projectCosting.desiredMarginPercent,
      additionalDiscountPercent: 0, taxRatePercent: 0, additionalServices: [],
    };
    return input;
  }

  const frequency = oneOf(
    row.frequency,
    ["One-Time", "Daily", "Weekly", "Biweekly", "Twice Monthly", "Monthly", "Custom"] as const,
    "frequency"
  );

  const customIntervalDays =
    frequency === "Custom"
      ? positiveInteger(row.customIntervalDays, "custom interval days")
      : undefined;

  const condition = oneOf(
    row.condition,
    ["Light", "Average", "Heavy", "Extreme"] as const,
    "condition"
  );

  if (division === "Residential" && row.division === "Residential") {
    return {
      division: "Residential",
      serviceType: text(row.serviceType, "service"),
      frequency,
      customIntervalDays,
      condition,
      squareFeet: positive(row.squareFeet, "square feet"),
      bedrooms: nonnegative(row.bedrooms, "bedrooms"),
      bathrooms: nonnegative(row.bathrooms, "bathrooms"),
      occupied: boolean(row.occupied, "occupancy"),
      pets: boolean(row.pets, "pets"),
      additionalDiscountPercent: percent(row.additionalDiscountPercent),
      taxRatePercent: 0,
      addOns: strings(row.addOns),
      targetProjectDays: optionalPositive(row.targetProjectDays),
      workdayHours: workday(row.workdayHours),
    } satisfies ResidentialCalculatorInput;
  }

  if (division === "Commercial" && row.division === "Commercial") {
    return {
      division: "Commercial",
      commercialType: text(row.commercialType, "service"),
      frequency,
      customIntervalDays,
      condition,
      squareFeet: positive(row.squareFeet, "square feet"),
      floors: positive(row.floors, "floors"),
      restrooms: nonnegative(row.restrooms, "restrooms"),
      kitchens: nonnegative(row.kitchens, "kitchens"),
      stations: nonnegative(row.stations, "stations"),
      units: nonnegative(row.units, "units"),
      targetCompletionHours: positive(
        row.targetCompletionHours,
        "target completion hours"
      ),
      workerHourlyPay: positive(row.workerHourlyPay, "worker hourly pay"),
      targetProfitMarginPercent: percent(row.targetProfitMarginPercent),
      additionalDiscountPercent: percent(row.additionalDiscountPercent),
      taxRatePercent: 0,
      additionalServices: strings(row.additionalServices),
      targetProjectDays: optionalPositive(row.targetProjectDays),
      workdayHours: workday(row.workdayHours),
    } satisfies CommercialCalculatorInput;
  }

  throw new Error("Calculator division does not match the Walkthrough.");
}

function validateAddons(
  input: CalculatorInput,
  catalog: ServiceCatalogBundle,
  serviceId: string
) {
  const allowed = new Set(
    getAvailableServiceAddons(catalog, serviceId, input.division).map(
      item => item.addon_name
    )
  );

  const selected = isPostConstructionInput(input)
    ? input.additionalServices
    : input.division === "Residential"
      ? input.addOns
      : input.additionalServices;

  if (selected.some(item => !allowed.has(item))) {
    throw new Error("An add-on is not available for this service.");
  }
}

function isPostConstructionInput(
  input: CalculatorInput
): input is PostConstructionCalculatorInput {
  return (
    "calculatorType" in input &&
    input.calculatorType === "Post-Construction"
  );
}

function text(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Valid ${label} is required.`);
  }

  return value.trim();
}

function number(value: unknown, label: string) {
  const n = typeof value === "number" ? value : Number.NaN;

  if (!Number.isFinite(n)) {
    throw new Error(`Valid ${label} is required.`);
  }

  return n;
}

function positive(value: unknown, label: string) {
  const n = number(value, label);

  if (n <= 0) {
    throw new Error(`${label} must be greater than zero.`);
  }

  return n;
}

function positiveInteger(value: unknown, label: string) {
  const n = positive(value, label);

  if (!Number.isInteger(n)) {
    throw new Error(`${label} must be a whole number.`);
  }

  return n;
}

function nonnegative(value: unknown, label: string) {
  const n = number(value, label);

  if (n < 0) {
    throw new Error(`${label} cannot be negative.`);
  }

  return n;
}

function percent(value: unknown) {
  const n = number(value, "percentage");

  if (n < 0 || n > 100) {
    throw new Error("Percentage must be between 0 and 100.");
  }

  return n;
}

function optionalPositive(value: unknown) {
  return value === undefined || value === null
    ? undefined
    : positive(value, "target project days");
}

function workday(value: unknown): 8 | 10 | undefined {
  if (value === undefined || value === null) return undefined;

  if (value !== 8 && value !== 10) {
    throw new Error("Workday hours must be 8 or 10.");
  }

  return value;
}

function boolean(value: unknown, label: string) {
  if (typeof value !== "boolean") {
    throw new Error(`Valid ${label} is required.`);
  }

  return value;
}

function strings(value: unknown) {
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
    throw new Error("Invalid add-on selection.");
  }

  return value.map(item => item.trim()).filter(Boolean);
}

function oneOf<T extends string>(
  value: unknown,
  choices: readonly T[],
  label: string
): T {
  if (!choices.includes(value as T)) {
    throw new Error(`Valid ${label} is required.`);
  }

  return value as T;
}