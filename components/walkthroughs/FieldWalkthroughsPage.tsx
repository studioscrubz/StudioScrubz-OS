"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { canPerformScheduledWalkthrough, getAssignedFieldWalkthroughs, saveAssignedFieldWalkthrough } from "@/lib/services/fieldWalkthroughs";
import { createPhotoSignedUrls, getOperationalPhotos, uploadOperationalPhoto } from "@/lib/services/photoStorage";
import { fieldTextKeys, fieldNumberKeys, type FieldMeasurements, type FieldWalkthrough } from "@/types/fieldWalkthrough";
import type { OperationalPhotoWithUrl } from "@/types/photo";
import type { WalkthroughPhotoCategory } from "@/types/photo";
import { PostConstructionFieldWalkthrough, postConstructionCompletionIssues } from "@/components/walkthroughs/PostConstructionFieldWalkthrough";
import { isStandardResidentialService, StandardResidentialFieldWalkthrough, standardResidentialCompletionIssues } from "@/components/walkthroughs/StandardResidentialFieldWalkthrough";
import { DeepCleaningFieldWalkthrough, deepCleaningCompletionIssues, isDeepCleaningService } from "@/components/walkthroughs/DeepCleaningFieldWalkthrough";
import { isMoveInOutService, MoveInOutFieldWalkthrough, moveInOutCompletionIssues } from "@/components/walkthroughs/MoveInOutFieldWalkthrough";
import { CommercialJanitorialFieldWalkthrough, commercialJanitorialCompletionIssues, isCommercialJanitorialService } from "@/components/walkthroughs/CommercialJanitorialFieldWalkthrough";
import { useAuth } from "@/components/auth/AuthProvider";
import { getServiceCatalog, getAvailableServiceAddons, findCatalogService } from "@/lib/services/serviceCatalog";
import type { ServiceCatalogBundle } from "@/types/serviceCatalog";
import { confirmedAddonSnapshot, interpretAssessmentPricing } from "@/lib/pricing/assessmentPricing";
import { mapWalkthroughToCalculatorInput } from "@/lib/pricing/walkthroughPricing";
import { calculateCommercialEstimate, calculatePostConstructionCatalogEstimate, calculateResidentialEstimate, isPostConstructionV2Estimate } from "@/lib/pricing/estimates";
import { CatalogAddonPicker } from "@/components/serviceCatalog/CatalogAddonPicker";
import type { WalkthroughWithRelations } from "@/types/walkthrough";
import { hasOperationalRecordOverride } from "@/lib/auth/permissions";

export function FieldWalkthroughsPage() {
  const { profile } = useAuth();
  const masterAdmin = hasOperationalRecordOverride(profile);

  const [rows, setRows] = useState<FieldWalkthrough[]>([]);
  const [active, setActive] = useState<FieldWalkthrough | null>(null);
  const [activeCanEdit, setActiveCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [catalog, setCatalog] = useState<ServiceCatalogBundle | null>(null);

  async function refresh() {
    setRows(await getAssignedFieldWalkthroughs());
  }

  useEffect(() => {
    let live = true;

    Promise.all([getAssignedFieldWalkthroughs(), getServiceCatalog()])
      .then(([data, nextCatalog]) => {
        if (live) { setRows(data); setCatalog(nextCatalog); }
      })
      .catch(() => {
        if (live) setError("Assigned walkthroughs could not be loaded.");
      })
      .finally(() => {
        if (live) setLoading(false);
      });

    return () => {
      live = false;
    };
  }, []);

  async function open(id: string) {
    try {
      const fresh = await getAssignedFieldWalkthroughs();
      setRows(fresh);

      const row = fresh.find(item => item.id === id);

      if (row) {
        const canEdit = await canPerformScheduledWalkthrough(row.id);
        setActiveCanEdit(canEdit);
        setActive(row);
      } else {
        setError("This walkthrough is no longer assigned and scheduled for you.");
      }
    } catch {
      setError("Could not verify the current assignment. Please reload.");
    }
  }

  return (
    <>
      <h1 className="text-3xl font-extrabold text-[#143d1a]">
        Assigned Walkthroughs
      </h1>

      <p className="mt-3 text-neutral-600">
        {masterAdmin
          ? "Review all scheduled assigned field assessments."
          : "Scheduled field assessments assigned to you."}
      </p>

      {error && (
        <p role="alert" className="mt-4 text-red-700">
          {error}
        </p>
      )}

      {notice && (
        <p role="status" className="mt-4 text-[#143d1a]">
          {notice}
        </p>
      )}

      {loading ? (
        <p className="mt-6">Loading...</p>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {rows.map(row => (
            <article
              key={row.id}
              className="rounded-xl border bg-white p-5"
            >
              <h2 className="font-bold text-[#143d1a]">
                {row.company_name || row.contact_name || "Scheduled visit"}
              </h2>

              <p>{row.property}</p>

              <p className="mt-2">
                {row.walkthrough_date} at {row.walkthrough_time.slice(0, 5)}
              </p>

              <p>{row.service}</p>

              <button
                className={button}
                onClick={() => void open(row.id)}
              >
                Open Field Assessment
              </button>
            </article>
          ))}

          {!rows.length && (
            <p>
              {masterAdmin
                ? "No scheduled assigned walkthroughs."
                : "No scheduled walkthroughs are assigned to you."}
            </p>
          )}
        </div>
      )}

      {active && (
        <FieldForm
          key={active.id}
          row={active}
          catalog={catalog}
          readOnly={!activeCanEdit}
          close={() => {
            setActive(null);
            setActiveCanEdit(false);
          }}
          saved={async complete => {
            setActive(null);
            setActiveCanEdit(false);
            setNotice(
              complete
                ? "Walkthrough submitted and completed."
                : "Field observations saved."
            );

            try {
              await refresh();
            } catch {
              setError("Saved, but the list could not refresh. Reload the page.");
            }
          }}
        />
      )}
    </>
  );
}

function FieldForm({
  row,
  catalog,
  readOnly,
  close,
  saved,
}: {
  row: FieldWalkthrough;
  catalog: ServiceCatalogBundle | null;
  readOnly: boolean;
  close: () => void;
  saved: (complete: boolean) => Promise<void>;
}) {
  const [measurements, setMeasurements] = useState<FieldMeasurements>({
    ...row.measurements,
    heavySoilBuildup: row.measurements.heavySoilBuildup ?? false,
  });

  const [photos, setPhotos] = useState<OperationalPhotoWithUrl[]>([]);
  const operationInFlight = useRef(false);
  const pendingPhoto = useRef<File | null>(null);
  const [retryPhoto, setRetryPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const service = catalog ? findCatalogService(catalog.services, row.division, row.service ?? "") : undefined;
  const availableAddons = catalog && service ? getAvailableServiceAddons(catalog, service.id, row.division) : [];
  const interpretation = useMemo(() => interpretAssessmentPricing(measurements, availableAddons, measurements.assessmentPricing), [availableAddons, measurements]);
  const recommendedResult = useMemo(() => {
    if (!catalog) return null;
    try {
      const walkthrough = { division: row.division, scope: row.scope, measurements: { ...measurements, overallCondition: interpretation.recommendedCondition ?? measurements.overallCondition }, estimate: null, pricing_review: null } as unknown as WalkthroughWithRelations;
      const input = mapWalkthroughToCalculatorInput(walkthrough, catalog);
      if ("calculatorType" in input) return isPostConstructionV2Estimate(input) ? calculatePostConstructionCatalogEstimate(input, catalog) : null;
      return input.division === "Residential" ? calculateResidentialEstimate(input, catalog) : calculateCommercialEstimate(input, catalog);
    } catch { return null; }
  }, [catalog, interpretation.recommendedCondition, measurements, row.division, row.scope]);

  function changeMeasurements(next: FieldMeasurements) {
    const assessmentPricing = interpretAssessmentPricing(next, availableAddons, measurements.assessmentPricing);
    setMeasurements({ ...next, overallCondition: assessmentPricing.recommendedCondition ?? next.overallCondition, assessmentPricing });
  }

  function updatePendingPhoto(file: File | null) {
    pendingPhoto.current = file;
    setRetryPhoto(file);
  }

  useEffect(() => {
    let live = true;

    getOperationalPhotos("walkthroughs", row.id)
      .then(createPhotoSignedUrls)
      .then(items => {
        if (live) setPhotos(items);
      })
      .catch(() => {
        if (live) {
          setError(
            "Photos could not be loaded. Confirm your assignment is still scheduled."
          );
        }
      });

    return () => {
      live = false;
    };
  }, [row.id]);

  const isPostConstruction = /post[- ]construction/i.test(row.service ?? "");
  const isStandardResidential = isStandardResidentialService(row.service);
  const isDeepCleaning = isDeepCleaningService(row.service);
  const isMoveInOut = isMoveInOutService(row.service);
  const isCommercialJanitorial = isCommercialJanitorialService(row.service);

  async function submit(complete: boolean) {
    if (operationInFlight.current) return;

    if (pendingPhoto.current) {
      setError(
        "Retry the pending photo upload before saving or completing this walkthrough."
      );
      return;
    }

    if (complete && isPostConstruction) {
      const issues = postConstructionCompletionIssues(measurements);

      if (issues.length) {
        setError(`Complete or mark for follow-up: ${issues.join(", ")}.`);
        return;
      }
    }

    if (complete && isStandardResidential) {
      const issues = standardResidentialCompletionIssues(
        measurements,
        row.standard_residential_context
      );

      if (issues.length) {
        setError(
          `Complete the required Standard Residential sections: ${issues.join(", ")}.`
        );
        return;
      }
    }

    if (complete && isDeepCleaning) {
      const issues = deepCleaningCompletionIssues(
        measurements,
        row.standard_residential_context
      );

      if (issues.length) {
        setError(
          `Complete the required Deep Cleaning sections: ${issues.join(", ")}.`
        );
        return;
      }
    }

    if (complete && isMoveInOut) {
      const issues = moveInOutCompletionIssues(
        measurements,
        row.standard_residential_context
      );

      if (issues.length) {
        setError(
          `Complete the required Move-In / Move-Out sections: ${issues.join(", ")}.`
        );
        return;
      }
    }

    if (complete && isCommercialJanitorial) {
      const issues = commercialJanitorialCompletionIssues(
        measurements,
        row.standard_residential_context
      );

      if (issues.length) {
        setError(
          `Complete the required Commercial/Janitorial sections: ${issues.join(", ")}.`
        );
        return;
      }
    }

    if (
      complete &&
      !window.confirm(
        "Submit this walkthrough as completed? It will leave your assigned list."
      )
    ) {
      return;
    }

    operationInFlight.current = true;
    setBusy(true);
    setError("");

    try {
      if (
        fieldNumberKeys.some(
          key =>
            measurements[key] != null &&
            (!Number.isFinite(measurements[key]) ||
              Number(measurements[key]) < 0)
        )
      ) {
        throw new Error("Invalid measurement");
      }

      const currentInterpretation = interpretAssessmentPricing(
        measurements,
        availableAddons,
        measurements.assessmentPricing
      );
      await saveAssignedFieldWalkthrough(
        row.id,
        {
          ...measurements,
          overallCondition:
            currentInterpretation.recommendedCondition ??
            measurements.overallCondition,
          assessmentPricing: currentInterpretation,
        },
        complete
      );
      await saved(complete);
    } catch {
      setError(
        "Could not save. Your assignment may have changed; reload before retrying."
      );
    } finally {
      operationInFlight.current = false;
      setBusy(false);
    }
  }

  async function upload(
    file: File,
    category: WalkthroughPhotoCategory = "General",
    caption: string | null = null
  ) {
    if (operationInFlight.current) return;

    operationInFlight.current = true;
    updatePendingPhoto(file);
    setBusy(true);
    setError("");

    try {
      const items = await uploadOperationalPhoto({
        recordType: "walkthroughs",
        recordId: row.id,
        category,
        caption,
        source: "camera",
        customerVisible: false,
        file,
      });

      updatePendingPhoto(null);
      setPhotos(await createPhotoSignedUrls(items));
    } catch {
      setError("Photo upload failed. Confirm your assignment and try again.");
    } finally {
      operationInFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[75] overflow-y-auto bg-black/60 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Field walkthrough"
        className="mx-auto max-w-4xl rounded-2xl bg-white p-6"
      >
        <h2 className="text-2xl font-bold text-[#143d1a]">
          Field Walkthrough
        </h2>

        {readOnly && (
          <p className="mt-2 text-sm font-bold text-neutral-600">
            This assessment is currently read-only for your account.
          </p>
        )}

        <p className="mt-3">
          {row.company_name} {row.contact_name}
        </p>
        <p>{row.property}</p>
        <p>
          {row.walkthrough_date} at {row.walkthrough_time.slice(0, 5)}
        </p>
        <p>
          {row.phone} {row.email}
        </p>

        <p className="mt-3 font-bold">{row.service}</p>

        <h3 className="mt-5 font-bold">Assessment Scope</h3>

        <ul className="list-disc pl-5">
          {row.scope.map(item => (
            <li key={item.id}>{item.label}</li>
          ))}
        </ul>

        <fieldset disabled={busy || readOnly} className="mt-6">
          {isPostConstruction ? (
            <PostConstructionFieldWalkthrough
              measurements={measurements}
              onChange={changeMeasurements}
              photos={photos}
              onPhoto={(file, category, caption) =>
                void upload(file, category, caption)
              }
            />
          ) : isStandardResidential ? (
            <StandardResidentialFieldWalkthrough
              measurements={measurements}
              context={row.standard_residential_context}
              includedAddons={row.included_addons}
              onChange={changeMeasurements}
            />
          ) : isDeepCleaning ? (
            <DeepCleaningFieldWalkthrough
              measurements={measurements}
              context={row.standard_residential_context}
              includedAddons={row.included_addons}
              onChange={changeMeasurements}
            />
          ) : isMoveInOut ? (
            <MoveInOutFieldWalkthrough
              measurements={measurements}
              context={row.standard_residential_context}
              includedAddons={row.included_addons}
              onChange={changeMeasurements}
            />
          ) : isCommercialJanitorial ? (
            <CommercialJanitorialFieldWalkthrough
              measurements={measurements}
              context={row.standard_residential_context}
              includedAddons={row.included_addons}
              onChange={changeMeasurements}
            />
          ) : (
            <>
              <legend className="font-bold">
                Measurements and Observations
              </legend>

              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                {fieldNumberKeys.map(key => (
                  <label key={key}>
                    {label(key)}
                    <input
                      type="number"
                      min="0"
                      step="any"
                      className={input}
                      value={measurements[key] ?? ""}
                      onChange={e =>
                        setMeasurements({
                          ...measurements,
                          [key]:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        })
                      }
                    />
                  </label>
                ))}

                {fieldTextKeys.map(key => (
                  <label key={key}>
                    {label(key)}

                    {key === "overallCondition" ? (
                      <select
                        className={input}
                        value={measurements[key] ?? ""}
                        onChange={e =>
                          setMeasurements({
                            ...measurements,
                            [key]: e.target.value,
                          })
                        }
                      >
                        {["", "Light", "Average", "Heavy", "Extreme"].map(
                          value => (
                            <option key={value} value={value}>
                              {value || "Select condition"}
                            </option>
                          )
                        )}
                      </select>
                    ) : (
                      <textarea
                        maxLength={5000}
                        className={input}
                        value={measurements[key] ?? ""}
                        onChange={e =>
                          setMeasurements({
                            ...measurements,
                            [key]: e.target.value,
                          })
                        }
                      />
                    )}
                  </label>
                ))}
              </div>

              <label className="mt-4 flex gap-3">
                <input
                  type="checkbox"
                  checked={measurements.heavySoilBuildup ?? false}
                  onChange={e =>
                    setMeasurements({
                      ...measurements,
                      heavySoilBuildup: e.target.checked,
                    })
                  }
                />
                Heavy soil buildup
              </label>

              <h3 className="mt-6 font-bold">Photos</h3>

              <label className="mt-3 block">
                Add walkthrough photo
                <input
                  type="file"
                  accept="image/*"
                  className="mt-2 block"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) void upload(file);
                    e.target.value = "";
                  }}
                />
              </label>

              <div className="mt-4 grid grid-cols-2 gap-3">
                {photos.map(photo => (
                  <figure key={photo.id}>
                    {photo.signedUrl && (
                      <img
                        src={photo.signedUrl}
                        alt={photo.caption || photo.category}
                        className="max-h-64 w-full rounded-lg object-contain"
                      />
                    )}

                    <figcaption className="text-sm">
                      {photo.caption || photo.category}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </>
          )}
          <section className="mt-6 rounded-xl border border-[#143d1a]/15 bg-[#f5f7f4] p-4">
            <h3 className="font-extrabold text-[#143d1a]">Recommended Pricing Impact</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div><p className="text-xs font-bold text-neutral-500">Overall Condition</p><p className="font-extrabold">{interpretation.recommendedCondition ?? "Awaiting findings"}</p></div>
              <div><p className="text-xs font-bold text-neutral-500">Labor Plan</p><p className="font-extrabold">{interpretation.laborPlan.durationLabel ?? "No duration recommendation"}</p></div>
              <div><p className="text-xs font-bold text-neutral-500">Live Recommended Total</p><p className="font-extrabold">{recommendedResult ? money(recommendedResult.finalPrice) : "Complete pricing inputs"}</p></div>
            </div>
            {interpretation.conditionEvidence.length > 0 && <p className="mt-3 text-xs text-neutral-600">Condition evidence: {interpretation.conditionEvidence.map(item => `${label(item.key)} — ${item.value}`).join("; ")}</p>}
            {interpretation.laborEvidence.length > 0 && <p className="mt-2 text-xs text-neutral-600">{interpretation.laborEvidence.join(" · ")}. Advisory only; no arbitrary labor surcharge is applied.</p>}
            {interpretation.suggestedAddons.length > 0 && <div className="mt-4 space-y-2"><p className="text-xs font-bold text-neutral-600">Assessment add-on suggestions</p>{interpretation.suggestedAddons.map(suggestion => <div key={suggestion.catalogAddonId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-3 text-sm"><span><b>{suggestion.name}</b> — {suggestion.disposition}</span>{suggestion.disposition === "Pending" && <div className="flex gap-2"><button type="button" className="rounded bg-[#143d1a] px-3 py-1.5 font-bold text-white" onClick={() => { const addon=availableAddons.find(item=>item.id===suggestion.catalogAddonId); if(addon) changeMeasurements({...measurements,catalogAddons:[...(measurements.catalogAddons??[]),confirmedAddonSnapshot(addon)]}); }}>Add to Scope</button><button type="button" className="rounded border px-3 py-1.5 font-bold" onClick={() => setMeasurements({...measurements,assessmentPricing:{...interpretation,suggestedAddons:interpretation.suggestedAddons.map(item=>item.catalogAddonId===suggestion.catalogAddonId?{...item,disposition:"Not Included"}:item)}})}>Not Included</button></div>}</div>)}</div>}
            {availableAddons.length > 0 && <div className="mt-4"><CatalogAddonPicker addons={availableAddons} selected={(measurements.catalogAddons??[]).map(item=>item.name)} setSelected={names=>changeMeasurements({...measurements,catalogAddons:(measurements.catalogAddons??[]).filter(item=>names.includes(item.name))})} snapshots={measurements.catalogAddons} setSnapshots={catalogAddons=>changeMeasurements({...measurements,catalogAddons})}/></div>}
          </section>
        </fieldset>

        {error && (
          <p role="alert" className="mt-4 text-red-700">
            {error}
          </p>
        )}

        {retryPhoto && !busy && !readOnly && (
          <button
            className={button}
            onClick={() => {
              void upload(retryPhoto);
            }}
          >
            Retry Photo Upload
          </button>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          {!readOnly && (
            <>
              <button
                disabled={busy}
                className={button}
                onClick={() => void submit(false)}
              >
                Save Draft
              </button>

              <button
                disabled={busy}
                className={button}
                onClick={() => void submit(true)}
              >
                Submit / Complete
              </button>
            </>
          )}

          <button
            disabled={busy}
            className="rounded-lg border px-4 py-2"
            onClick={() => {
              updatePendingPhoto(null);
              close();
            }}
          >
            Close
          </button>
        </div>
      </section>
    </div>
  );
}

function label(key: string) {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, c => c.toUpperCase());
}

const button =
  "mt-3 rounded-lg bg-[#143d1a] px-4 py-2 font-bold text-white disabled:opacity-50";

const input =
  "mt-1 block w-full rounded-lg border border-neutral-300 p-2";

function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value); }
