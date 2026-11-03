import type { CommercialCalculatorInput } from "@/types/estimate";
import type { CatalogService } from "@/types/serviceCatalog";
import { productionRateForCondition } from "@/lib/pricing/estimates";

/**
 * Internal commercial labor explanation. Uses the same service catalog condition
 * rate as the actual estimator; never guesses a client-facing rate.
 */
export function CommercialLaborInsights({
  input,
  service,
  laborHours,
  crewSize,
}: {
  input: CommercialCalculatorInput;
  service: CatalogService;
  laborHours: number;
  crewSize: number;
}) {
  if (
    service.service_code === "COM-HIGH-DUST" ||
    input.weeklyMixedVisits !== undefined ||
    !(input.squareFeet > 0) ||
    !(laborHours > 0) ||
    !(crewSize > 0)
  ) return null;

  const productionRate = productionRateForCondition(
    service,
    input.condition,
    Number(service.pricing_config.production_rate) || 0,
  );
  if (!Number.isFinite(productionRate) || productionRate <= 0) return null;

  const format = (n: number) =>
    new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(n);
  const coverageHours = input.squareFeet / productionRate;

  return (
    <section aria-label="Commercial labor estimate explanation" className="rounded-xl border border-[#143d1a]/15 bg-white p-4 text-[#143d1a]">
      <h3 className="text-sm font-extrabold">Estimated labor workload — {input.condition} cleaning</h3>
      <p className="mt-1 text-xs text-neutral-600">
        Higher production rate means more square feet cleaned per employee-hour, so light cleaning generally requires fewer hours than heavy cleaning.
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-neutral-600">Production rate</dt><dd className="font-extrabold">{format(productionRate)} sq. ft./labor hr</dd></div>
        <div><dt className="text-xs text-neutral-600">Floor-area labor</dt><dd className="font-extrabold">{format(coverageHours)} labor hrs</dd></div>
        <div><dt className="text-xs text-neutral-600">Total planned labor</dt><dd className="font-extrabold">{format(laborHours)} labor hrs</dd></div>
        <div><dt className="text-xs text-neutral-600">Crew / time per cleaner</dt><dd className="font-extrabold">{format(crewSize)} / {format(laborHours / crewSize)} hrs</dd></div>
      </dl>
      <p className="mt-3 text-xs text-neutral-600">
        Total labor also includes fixture and add-on time, plus any minimum completion-hour requirement. These are planning estimates, not verified job times.
      </p>
    </section>
  );
}
