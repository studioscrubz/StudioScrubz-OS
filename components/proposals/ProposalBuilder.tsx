"use client";
/* eslint-disable react-hooks/static-components -- legacy one-line builder slot is selected by record persistence state */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getEstimates } from "@/lib/services/estimates";
import {
  getWalkthroughs,
  updateWalkthroughStatus,
} from "@/lib/services/walkthroughs";
import {
  calculateProposal,
  repriceEstimateFrequency,
  withProposalRevisionBaseline,
} from "@/lib/pricing/proposals";
import {
  withAuthoritativeProposalPrice,
  withPreservedProposalPrice,
} from "@/lib/pricing/authoritativePrice";
import { matchingRecurringRules } from "@/lib/pricing/pricingEngine";
import { createProposal, updateProposal } from "@/lib/services/proposals";
import { getProposalPricingPhotos } from "@/lib/services/proposalPhotos";
import { getBusinessSettings } from "@/lib/services/businessSettings";
import {
  findCatalogService,
  getAvailableServiceAddons,
  getServiceCatalog,
} from "@/lib/services/serviceCatalog";
import type {
  CatalogService,
  RecurringPricingRule,
  ServiceCatalogBundle,
} from "@/types/serviceCatalog";
import { CatalogAddonPicker } from "@/components/serviceCatalog/CatalogAddonPicker";
import type { EstimateResult, EstimateWithRelations, Frequency, ServiceWeekday, WeeklyMixedVisit } from "@/types/estimate";
import { WeeklyMixedScopeCalculator, newWeeklyVisit } from "@/components/estimates/WeeklyMixedScopeCalculator";
import { mixedVisitTotals } from "@/lib/pricing/weeklyMixedVisits";
import { recoverWeeklyVisitsFromScope, withProposalWeeklyVisitPrices } from "@/lib/pricing/proposalWeeklyVisits";
import { WeeklyServiceDaysField } from "@/components/forms/WeeklyServiceDaysField";
import { validServiceWeekdays } from "@/lib/scheduling/frequency";
import type { WalkthroughWithRelations } from "@/types/walkthrough";
import type {
  ProposalAdjustment,
  ProposalInsert,
  ProposalResult,
  ProposalScopeItem,
  ProposalTerms,
  ProposalWithRelations,
} from "@/types/proposal";
import { useOperationalRealtime } from "@/components/realtime/OperationalRealtimeProvider";
import { PhotoUploader as WalkthroughPhotoUploader } from "@/components/photos/PhotoUploader";
import { useAuth } from "@/components/auth/AuthProvider";
import { canManageProposalPricingPhotos } from "@/lib/auth/permissions";
import { ProposalPricingPhotos } from "@/components/proposals/ProposalPricingPhotos";
import { serviceFrequencyLabel } from "@/lib/scheduling/frequency";
import { proposalAddonSnapshots, replaceProposalCatalogAddons, selectProposalCatalogAddons } from "@/lib/pricing/proposalAddons";
import { calculateProfitability } from "@/lib/pricing/profitability";
import { canAccessFinances } from "@/lib/auth/permissions";
import { ProfitabilityPanel } from "@/components/estimates/ProfitabilityPanel";
import { getProfitabilityProjection, getProfitabilitySettings, saveProfitabilityProjection } from "@/lib/services/profitability";
import type { ProfitabilityProjection, ProfitabilitySettings, TravelProjection } from "@/types/profitability";

const termsDefault: ProposalTerms = {
  paymentTerms: "Payment due upon completion of service.",
  cancellationPolicy:
    "Please provide at least 24 hours notice for cancellations.",
  accessRequirements: "Client will provide safe and timely property access.",
  specialConditions: "",
};
function proposalPricingFingerprint(value: {
  frequency: Frequency;
  serviceDaysOfWeek: ServiceWeekday[];
  ruleId: string;
  additionalLabor: number;
  additionalMaterials: number;
  discount: number;
  adjustments: ProposalAdjustment[];
  serviceName: string;
  serviceDescription: string;
  laborHoursOverride: number | null;
  crewSizeOverride: number | null;
}) {
  return JSON.stringify(value);
}
export function ProposalBuilder({
  proposal,
  onSaved,
}: {
  proposal?: ProposalWithRelations;
  onSaved?: () => void;
}) {
  const { profile } = useAuth();
  const canViewProfitability = canAccessFinances(profile);
  const canManagePricingPhotos = canManageProposalPricingPhotos(profile);
  // The legacy builder renders this slot deep inside a compact JSX expression.
  // Keep its public props while swapping the implementation for saved Proposals.
  const PhotoUploader = useMemo(
    () =>
      proposal
        ? function SavedProposalPricingPhotos() {
            return (
              <ProposalPricingPhotos
                proposalId={proposal.id}
                status={proposal.status}
                canManage={canManagePricingPhotos}
              />
            );
          }
        : WalkthroughPhotoUploader,
    [canManagePricingPhotos, proposal],
  );
  const [catalog, setCatalog] = useState<ServiceCatalogBundle | null>(null);
  const [profitabilitySettings, setProfitabilitySettings] = useState<ProfitabilitySettings | null>(null);
  const [sourceProfitability, setSourceProfitability] = useState<ProfitabilityProjection | null>(null);
  const router = useRouter();
  const [mode, setMode] = useState<"estimate" | "walkthrough">(
    proposal?.walkthrough_id ? "walkthrough" : "estimate",
  );
  const [estimates, setEstimates] = useState<EstimateWithRelations[]>([]);
  const [walkthroughs, setWalkthroughs] = useState<WalkthroughWithRelations[]>(
    [],
  );
  const [sourceId, setSourceId] = useState(
    proposal?.walkthrough_id ?? proposal?.estimate_id ?? "",
  );
  const [search, setSearch] = useState("");
  const [frequency, setFrequency] = useState<Frequency>(
    proposal?.frequency ?? "One-Time",
  );
  const [serviceDaysOfWeek, setServiceDaysOfWeek] = useState<ServiceWeekday[]>(proposal?.result.serviceDaysOfWeek ?? []);
  const [weeklyMixedVisits, setWeeklyMixedVisits] = useState<WeeklyMixedVisit[] | null>(() => proposal?.result.weeklyMixedVisits ?? (proposal?.frequency === "Multiple Days Per Week" ? recoverWeeklyVisitsFromScope(proposal.result.scope, proposal.result.serviceDaysOfWeek ?? []) : null) ?? null);
  const [selectedRuleId, setSelectedRuleId] = useState(
    proposal?.result.recurringPricingRuleId ?? "",
  );
  const [requestedDate, setRequestedDate] = useState(
    proposal?.requested_date ?? "",
  );
  const [representative, setRepresentative] = useState(
    proposal?.representative_name ?? "Master Admin",
  );
  const [notes, setNotes] = useState(proposal?.notes ?? "");
  const [manualPrice, setManualPrice] = useState<number | null>(
    proposal?.result.manualPerVisitTotal ?? null,
  );
  const [adjustmentLabel, setAdjustmentLabel] = useState(proposal?.result.finalPriceAdjustmentLabel ?? "");
  const [preserveStoredPriceBaseline, setPreserveStoredPriceBaseline] =
    useState(Boolean(proposal && proposal.result.manualPerVisitTotal == null));
  const [additionalLabor, setAdditionalLabor] = useState(
    proposal?.result.additionalLabor ?? 0,
  );
  const [additionalMaterials, setAdditionalMaterials] = useState(
    proposal?.result.additionalMaterials ?? 0,
  );
  const [laborHoursOverride, setLaborHoursOverride] = useState<number | null>(
    proposal?.result.laborHoursOverride ?? null,
  );
  const [crewSizeOverride, setCrewSizeOverride] = useState<number | null>(
    proposal?.result.crewSizeOverride ?? null,
  );
  const [discount, setDiscount] = useState(
    proposal
      ? (proposal.result.manualDiscount /
          Math.max(1, proposal.result.baseEstimateAmount)) *
          100
      : 0,
  );
  const [adjustments, setAdjustments] = useState<ProposalAdjustment[]>(
    proposal?.result.adjustments ?? [],
  );
  const [scope, setScope] = useState<ProposalScopeItem[]>(
    proposal?.result.scope ?? [],
  );
  const [terms, setTerms] = useState<ProposalTerms>(
    proposal?.result.terms ?? termsDefault,
  );
  const [expiration, setExpiration] = useState(
    proposal?.expiration_date ?? plusDays(30),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [services, setServices] = useState<CatalogService[]>([]);
  const [rules, setRules] = useState<RecurringPricingRule[]>([]);
  const [serviceName, setServiceName] = useState(
    proposal?.result.serviceName ?? "",
  );
  const [serviceDescription, setServiceDescription] = useState(
    proposal?.result.serviceDescription ?? "",
  );
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [estimatedCleaningDays, setEstimatedCleaningDays] = useState<
    number | null
  >(proposal?.result.estimatedCleaningDays ?? null);
  const [estimatedHoursPerDay, setEstimatedHoursPerDay] = useState<
    number | null
  >(proposal?.result.estimatedHoursPerDay ?? null);
  const [initialPricingFingerprint] = useState(() =>
    proposalPricingFingerprint({
      frequency: proposal?.frequency ?? "One-Time",
      serviceDaysOfWeek: proposal?.result.serviceDaysOfWeek ?? [],
      ruleId: proposal?.result.recurringPricingRuleId ?? "",
      additionalLabor: proposal?.result.additionalLabor ?? 0,
      additionalMaterials: proposal?.result.additionalMaterials ?? 0,
      discount: proposal
        ? (proposal.result.manualDiscount /
            Math.max(1, proposal.result.baseEstimateAmount)) *
          100
        : 0,
      adjustments: proposal?.result.adjustments ?? [],
      serviceName: proposal?.result.serviceName ?? "",
      serviceDescription: proposal?.result.serviceDescription ?? "",
      laborHoursOverride: proposal?.result.laborHoursOverride ?? null,
      crewSizeOverride: proposal?.result.crewSizeOverride ?? null,
    }),
  );
  const pricingFingerprint = proposalPricingFingerprint({
    frequency,
    serviceDaysOfWeek,
    ruleId: selectedRuleId,
    additionalLabor,
    additionalMaterials,
    discount,
    adjustments,
    serviceName,
    serviceDescription,
    laborHoursOverride,
    crewSizeOverride,
  });
  useOperationalRealtime(
    [
      "services",
      "service_addons",
      "service_addon_links",
      "service_price_tiers",
      "recurring_pricing_rules",
    ],
    async () => {
      const bundle = await getServiceCatalog();
      setCatalog(bundle);
      setServices(bundle.services);
      setRules(bundle.recurringRules);
    },
  );
  useEffect(() => {
    void getServiceCatalog()
      .then((bundle) => {
        setCatalog(bundle);
        setServices(bundle.services);
        setRules(bundle.recurringRules);
      })
      .catch((x: unknown) =>
        setError(msg(x, "Service Catalog could not be loaded.")),
      );
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.all([getEstimates(), getWalkthroughs(), getBusinessSettings()])
      .then(([e, w, settings]) => {
        if (active) {
          setEstimates(e);
          setWalkthroughs(w);
          if (!proposal) {
            setExpiration(plusDays(settings.default_proposal_expiration_days));
            setTerms((current) => ({
              ...current,
              paymentTerms:
                settings.default_proposal_terms ?? current.paymentTerms,
            }));
          }
        }
      })
      .catch((x: unknown) => {
        console.error("Proposal sources failed", x);
        if (active)
          setError(msg(x, "Sources or proposal defaults could not be loaded."));
      });
    return () => {
      active = false;
    };
  }, [proposal]);
  useEffect(() => {
    if (proposal || !walkthroughs.length || sourceId) return;
    const id = new URLSearchParams(window.location.search).get("walkthroughId");
    if (!id || !walkthroughs.some((item) => item.id === id)) return;
    const timer = window.setTimeout(() => {
      setMode("walkthrough");
      setSourceId(id);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [proposal, sourceId, walkthroughs]);
  const source =
    mode === "estimate"
      ? estimates.find((x) => x.id === sourceId)
      : walkthroughs.find((x) => x.id === sourceId);
  const estimate =
    mode === "estimate"
      ? (source as EstimateWithRelations | undefined)
      : (source as WalkthroughWithRelations | undefined)?.estimate;
  const walkthrough =
    mode === "walkthrough"
      ? (source as WalkthroughWithRelations | undefined)
      : undefined;
  const client = source?.client;
  const property = source?.property;
  const proposalDivision = source?.division ?? proposal?.division;
  const resolvedServiceName =
    serviceName ||
    walkthrough?.pricing_review?.serviceName ||
    walkthrough?.measurements.serviceType ||
    estimate?.service_name ||
    estimate?.result.serviceName ||
    (walkthrough
      ? `${walkthrough.division} Cleaning Proposal`
      : "Service Proposal");
  const postConstruction = /post[- ]construction/i.test(resolvedServiceName);
  const catalogService =
    services.find((item) => item.id === selectedServiceId) ??
    (proposalDivision
      ? findCatalogService(services, proposalDivision, resolvedServiceName)
      : undefined);
  const availableAddons =
    catalog && catalogService
      ? getAvailableServiceAddons(catalog, catalogService.id, proposalDivision)
      : [];
  const selectedAddonSnapshots = proposalAddonSnapshots(adjustments, availableAddons);
  const weeklyMixedSource = Boolean(estimate?.result.weeklyMixedVisits?.length || walkthrough?.pricing_review?.estimateResult.weeklyMixedVisits?.length || proposal?.result.weeklyMixedVisits?.length);
  const mixedWeeklyMode = frequency === "Multiple Days Per Week" && weeklyMixedVisits !== null;
  const matchingRules = (weeklyMixedSource || mixedWeeklyMode) ? [] : catalogService
    ? matchingRecurringRules(frequency, rules, catalogService.id)
    : [];
  const effectiveRuleId =
    selectedRuleId || (matchingRules.length === 1 ? matchingRules[0].id : "");
  const pricingRules =
    matchingRules.length > 1 && !effectiveRuleId ? [] : rules;
  const sourceEstimate =
    walkthrough?.pricing_review?.estimateResult ?? estimate?.result ?? null;
  const authoritativeEstimate =
    proposal && sourceEstimate
      ? withProposalRevisionBaseline(sourceEstimate, proposal.result)
      : sourceEstimate;
  const pricingEstimate =
    authoritativeEstimate &&
    catalogService &&
    (frequency !== authoritativeEstimate.calculatorInput.frequency ||
      resolvedServiceName !== authoritativeEstimate.serviceName ||
      effectiveRuleId !== (authoritativeEstimate.recurringPricingRuleId ?? "") ||
      (frequency === "Multiple Days Per Week" && JSON.stringify(serviceDaysOfWeek) !== JSON.stringify(authoritativeEstimate.calculatorInput.serviceDaysOfWeek ?? [])))
      ? repriceEstimateFrequency(
          authoritativeEstimate,
          frequency,
          pricingRules,
          catalogService.id,
          effectiveRuleId || null,
          null,
          serviceDaysOfWeek,
        )
      : authoritativeEstimate;
  useEffect(() => {
    if (!canViewProfitability) return;
    let active = true;
    void getProfitabilitySettings().then((settings) => { if (active) setProfitabilitySettings(settings); }).catch(() => { if (active) setProfitabilitySettings(null); });
    return () => { active = false; };
  }, [canViewProfitability]);
  useEffect(() => {
    if (!canViewProfitability) return;
    const proposalId = proposal?.id ?? null;
    const estimateId = proposalId ? null : estimate?.id ?? null;
    if (!proposalId && !estimateId) { void Promise.resolve().then(() => setSourceProfitability(null)); return; }
    let active = true;
    void getProfitabilityProjection({ proposalId, estimateId }).then((value) => { if (active) setSourceProfitability(value); }).catch(() => { if (active) setSourceProfitability(null); });
    return () => { active = false; };
  }, [canViewProfitability, estimate?.id, proposal?.id]);
  const calculatedResult = calculateProposal({
    estimate: pricingEstimate,
    catalogBasePrice: catalogService?.base_price,
    recurringRules: pricingRules,
    recurringPricingRuleId: effectiveRuleId || null,
    serviceId: catalogService?.id,
    serviceName: resolvedServiceName,
    serviceDescription: serviceName
      ? serviceDescription || null
      : walkthrough?.pricing_review?.serviceDescription ||
        walkthrough?.measurements.serviceDescription ||
        authoritativeEstimate?.serviceDescription ||
        null,
    frequency,
    serviceDaysOfWeek,
    estimatedCleaningDays: postConstruction ? estimatedCleaningDays : null,
    estimatedHoursPerDay: postConstruction ? estimatedHoursPerDay : null,
    adjustments,
    additionalLabor,
    additionalMaterials,
    laborHoursOverride,
    crewSizeOverride,
    manualDiscountPercent: discount,
    scope,
    terms,
  });
  const preserveStoredPrice = Boolean(
    proposal &&
      !mixedWeeklyMode &&
      preserveStoredPriceBaseline &&
      manualPrice === null &&
      pricingFingerprint === initialPricingFingerprint &&
      Math.round(proposal.result.perVisitTotal * 100) ===
        Math.round(calculatedResult.perVisitTotal * 100),
  );
  const pricedResult = preserveStoredPrice
    ? withPreservedProposalPrice(calculatedResult, proposal!.result.perVisitTotal, frequency)
    : withAuthoritativeProposalPrice(calculatedResult, mixedWeeklyMode ? null : manualPrice, frequency);
  const result = {
    ...(mixedWeeklyMode ? withProposalWeeklyVisitPrices(pricedResult, weeklyMixedVisits, serviceDaysOfWeek) : pricedResult),
    finalPriceAdjustmentLabel: adjustmentLabel.trim() || null,
  };
  const proposalProfitability = canViewProfitability && profitabilitySettings && sourceProfitability
    ? calculateProposalProfitability({ result, source: sourceProfitability, settings: profitabilitySettings, propertyAddress: property?.address ?? "" })
    : null;
  useEffect(() => {
    if (proposal || !sourceId) return;
    const selectedWalkthrough =
      mode === "walkthrough"
        ? walkthroughs.find((x) => x.id === sourceId)
        : undefined;
    const selectedEstimate =
      mode === "estimate"
        ? estimates.find((x) => x.id === sourceId)
        : selectedWalkthrough?.estimate;
    const approved = selectedWalkthrough?.pricing_review;
    const selectedSource = selectedWalkthrough ?? selectedEstimate;
    const inherited = [
      ...(approved?.scope ?? selectedEstimate?.result.scope ?? []),
      ...(selectedWalkthrough?.scope.map((x) => x.label) ?? []),
      ...(selectedWalkthrough?.recommendations.map((x) => x.text) ?? []),
    ];
    const unique = [...new Set(inherited.map((x) => x.trim()).filter(Boolean))];
    const inheritedServiceName =
      approved?.serviceName ||
      selectedWalkthrough?.measurements.serviceType ||
      selectedEstimate?.service_name ||
      selectedEstimate?.result.serviceName ||
      "";
    const inheritedDescription =
      approved?.serviceDescription ||
      selectedWalkthrough?.measurements.serviceDescription ||
      selectedEstimate?.result.serviceDescription ||
      "";
    const inheritedCatalogService = selectedSource
      ? findCatalogService(
          services,
          selectedSource.division,
          inheritedServiceName,
        )
      : undefined;
    const inheritedAddons =
      approved?.catalogAddons ??
      selectedWalkthrough?.measurements.catalogAddons ??
      selectedEstimate?.result.catalogAddons ??
      [];
    const approvedAdjustments =
      approved?.estimateResult.adjustments ??
      selectedEstimate?.result.adjustments ??
      [];
    const findings = [
      selectedWalkthrough?.notes,
      selectedWalkthrough?.measurements.damageObserved
        ? `Damage observed: ${selectedWalkthrough.measurements.damageObserved}`
        : "",
      selectedWalkthrough?.measurements.hazardsObserved
        ? `Hazards observed: ${selectedWalkthrough.measurements.hazardsObserved}`
        : "",
      selectedWalkthrough?.measurements.heavySoilBuildup
        ? "Heavy soil / buildup observed."
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    const timer = window.setTimeout(() => {
      setScope(unique.map((text, index) => ({ id: `source-${index}`, text })));
      setServiceName(inheritedServiceName);
      setSelectedServiceId(
        approved?.serviceId ?? inheritedCatalogService?.id ?? "",
      );
      setSelectedRuleId(
        approved?.estimateResult.recurringPricingRuleId ??
          selectedEstimate?.result.recurringPricingRuleId ??
          "",
      );
      setServiceDescription(
        inheritedDescription || inheritedCatalogService?.description || "",
      );
      setAdjustments((current) => [
        ...current.filter((item) => !item.catalogAddonId),
        ...inheritedAddons.map((addon) => ({
          id: addon.id,
          label: addon.name,
          amount:
            approvedAdjustments.find(
              (item) => item.catalogAddonId === addon.catalogAddonId,
            )?.amount ?? addon.lineTotal ?? (addon.quantity ?? 1) * (addon.unitPrice ?? addon.price),
          catalogAddonId: addon.catalogAddonId,
          description: addon.description,
          pricingModel: addon.pricingModel,
          unitLabel: addon.unitLabel,
          quantity: addon.quantity,
          unitName: addon.unitName,
          unitPrice: addon.unitPrice,
          inherited: true,
        })),
      ]);
      setFrequency(
        approved?.frequency ?? selectedEstimate?.frequency ?? "One-Time",
      );
      setServiceDaysOfWeek(approved?.estimateResult.calculatorInput.serviceDaysOfWeek ?? selectedEstimate?.result.calculatorInput.serviceDaysOfWeek ?? []);
      const incomingDays = approved?.estimateResult.calculatorInput.serviceDaysOfWeek ?? selectedEstimate?.result.calculatorInput.serviceDaysOfWeek ?? [];
      const incomingVisits = approved?.estimateResult.weeklyMixedVisits ?? selectedEstimate?.result.weeklyMixedVisits ?? recoverWeeklyVisitsFromScope(unique.map((text,index) => ({id: `source-${index}`,text})), incomingDays);
      setWeeklyMixedVisits(incomingVisits?.map(visit => ({ ...visit })) ?? null);
      setRequestedDate(
        selectedEstimate?.result.submission?.preferredServiceDate ?? "",
      );
      const duration = postConstructionDuration(
        approved?.estimateResult ?? selectedEstimate?.result,
      );
      setEstimatedCleaningDays(duration.days);
      setEstimatedHoursPerDay(duration.hoursPerDay);
      setNotes(findings);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [estimates, mode, proposal, services, sourceId, walkthroughs]);
  async function save() {
    if (!source || !client || !property)
      return setError("Select a saved Estimate or Walkthrough.");
    if (matchingRules.length > 1 && !effectiveRuleId)
      return setError("Select the recurring pricing rule for this Proposal.");
    if (frequency === "Multiple Days Per Week" && !validServiceWeekdays(serviceDaysOfWeek))
      return setError("Choose at least two distinct weekly service days before saving the proposal.");
    if (weeklyMixedSource && !mixedWeeklyMode)
      return setError("This source uses separate weekday prices. Keep the mixed-weekly pricing breakdown enabled.");
    if (mixedWeeklyMode) {
      if (discount !== 0 || additionalLabor !== 0 || additionalMaterials !== 0 || adjustments.length > 0)
        return setError("Set all mixed-weekly prices per weekday. Clear incompatible discounts, extra labor/material charges, and add-ons first.");
      try {
        const hourlyPay = (sourceEstimate?.calculatorInput as {workerHourlyPay?: number} | undefined)?.workerHourlyPay ?? 0;
        mixedVisitTotals(weeklyMixedVisits, serviceDaysOfWeek, hourlyPay);
      } catch (cause) {
        return setError(cause instanceof Error ? cause.message : "Complete the separate weekday prices and scopes.");
      }
    }
    if (!proposal && walkthrough && !walkthrough.pricing_review)
      return setError(
        "Review and approve Walkthrough pricing before creating the Proposal.",
      );
    if (
      postConstruction &&
      (!validDuration(estimatedCleaningDays, 365) ||
        !validDuration(estimatedHoursPerDay, 24, true))
    )
      return setError(
        "Estimated cleaning days must be greater than 0 and no more than 365; optional hours per day must be greater than 0 and no more than 24.",
      );
    setSaving(true);
    setError(null);
    const payload: ProposalInsert = {
      client_id: client.id,
      property_id: property.id,
      estimate_id: estimate?.id ?? null,
      walkthrough_id: walkthrough?.id ?? null,
      division: source.division,
      client_name: displayClient(client),
      property_name: property.address,
      customer_phone:
        estimate?.customer_phone ?? walkthrough?.phone ?? client.phone,
      customer_email:
        estimate?.customer_email ?? walkthrough?.email ?? client.email,
      frequency,
      requested_date: requestedDate || null,
      representative_name: representative || null,
      notes: notes || null,
      result,
      photos: [],
      signature: null,
      status: proposal?.status ?? "Draft",
      approval_status: proposal?.approval_status ?? "Not Submitted",
      approved_at: proposal?.approved_at ?? null,
      approved_by: proposal?.approved_by ?? null,
      approval_notes: proposal?.approval_notes ?? null,
      sent_at: proposal?.sent_at ?? null,
      sent_via: proposal?.sent_via ?? null,
      viewed_at: proposal?.viewed_at ?? null,
      accepted: proposal?.accepted ?? false,
      accepted_at: proposal?.accepted_at ?? null,
      accepted_by_name: proposal?.accepted_by_name ?? null,
      acceptance_method: proposal?.acceptance_method ?? null,
      declined_at: proposal?.declined_at ?? null,
      decline_reason: proposal?.decline_reason ?? null,
      expiration_date: expiration,
      expired_at: proposal?.expired_at ?? null,
    };
    try {
      if (proposal) {
        const { photos: omittedPhotos, ...updatePayload } = payload;
        void omittedPhotos;
        await updateProposal(proposal.id, updatePayload);
        if (proposalProfitability) await saveProfitabilityProjection({ proposalId: proposal.id, projection: proposalProfitability });
      } else {
        const created = await createProposal(payload);
        if (proposalProfitability) await saveProfitabilityProjection({ proposalId: created.id, projection: proposalProfitability });
        await getProposalPricingPhotos(created.id);
        if (walkthrough?.id) {
          await updateWalkthroughStatus(walkthrough.id, "Proposal Ready");
          setWalkthroughs(await getWalkthroughs());
        }
      }
      onSaved?.();
      if (!proposal) router.push("/open-proposals");
    } catch (x) {
      console.error("Proposal save failed", x);
      setError(msg(x, "Proposal could not be saved."));
    } finally {
      setSaving(false);
    }
  }
  function setCatalogAddons(names: string[]) {
    setAdjustments((current) => selectProposalCatalogAddons(current, names, availableAddons));
  }
  const list = (mode === "estimate" ? estimates : walkthroughs).filter(
    (x) =>
      !search || sourceText(x).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="space-y-6">
      {error && <Alert text={error} />}
      <Panel title="Load Source">
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-[#edf1eb] p-1.5">
          <Mode
            active={mode === "estimate"}
            text="Load Estimate"
            click={() => {
              setMode("estimate");
              setSourceId("");
            }}
          />
          <Mode
            active={mode === "walkthrough"}
            text="Load Walkthrough"
            click={() => {
              setMode("walkthrough");
              setSourceId("");
            }}
          />
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search saved records"
          className={`${input} mt-4`}
        />
        <select
          value={sourceId}
          onChange={(e) => setSourceId(e.target.value)}
          className={`${input} mt-2`}
          disabled={Boolean(proposal)}
        >
          <option value="">Select source</option>
          {list.map((x) => (
            <option key={x.id} value={x.id}>
              {sourceText(x)}
            </option>
          ))}
        </select>
      </Panel>
      {source && (
        <Panel title="Customer Information">
          <div className="grid gap-4 sm:grid-cols-4">
            <Info l="Client" v={client ? displayClient(client) : "—"} />
            <Info
              l="Phone"
              v={
                estimate?.customer_phone ??
                walkthrough?.phone ??
                client?.phone ??
                "—"
              }
            />
            <Info
              l="Email"
              v={
                estimate?.customer_email ??
                walkthrough?.email ??
                client?.email ??
                "—"
              }
            />
            <Info l="Property" v={property?.address ?? "—"} />
          </div>
        </Panel>
      )}
      <div className="grid gap-6 xl:grid-cols-[1.4fr_.7fr]">
        <div className="space-y-6">
          <Panel title="Service">
            <label>
              <Label t="Service Type" />
              <select
                className={input}
                value={catalogService?.id ?? ""}
                onChange={(e) => {
                  const selected = services.find(
                    (item) => item.id === e.target.value,
                  );
                  if (!selected) return;
                  const nextAddons = catalog
                    ? getAvailableServiceAddons(
                        catalog,
                        selected.id,
                        proposalDivision,
                      )
                    : [];
                  const validAddonIds = new Set(
                    nextAddons.map((addon) => addon.id),
                  );
                  setSelectedServiceId(selected.id);
                  setSelectedRuleId("");
                  setServiceName(selected.service_name);
                  setServiceDescription(selected.description?.trim() ?? "");
                  setAdjustments((current) =>
                    current.filter(
                      (item) =>
                        !item.catalogAddonId ||
                        validAddonIds.has(item.catalogAddonId),
                    ),
                  );
                }}
              >
                <option value="">Select service</option>
                {services
                  .filter(
                    (item) =>
                      !proposalDivision ||
                      item.division === proposalDivision ||
                      item.division === "Both",
                  )
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.service_name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="mt-4">
              <Label t="Service Description" />
              <div className="min-h-24 whitespace-pre-line rounded-lg border bg-neutral-50 p-3 text-sm text-neutral-700">
                {result.serviceDescription ||
                  "No service description available."}
              </div>
            </div>
            <div className="mt-5">
              <CatalogAddonPicker
                addons={availableAddons}
                selected={adjustments
                  .filter((item) => item.catalogAddonId)
                  .map((item) => item.label)}
                setSelected={setCatalogAddons}
                snapshots={selectedAddonSnapshots}
                setSnapshots={(snapshots) => setAdjustments((current) => replaceProposalCatalogAddons(current, snapshots, availableAddons))}
              />
            </div>
          </Panel>
          {postConstruction && (
            <Panel title="Estimated Cleaning Duration">
              <div className="grid gap-4 sm:grid-cols-2">
                <OptionalNum
                  l="Estimated Cleaning Days"
                  v={estimatedCleaningDays}
                  max={365}
                  set={setEstimatedCleaningDays}
                />
                <OptionalNum
                  l="Estimated Hours Per Day (optional)"
                  v={estimatedHoursPerDay}
                  max={24}
                  set={setEstimatedHoursPerDay}
                />
              </div>
              <p className="mt-3 text-sm text-neutral-600">
                This is an estimate. Actual timing may vary based on site
                readiness, access, construction conditions, and approved scope.
              </p>
            </Panel>
          )}
          {profile?.role!=="Sales"&&<Panel title="Labor Planning">
            <div className="grid gap-4 sm:grid-cols-2">
              <LaborPlanInput
                label="Crew Size"
                recommended={calculatedResult.recommendedCrewSize ?? calculatedResult.crewRecommendation}
                active={calculatedResult.crewRecommendation}
                override={crewSizeOverride}
                wholeNumber
                setOverride={setCrewSizeOverride}
              />
              <LaborPlanInput
                label="Labor Hours"
                recommended={calculatedResult.recommendedLaborHours ?? calculatedResult.laborHours}
                active={calculatedResult.laborHours}
                override={laborHoursOverride}
                setOverride={setLaborHoursOverride}
              />
            </div>
            <p className="mt-3 text-sm text-neutral-600">
              Labor Hours are total crew labor hours. Duration is calculated as total labor hours divided by crew size.
            </p>
          </Panel>}
          <Panel title="Proposal Adjustments">
            <div className="grid gap-4 sm:grid-cols-3">
              {profile?.role!=="Sales"&&<Num
                l="Additional Labor"
                v={additionalLabor}
                set={setAdditionalLabor}
              />}
              {profile?.role!=="Sales"&&<Num
                l="Additional Materials"
                v={additionalMaterials}
                set={setAdditionalMaterials}
              />}
              <Num l="Manual Discount %" v={discount} set={setDiscount} />
              {!mixedWeeklyMode && (!canViewProfitability || !proposalProfitability || profile?.role === "Sales") ? <label>
                <Label t="Manual / Custom Final Price" />
                <span className="relative block">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-bold text-neutral-500">
                    $
                  </span>
                  <input
                    aria-label="Manual or custom proposal price"
                    type="number"
                    min="0"
                    step="0.01"
                    value={manualPrice ?? ""}
                    placeholder={String(calculatedResult.perVisitTotal)}
                    onChange={(event) => {
                      setPreserveStoredPriceBaseline(false);
                      setManualPrice(
                        event.target.value === ""
                          ? null
                          : Number(event.target.value),
                      );
                    }}
                    className={`${input} pl-7`}
                  />
                </span>
                <button
                  type="button"
                  disabled={manualPrice === null && !preserveStoredPrice}
                  onClick={() => {
                    setPreserveStoredPriceBaseline(false);
                    setManualPrice(null);
                  }}
                  className="mt-2 text-xs font-bold text-[#9a7a17] disabled:opacity-40"
                >
                  Use Calculated Price
                </button>
              </label> : <p className="col-span-full rounded-lg bg-[#f6faf4] px-3 py-2 text-xs text-[#143d1a]">Separate weekday visit prices are authoritative. Weekly total: {new Intl.NumberFormat("en-US", {style:"currency",currency:"USD"}).format(result.weeklyContractTotal ?? 0)}. No uniform per-visit price is applied.</p>}
              {!mixedWeeklyMode && (manualPrice !== null || Boolean(proposal?.result.finalPriceAdjustmentLabel)) && <label className="col-span-full">
                <Label t="Final Price Adjustment Label (customer-facing)" />
                <input type="text" maxLength={90} value={adjustmentLabel} onChange={event => setAdjustmentLabel(event.target.value)} placeholder="Final Price Adjustment" className={input} />
                <p className="mt-1 text-xs text-neutral-500">For example: Property Condition &amp; Additional Labor Adjustment. Leave blank to use the standard label.</p>
              </label>}
              <Select
                l="Frequency"
                v={frequency}
                set={(v) => {
                  setFrequency(v as Frequency);
                  setSelectedRuleId("");
                }}
                opts={[
                  "One-Time",
                  "Weekly",
                  "Biweekly",
                  "Twice Monthly",
                  "Monthly",
                  "Multiple Days Per Week",
                  ...(frequency === "Custom" ? ["Custom"] : []),
                ]}
              />
              {frequency === "Multiple Days Per Week" && <WeeklyServiceDaysField value={serviceDaysOfWeek} onChange={days => {
                setServiceDaysOfWeek(days);
                setWeeklyMixedVisits(current => current === null ? null : days.map(day => current.find(visit => visit.day === day) ?? newWeeklyVisit(day)));
              }} />}
              {frequency === "Multiple Days Per Week" && <label className="col-span-full mt-2 flex items-center gap-2 rounded-lg border border-[#143d1a]/20 bg-[#f6faf4] px-3 py-2 text-sm font-bold text-[#143d1a]">
                <input type="checkbox" checked={mixedWeeklyMode} disabled={weeklyMixedSource} onChange={event => {
                  if (event.target.checked) {
                    setWeeklyMixedVisits(serviceDaysOfWeek.map(day => weeklyMixedVisits?.find(visit => visit.day === day) ?? newWeeklyVisit(day)));
                    setManualPrice(null);
                    setPreserveStoredPriceBaseline(false);
                    setDiscount(0);
                    setAdditionalLabor(0);
                    setAdditionalMaterials(0);
                    setAdjustments([]);
                  } else setWeeklyMixedVisits(null);
                }}/>
                Different service scope and price for each weekday
              </label>}
              {mixedWeeklyMode && <WeeklyMixedScopeCalculator days={serviceDaysOfWeek} visits={weeklyMixedVisits} onChange={setWeeklyMixedVisits} />}
              {matchingRules.length > 0 && (
                <Select
                  l="Pricing Rule"
                  v={
                    selectedRuleId ||
                    (matchingRules.length === 1 ? matchingRules[0].id : "")
                  }
                  set={setSelectedRuleId}
                  opts={matchingRules.map((rule) => rule.id)}
                  labels={
                    new Map(
                      matchingRules.map((rule) => [
                        rule.id,
                        rule.rule_name ?? `${rule.frequency} rule (historical)`,
                      ]),
                    )
                  }
                />
              )}
              <Text
                l="Requested Service Date"
                type="date"
                v={requestedDate}
                set={setRequestedDate}
              />
              <Text
                l="Representative"
                v={representative}
                set={setRepresentative}
              />
              <Text
                l="Expiration Date"
                type="date"
                v={expiration}
                set={setExpiration}
              />
            </div>
            <AdjustmentEditor
              items={adjustments.filter((item) => !item.catalogAddonId)}
              set={(manual) =>
                setAdjustments((current) => [
                  ...current.filter((item) => item.catalogAddonId),
                  ...manual,
                ])
              }
            />
          </Panel>
          <ScopeEditor items={scope} set={setScope} />
          <Panel title="Terms / Conditions">
            <div className="grid gap-4 sm:grid-cols-2">
              {Object.entries(terms).map(([k, v]) => (
                <label key={k}>
                  <Label t={human(k)} />
                  <textarea
                    value={v}
                    onChange={(e) =>
                      setTerms({ ...terms, [k]: e.target.value })
                    }
                    className={input}
                    rows={3}
                  />
                </label>
              ))}
            </div>
          </Panel>
          <Panel title="Proposal Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={input}
              rows={4}
            />
          </Panel>
          {walkthrough ? (
            <PhotoUploader
              recordType="walkthroughs"
              recordId={walkthrough.id}
              categories={[
                "General",
                "Exterior",
                "Interior",
                "Kitchen",
                "Bathroom",
                "Flooring",
                "Damage / Concern",
                "Other",
              ]}
              readonly={!canManagePricingPhotos}
              canDelete={false}
              title="Walkthrough / Pricing Photos"
              cameraLabel="Take Pricing Photo"
              libraryLabel="Upload Pricing Photos"
              uploadLabel="Upload Photos"
            />
          ) : (
            <Panel title="Proposal Photos / Attachments">
              <p className="rounded-xl border border-dashed border-[#143d1a]/20 p-8 text-center text-sm text-neutral-500">
                Proposal review photos are available when this Proposal is
                linked to a Walkthrough. Estimate-only Proposals remain
                unchanged.
              </p>
            </Panel>
          )}
        </div>
        <Summary
          r={result}
          saving={saving}
          save={save}
          editing={Boolean(proposal)}
        />
        {canViewProfitability && proposalProfitability && <ProfitabilityPanel
          projection={proposalProfitability}
          priceEditable
          projectPrice={!mixedWeeklyMode ? {
            manualPrice,
            calculatedPrice: result.calculatedPerVisitTotal ?? result.perVisitTotal,
            title: "Proposal Price",
            artifactLabel: "proposal",
            unitLabel: frequency === "One-Time" ? "full project" : "per visit",
            canApplyMinimum: frequency === "One-Time" && result.weeklyContractTotal == null && !result.upkeepPlan,
            minimumUnavailableReason: "The recommended minimum covers a multi-visit contract. It cannot safely replace a single per-visit price; review each visit's amount instead.",
            onChange: (amount: number | null) => {
              setPreserveStoredPriceBaseline(false);
              setManualPrice(amount);
            },
          } : undefined}
        />}
      </div>
    </div>
  );
}
function AdjustmentEditor({
  items,
  set,
}: {
  items: ProposalAdjustment[];
  set: (x: ProposalAdjustment[]) => void;
}) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState(0);
  return (
    <div className="mt-5">
      <Label t="Custom Add-Ons" />
      <div className="flex gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Add-on name"
          className={input}
        />
        <div className="relative max-w-32">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-bold text-neutral-500">
            $
          </span>
          <input
            aria-label="Custom add-on amount in dollars"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            className={`${input} pl-7`}
          />
        </div>
        <button
          type="button"
          onClick={() => {
            if (label.trim())
              set([
                ...items,
                { id: crypto.randomUUID(), label: label.trim(), amount },
              ]);
            setLabel("");
            setAmount(0);
          }}
          className={secondary}
        >
          Add Add-On
        </button>
      </div>
      <Items
        items={items.map((x) => ({
          id: x.id,
          text: `${x.label} — ${money(x.amount)}`,
        }))}
        remove={(id) => set(items.filter((x) => x.id !== id))}
      />
    </div>
  );
}
function ScopeEditor({
  items,
  set,
}: {
  items: ProposalScopeItem[];
  set: (x: ProposalScopeItem[]) => void;
}) {
  const [text, setText] = useState("");
  return (
    <Panel title="Included Services / Cleaning Specifications">
      <p className="mb-3 text-sm text-neutral-500">
        Use this only for included contractual details beyond the Service
        Description. Purchased extras belong under Add-Ons.
      </p>
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          className={input}
          placeholder="Add included service or specification"
        />
        <button
          type="button"
          onClick={() => {
            if (text.trim())
              set([...items, { id: crypto.randomUUID(), text: text.trim() }]);
            setText("");
          }}
          className={secondary}
        >
          Add Included Item
        </button>
      </div>
      <div className="mt-3 space-y-2">
        {items.map((x) => (
          <div key={x.id} className="flex gap-2">
            <input
              value={x.text}
              onChange={(e) =>
                set(
                  items.map((i) =>
                    i.id === x.id ? { ...i, text: e.target.value } : i,
                  ),
                )
              }
              className={input}
            />
            <button
              type="button"
              onClick={() => set(items.filter((i) => i.id !== x.id))}
              className={secondary}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </Panel>
  );
}
function Summary({
  r,
  saving,
  save,
  editing,
}: {
  r: ReturnType<typeof calculateProposal>;
  saving: boolean;
  save: () => Promise<void>;
  editing: boolean;
}) {
  const { profile } = useAuth();
  const purchasedAddonTotal = r.adjustments
    .filter((item) => Boolean(item.catalogAddonId))
    .reduce((sum, item) => sum + item.amount, 0);
  const customServiceAdjustments = r.adjustments
    .filter((item) => !item.catalogAddonId)
    .reduce((sum, item) => sum + item.amount, 0) + r.additionalLabor + r.additionalMaterials;
  const mixed = r.weeklyMixedVisits?.length ? r.weeklyMixedVisits : null;
  const discountedService = Math.max(
    0,
    r.baseEstimateAmount + customServiceAdjustments -
      (r.frequencyDiscount ?? 0) - (r.inheritedManualDiscount ?? 0) - r.manualDiscount,
  );
  return (
    <aside className="sticky top-6 rounded-2xl bg-[#143d1a] p-6 text-white">
      <p className="text-xs font-bold uppercase tracking-widest text-[#d4af37]">
        Proposal Summary
      </p>
      <h2 className="mt-2 text-xl font-extrabold">{r.serviceName}</h2>
      <div className="mt-4 rounded-lg bg-white/10 p-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[#d4af37]">
          Service Description
        </p>
        <p className="mt-1 whitespace-pre-line text-sm text-white/80">
          {r.serviceDescription || "No service description available."}
        </p>
      </div>
      <dl className="mt-5 divide-y divide-white/10">
        {[
          ...(mixed ? [...mixed.map(v => [["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][v.day]+" — "+v.serviceLevel, money(v.price)]), ["Weekly Contract Total",money(r.weeklyContractTotal??0)],["Average Monthly Contract",money(r.monthlyTotal??0)]] : [
          ["Base Service Price", money(r.baseEstimateAmount)],
          [
            "Custom Service Adjustments",
            money(customServiceAdjustments),
          ],
          ["Recurring Discount %", `${r.frequencyDiscountPercent ?? 0}%`],
          ["Recurring Discount", `-${money(r.frequencyDiscount ?? 0)}`],
          [
            "Inherited Manual Discount",
            `-${money(r.inheritedManualDiscount ?? 0)}`,
          ],
          ["Proposal Manual Discount", `-${money(r.manualDiscount)}`],
          ["Discounted Service", money(discountedService)],
          ...r.adjustments
            .filter((x) => x.catalogAddonId)
            .map((x) => [`Add-On: ${x.label}`, money(x.amount)]),
          ["Subtotal", money(discountedService + purchasedAddonTotal)],
          ...(r.taxes > 0 ? [["Taxes", money(r.taxes)]] : []),
          ...(r.manualPerVisitTotal != null
            ? [[
                r.finalPriceAdjustmentLabel?.trim() || "Manual Final Price Adjustment",
                money(r.perVisitTotal - (r.calculatedPerVisitTotal ?? r.perVisitTotal)),
              ]]
            : []),
          ["Final Per Visit", money(r.perVisitTotal)],
          [
            "Estimated Monthly",
            r.monthlyTotal !== null ? money(r.monthlyTotal) : "—",
          ],
          ]),
          ...(profile?.role==="Sales"?[]:[
            ["Labor Hours", String(r.laborHours)],
            ["Crew", String(r.crewRecommendation)],
            ["Duration", `${r.estimatedDuration} hrs`],
            ["Profit", money(r.estimatedProfit)],
          ]),
        ].map(([a, b]) => (
          <div key={a} className="flex justify-between py-3 text-sm">
            <dt className="text-white/60">{a}</dt>
            <dd className="font-bold">{b}</dd>
          </div>
        ))}
      </dl>
      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="mt-5 w-full rounded-lg bg-[#d4af37] py-3 font-extrabold text-[#143d1a] disabled:opacity-60"
      >
        {saving ? "Saving…" : editing ? "Save Changes" : "Save Proposal"}
      </button>
    </aside>
  );
}
function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[#143d1a]/10 bg-white p-6 shadow-sm">
      <h2 className="font-extrabold text-[#143d1a]">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}
function Mode({
  active,
  text,
  click,
}: {
  active: boolean;
  text: string;
  click: () => void;
}) {
  return (
    <button
      type="button"
      onClick={click}
      className={`rounded-lg p-3 text-sm font-bold ${active ? "bg-white text-[#143d1a] shadow" : "text-neutral-500"}`}
    >
      {text}
    </button>
  );
}
function Info({ l, v }: { l: string; v: string }) {
  return (
    <div>
      <p className="text-xs uppercase text-neutral-400">{l}</p>
      <p className="mt-1 text-sm font-bold text-neutral-700">{v}</p>
    </div>
  );
}
function Label({ t }: { t: string }) {
  return (
    <span className="mb-2 block text-xs font-bold text-neutral-700">{t}</span>
  );
}
function Text({
  l,
  v,
  set,
  type = "text",
}: {
  l: string;
  v: string;
  set: (x: string) => void;
  type?: string;
}) {
  return (
    <label>
      <Label t={l} />
      <input
        type={type}
        value={v}
        onChange={(e) => set(e.target.value)}
        className={input}
      />
    </label>
  );
}
function Num({
  l,
  v,
  set,
}: {
  l: string;
  v: number;
  set: (x: number) => void;
}) {
  const currency = l === "Additional Labor" || l === "Additional Materials";
  return (
    <label>
      <Label t={l} />
      <span className="relative block">
        {currency && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-bold text-neutral-500">
            $
          </span>
        )}
        <input
          type="number"
          min="0"
          step="0.01"
          value={v}
          onChange={(e) => set(Number(e.target.value))}
          className={`${input} ${currency ? "pl-7" : ""}`}
        />
      </span>
    </label>
  );
}
function LaborPlanInput({
  label,
  recommended,
  active,
  override,
  wholeNumber = false,
  setOverride,
}: {
  label: string;
  recommended: number;
  active: number;
  override: number | null;
  wholeNumber?: boolean;
  setOverride: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState(String(active));
  const [validation, setValidation] = useState<string | null>(null);
  useEffect(() => { queueMicrotask(() => setDraft(String(active))); }, [active]);
  return (
    <label>
      <Label t={label} />
      <span className="mb-2 block text-xs text-neutral-500">
        Recommended: {recommended}
      </span>
      <span className="block text-xs font-bold text-neutral-600">Active / Planned</span>
      <input
        aria-label={`Active planned ${label}`}
        type="number"
        min={wholeNumber ? 1 : 0.1}
        step={wholeNumber ? 1 : 0.1}
        value={draft}
        onChange={(event) => {
          const nextDraft = event.target.value;
          setDraft(nextDraft);
          const next = Number(nextDraft);
          const invalid = nextDraft === "" || !Number.isFinite(next) || next <= 0 || (wholeNumber && !Number.isInteger(next));
          if (invalid) {
            setValidation(wholeNumber ? "Crew Size must be a positive whole number." : "Labor Hours must be greater than 0.");
            return;
          }
          setValidation(null);
          setOverride(next);
        }}
        className={`${input} mt-1`}
      />
      {validation && <span className="mt-1 block text-xs font-semibold text-red-700">{validation}</span>}
      <button
        type="button"
        disabled={override === null}
        onClick={() => {
          setValidation(null);
          setOverride(null);
        }}
        className="mt-2 text-xs font-bold text-[#9a7a17] disabled:opacity-40"
      >
        Reset to Recommended
      </button>
    </label>
  );
}
function OptionalNum({
  l,
  v,
  max,
  set,
}: {
  l: string;
  v: number | null;
  max: number;
  set: (v: number | null) => void;
}) {
  return (
    <label>
      <Label t={l} />
      <input
        type="number"
        min="0.1"
        max={max}
        step="0.1"
        value={v ?? ""}
        onChange={(event) =>
          set(event.target.value === "" ? null : Number(event.target.value))
        }
        className={input}
      />
    </label>
  );
}
function Select({
  l,
  v,
  set,
  opts,
  labels,
}: {
  l: string;
  v: string;
  set: (x: string) => void;
  opts: string[];
  labels?: ReadonlyMap<string, string>;
}) {
  const choices =
    l === "Frequency" && !opts.includes("Daily")
      ? [opts[0], "Daily", ...opts.slice(1)]
      : opts;
  return (
    <label>
      <Label t={l} />
      <select value={v} onChange={(e) => set(e.target.value)} className={input}>
        {l === "Pricing Rule" && <option value="">Select pricing rule</option>}
        {choices.map((x) => (
          <option key={x} value={x}>
            {labels?.get(x) ??
              (l === "Frequency" ? serviceFrequencyLabel(x) : x)}
          </option>
        ))}
      </select>
    </label>
  );
}
function Items({
  items,
  remove,
}: {
  items: { id: string; text: string }[];
  remove: (id: string) => void;
}) {
  return (
    <ul className="mt-3 space-y-2">
      {items.map((x) => (
        <li
          key={x.id}
          className="flex justify-between rounded-lg bg-neutral-50 p-3 text-sm"
        >
          <span>{x.text}</span>
          <button type="button" onClick={() => remove(x.id)}>
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}
function Alert({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
      {text}
    </div>
  );
}
function sourceText(x: EstimateWithRelations | WalkthroughWithRelations) {
  return "estimate_number" in x
    ? `${x.estimate_number} — ${displayClient(x.client)} — ${x.property?.address || "Deleted Property"} — ${money(x.result.finalPrice)}`
    : `${displayClient(x.client)} — ${x.property?.address || "Deleted Property"} — ${x.walkthrough_date ?? "Unscheduled"} — ${x.status}${x.estimate ? ` — ${x.estimate.estimate_number}` : ""}`;
}
function displayClient(
  c: {
    first_name: string | null;
    last_name: string | null;
    company_name: string | null;
  } | null,
) {
  return c
    ? [c.first_name, c.last_name].filter(Boolean).join(" ") ||
        c.company_name ||
        "Unnamed client"
    : "Deleted Client";
}
function money(v: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(v);
}
function plusDays(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function human(k: string) {
  return k.replace(/([A-Z])/g, " $1").replace(/^./, (x) => x.toUpperCase());
}
function postConstructionDuration(result: EstimateResult | null | undefined) {
  const input = result?.calculatorInput as unknown as Record<string, unknown> | undefined;
  if (!input || input.calculatorType !== "Post-Construction")
    return { days: null, hoursPerDay: null };
  const project = input.projectCosting as Record<string, unknown> | undefined;
  return {
    days: numeric(project?.plannedProjectDays ?? input.targetProjectDays),
    hoursPerDay: numeric(project?.workdayHours ?? input.workdayHours),
  };
}
function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function validDuration(value: number | null, max: number, optional = false) {
  return value === null
    ? optional
    : Number.isFinite(value) && value > 0 && value <= max;
}
function msg(x: unknown, f: string) {
  // Supabase/PostgREST errors are plain objects, not Error instances.
  // Preserve the actionable error for administrators without surfacing credentials.
  const detail = x instanceof Error ? x.message
    : x && typeof x === "object" && "message" in x && typeof x.message === "string"
      ? x.message : "";
  return detail && !/jwt|auth(?:orization)? header|access[_ -]?token|service[_ -]?role|secret|api[_ -]?key/i.test(detail)
    ? detail : f;
}
function calculateProposalProfitability({ result, source, settings, propertyAddress }: { result: ProposalResult; source: ProfitabilityProjection; settings: ProfitabilitySettings; propertyAddress: string }) {
  const destination = propertyAddress.trim();
  const travel: TravelProjection = source.travel.destination.trim().toLowerCase() === destination.toLowerCase()
    ? source.travel
    : { origin: settings.travelOrigin, destination, verification: "Unverified", provider: null, roundTripMiles: null, roundTripMinutes: null, vehicleCount: settings.defaultVehiclesPerJob, travelingEmployeeCount: Math.max(1, result.crewRecommendation), companyRequiredTravelIsCompensable: settings.companyRequiredTravelIsCompensable, warning: "The service property changed; recalculate travel before relying on margin.", calculatedAt: null };
  const crewSize = Math.max(1, result.crewRecommendation);
  return calculateProfitability({
    price: result.weeklyContractTotal ?? result.perVisitTotal,
    cleanerCount: crewSize,
    hoursPerCleaner: result.laborHours / crewSize,
    hourlyWage: source.hourlyWage,
    settings,
    travel: { ...travel, travelingEmployeeCount: crewSize },
    supplies: (source.directCosts.supplies / Math.max(1, source.visitsPerPeriod ?? 1)) + result.additionalMaterials,
    projectDays: source.projectDays,
    roundTripsPerPeriod: source.roundTripsPerPeriod ?? source.projectDays,
    visitsPerPeriod: result.upkeepPlan?.visitsIncluded ?? (result.weeklyContractTotal != null
      ? Math.max(1, result.weeklyMixedVisits?.length || result.serviceDaysOfWeek?.length || source.visitsPerPeriod || 1)
      : 1),
    equipment: source.directCosts.equipment,
    subcontractors: source.directCosts.subcontractors,
    otherDirectExpenses: source.directCosts.other,
    setupLabor: source.directCosts.setupLabor ?? 0,
    ownerLabor: source.directCosts.ownerLabor ?? 0,
    parkingTolls: source.directCosts.parkingTolls ?? 0,
    disposal: source.directCosts.disposal ?? 0,
    paymentProcessingFees: source.operatingCosts?.paymentProcessingFees ?? 0,
    salesCommissions: source.operatingCosts?.salesCommissions ?? 0,
    allocatedOverhead: source.operatingCosts?.allocatedOverhead ?? 0,
    legacyTravelLogisticsCost: source.directCosts.legacyTravelLogistics,
    legacyProjectCosts: source.directCosts.legacyProjectCosts ?? 0,
    legacyTravelIncludesDriving: source.legacyTravelIncludesDriving ?? false,
    periodLabel: source.projectDays != null ? "Full post-construction project" : result.upkeepPlan ? "Monthly upkeep package" : result.weeklyContractTotal != null ? "Weekly contract period" : "Per service visit",
  });
}
const input =
  "w-full rounded-lg border border-neutral-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-[#d4af37] focus:ring-2 focus:ring-[#d4af37]/15";
const secondary =
  "rounded-lg border border-neutral-200 bg-white px-4 py-2.5 text-sm font-bold text-neutral-600";
