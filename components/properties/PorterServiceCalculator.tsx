"use client";

import { useState } from "react";
import { calculatePorterService } from "@/lib/pricing/porterService";
import type { PorterServicePricingInput, PorterServicePricingSnapshot } from "@/types/propertyServicePlan";

const fields = [
  ["laborHoursPerVisit", "Labor hours per visit", ""],
  ["porterHourlyPay", "Porter hourly pay", ""],
  ["billedHourlyRate", "Billed hourly rate", "40"],
  ["suppliesMonthly", "Supplies monthly", "0"],
  ["travelMonthly", "Travel monthly", "0"],
  ["supervisionAdminMonthly", "Supervision/Admin monthly", "0"],
  ["complexityAdjustmentMonthly", "Property complexity adjustment monthly", "0"],
  ["manualMonthlyPriceOverride", "Manual monthly price override (optional)", ""],
] as const;

const fieldClass =
  "mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900";

const currency = (value: number) =>
  value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });

export function PorterServiceCalculator({
  snapshot,
  visitsPerWeek,
  onUse,
  serviceMode = "Property Porter Services",
}: {
  serviceMode?: "Property Porter Services" | "Luxury Property Care";
  snapshot?: PorterServicePricingSnapshot | null;
  visitsPerWeek: number;
  onUse: (snapshot: PorterServicePricingSnapshot) => void;
}) {
  const luxury = serviceMode === "Luxury Property Care";

  const [values, setValues] = useState(
    () =>
      Object.fromEntries(
        fields.map(([key, , fallback]) => [
          key,
          snapshot?.inputs[key] === undefined
            ? fallback
            : String(snapshot.inputs[key]),
        ])
      ) as Record<(typeof fields)[number][0], string>
  );

  const inputs = { visitsPerWeek } as PorterServicePricingInput;

  for (const [key] of fields) {
    const value = values[key].trim();

    if (key === "manualMonthlyPriceOverride") {
      if (value) inputs[key] = Number(value);
    } else {
      inputs[key] = value ? Number(value) : NaN;
    }
  }

  let result: PorterServicePricingSnapshot | null = null;
  let error = "";

  try {
    if (visitsPerWeek === 0) {
      error = "Select service days above to calculate pricing.";
    } else if (
      !Number.isFinite(inputs.laborHoursPerVisit) ||
      inputs.laborHoursPerVisit <= 0
    ) {
      error = luxury
        ? "Enter labor hours per visit to calculate recurring property-care pricing."
        : "Enter labor hours per visit to calculate porter pricing.";
    } else {
      result = calculatePorterService(
        inputs,
        snapshot?.calculatedAt ?? "2000-01-01T00:00:00.000Z"
      );
    }
  } catch (cause) {
    error =
      cause instanceof Error ? cause.message : "Check calculator inputs.";
  }

  const applied = Boolean(
    result &&
      snapshot &&
      snapshot.inputs.visitsPerWeek === visitsPerWeek &&
      fields.every(([key]) => snapshot.inputs[key] === inputs[key])
  );

  const rows = result
    ? [
        [
          luxury ? "Monthly property-care hours" : "Monthly porter hours",
          result.monthlyHours.toLocaleString("en-US", {
            maximumFractionDigits: 2,
          }),
        ],
        ["Base monthly price", currency(result.baseMonthlyPrice)],
        ["Recommended monthly price", currency(result.recommendedMonthlyPrice)],
        ["Approved monthly price", currency(result.approvedMonthlyPrice)],
        ["Monthly labor cost", currency(result.monthlyLaborCost)],
        ["Monthly operating costs", currency(result.monthlyOperatingCosts)],
        ["Projected gross profit", currency(result.projectedGrossProfit)],
        [
          "Projected gross margin",
          `${result.projectedGrossMarginPercent.toFixed(2)}%`,
        ],
      ]
    : [];

  return (
    <section className="rounded-xl border border-[#143d1a]/20 bg-[#f4f7f1] p-4 sm:p-5">
      <h3 className="text-lg font-extrabold text-[#143d1a]">
        {luxury
          ? "Luxury Property Care Calculator"
          : "Porter Service Calculator"}
      </h3>

      {luxury && (
        <p className="mt-2 text-sm text-neutral-600">
          Plan recurring private residence and estate support: light upkeep,
          property checks, restocking, package coordination, vendor access
          coordination, pre-arrival preparation, and documentation/reporting.
          Confirm privacy, discretion, access instructions, and authorized
          photography with the client. Specialty projects are priced
          separately. This is a monthly contract amount, not a per-visit
          proposal price.
        </p>
      )}

      <p className="mt-1 text-sm text-neutral-600">
        {luxury
          ? "Recurring property-care pricing is based on scheduled coverage, labor, operating costs, and plan adjustments. Specialty work is separately priced and excluded from this base monthly plan."
          : "Billed porter rates typically start around $40–$45/hour. Specialty work is separately priced and excluded from this base monthly plan."}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm font-bold">
          Visits per week
          <input
            readOnly
            className={fieldClass}
            value={visitsPerWeek}
          />
          <span className="text-xs font-normal text-neutral-500">
            From selected service days.
          </span>
        </label>

        {fields.map(([key, label]) => (
          <label key={key} className="text-sm font-bold">
            {luxury && key === "porterHourlyPay"
              ? "Property-care hourly pay"
              : label}
            <input
              inputMode="decimal"
              className={fieldClass}
              value={values[key]}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  [key]: event.target.value,
                }))
              }
            />
          </label>
        ))}
      </div>

      {error && (
        <p className="mt-3 text-sm text-amber-800" role="status">
          {error}
        </p>
      )}

      {result && (
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {rows.map(([label, value]) => (
            <div key={label} className="rounded-lg bg-white p-3">
              <dt className="text-xs text-neutral-600">{label}</dt>
              <dd className="mt-1 font-bold text-[#143d1a]">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!result}
          className="rounded-lg bg-[#143d1a] px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => {
            if (result) {
              onUse(
                calculatePorterService(inputs, new Date().toISOString())
              );
            }
          }}
        >
          Use Pricing
        </button>

        <p className="text-sm text-neutral-600" role="status">
          {applied
            ? "Pricing is in this draft. Save Plan to persist it."
            : "Use Pricing to apply these values, then Save Plan."}
        </p>
      </div>

      {snapshot && !applied && (
        <p className="mt-2 text-sm text-amber-800">
          The draft still holds the previously applied price of{" "}
          {currency(snapshot.approvedMonthlyPrice)}. Calculator edits are not
          applied automatically.
        </p>
      )}
    </section>
  );
}