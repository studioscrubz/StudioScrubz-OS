"use client";

import { useEffect, useState } from "react";
import { AgreementPricingBreakdown } from "@/components/agreements/AgreementPricingBreakdown";
import { SignaturePad } from "@/components/agreements/SignaturePad";
import { StudioScrubzLogo } from "@/components/branding/StudioScrubzLogo";
import { addonDisplayLabel, includedServiceDetails } from "@/lib/documents/customerServicePresentation";
import { formatTime12Hour } from "@/lib/formatTime";
import { serviceFrequencyLabel } from "@/lib/scheduling/frequency";
import { completeInPersonSignature, getInPersonSigningSession } from "@/lib/services/inPersonAgreements";
import type { PublicAgreement } from "@/types/publicAgreement";

export function InPersonAgreementPage({ token }: { token: string }) {
  const [agreement, setAgreement] = useState<PublicAgreement | null>(null);
  const [name, setName] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  useEffect(() => {
    void getInPersonSigningSession(token)
      .then((value) => { setAgreement(value); setName(value.client_signed_name ?? ""); })
      .catch((cause) => setError(message(cause)))
      .finally(() => setLoading(false));
  }, [token]);
  async function complete() {
    if (!agreement || agreement.session_completed_at || signing) return;
    if (!reviewed || !consent) { setError("Review the complete Agreement and confirm both acknowledgments."); return; }
    if (name.trim().length < 2) { setError("Enter your full legal name."); return; }
    if (!signature) { setError("Draw your signature before completing the Agreement."); return; }
    setSigning(true); setError(null);
    try {
      setAgreement(await completeInPersonSignature({ token, signedName: name, signature, consent, reviewed }));
    } catch (cause) {
      setError(message(cause));
    } finally {
      setSigning(false);
    }
  }

  if (loading) return <Shell><p className="text-center font-semibold">Loading secure signing session…</p></Shell>;
  if (!agreement) return <Shell><h1 className="text-2xl font-extrabold text-[#143d1a]">Signing session unavailable</h1><p className="mt-3 text-neutral-600">{error}</p></Shell>;

  const signed = Boolean(agreement.session_completed_at && agreement.client_signature);
  const included = includedServiceDetails(agreement.scope.split(/\r?\n/), agreement.service_name, agreement.pricing_snapshot?.catalog_addons ?? []);
  const schedule = scheduleLabel(agreement);
  return <Shell>
    <header className="sticky top-0 z-20 -mx-4 mb-4 border-b bg-white/95 px-4 py-3 shadow-sm backdrop-blur print:static print:shadow-none">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-3"><div><p className="text-xs font-extrabold uppercase tracking-[.18em] text-[#9a7a17]">Secure in-person signing</p><p className="font-bold text-[#143d1a]">{agreement.agreement_number}</p></div><p className="text-right text-xs text-neutral-500">Witnessed by<br/><b>{agreement.in_person_witnessed_by_name}</b></p></div>
    </header>
    <article className="rounded-2xl border bg-white p-5 shadow-sm sm:p-8 print:border-0 print:p-0 print:shadow-none">
      <header className="flex flex-col items-center gap-4 border-b-2 border-[#143d1a] pb-5 text-center sm:flex-row sm:text-left"><StudioScrubzLogo size={104} priority/><div><h1 className="text-3xl font-extrabold text-[#143d1a]">{agreement.business_name}</h1>{agreement.tagline && <p>{agreement.tagline}</p>}<p className="text-sm text-neutral-600">{[agreement.business_email, agreement.business_phone, agreement.website].filter(Boolean).join(" · ")}</p></div></header>
      <h2 className="mt-6 text-2xl font-extrabold">Service Agreement</h2><p className="font-semibold">{agreement.agreement_number}</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2"><Detail label="Company / Client" value={agreement.client_name}/><Detail label="Property / Site" value={agreement.property_location}/><Detail label="Service" value={agreement.service_name}/><Detail label="Frequency" value={serviceFrequencyLabel(agreement.frequency)}/><Detail label="Service Days" value={schedule}/><Detail label="Service Time" value={formatTime12Hour(agreement.default_start_time)}/><Detail label="Start Date" value={agreement.start_date}/>{agreement.end_date && <Detail label="End Date" value={agreement.end_date}/>}<Detail label={billingLabel(agreement.billing_type)} value={money(agreement.billing_amount)}/><Detail label="Billing Type" value={agreement.billing_type}/></div>
      <Section label="Service Description" value={agreement.service_description}/>
      <AgreementPricingBreakdown pricing={agreement.pricing_snapshot}/>
      {Boolean(agreement.pricing_snapshot?.catalog_addons?.length) && (
        <Section label="Add-Ons" value={(agreement.pricing_snapshot?.catalog_addons ?? []).map((item) => `${addonDisplayLabel(item)} — ${money(item.amount)}`).join("\n")}/>
      )}
      {included.length > 0 && (
        <Section label="Included Services / Cleaning Specifications" value={included.join("\n")}/>
      )}
      <Section label="Payment Terms" value={agreement.payment_terms}/><Section label="Agreement Terms" value={agreement.agreement_terms}/><Section label="Cancellation Terms" value={agreement.cancellation_terms}/><Section label="Special Instructions" value={agreement.special_instructions}/>

      {signed ? <SignedRecord agreement={agreement}/> : <section className="mt-8 rounded-2xl border-2 border-[#143d1a]/20 bg-[#f8faf7] p-4 sm:p-6 print:hidden">
        <h3 className="text-xl font-extrabold text-[#143d1a]">Client Signature</h3>
        <p className="mt-1 text-sm text-neutral-600">The client must personally complete this section. The witnessing representative may assist with the device but may not sign for the client.</p>
        <label className="mt-5 flex items-start gap-3 text-sm font-semibold"><input className="mt-1 size-5" type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)}/><span>I confirm that I have reviewed the complete Service Agreement above, including pricing, scope, add-ons, and terms.</span></label>
        <label className="mt-4 block font-bold">Client full legal name<input autoComplete="name" className="mt-1 h-12 w-full rounded-lg border bg-white px-3 text-base" value={name} onChange={(event) => setName(event.target.value)} /></label>
        <div className="mt-4"><p className="font-bold">Draw your signature</p><SignaturePad onChange={setSignature} disabled={signing}/></div>
        <label className="mt-5 flex items-start gap-3 text-sm font-semibold"><input className="mt-1 size-5" type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)}/><span>I agree to use my drawn electronic signature and understand it has the same intent as signing this Agreement by hand.</span></label>
        {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 font-semibold text-red-700">{error}</p>}
        <button type="button" className="mt-5 w-full rounded-xl bg-[#143d1a] px-5 py-4 text-lg font-extrabold text-white disabled:opacity-50" disabled={signing || !reviewed || !consent || name.trim().length < 2 || !signature} onClick={() => void complete()}>{signing ? "Saving signature…" : "Complete Signature"}</button>
        <p className="mt-3 text-center text-xs text-neutral-500">This secure session expires {agreement.session_expires_at ? new Date(agreement.session_expires_at).toLocaleString() : "soon"}.</p>
      </section>}
      {signed && <div className="mt-6 print:hidden"><button className={secondary} onClick={() => window.print()}>Download / Print Signed Agreement</button></div>}
    </article>
  </Shell>;
}

function Shell({ children }: { children: React.ReactNode }) { return <main className="min-h-screen bg-[#f5f6f4] px-4 pb-10 print:bg-white print:p-0"><div className="mx-auto max-w-4xl">{children}</div></main>; }
function Detail({ label, value }: { label: string; value: string }) { return <div><b className="block text-[#143d1a]">{label}</b><span>{value || "—"}</span></div>; }
function Section({ label, value }: { label: string; value: string | null }) { return <section className="mt-5"><h3 className="font-bold text-[#143d1a]">{label}</h3><p className="whitespace-pre-line">{value || "—"}</p></section>; }
function SignedRecord({ agreement }: { agreement: PublicAgreement }) { return <section className="mt-8 rounded-xl border border-green-300 bg-green-50 p-5"><h3 className="text-lg font-bold text-green-800">Agreement Accepted — In-Person Digital Signature</h3><p className="mt-2">Signed by: <b>{agreement.client_signed_name}</b></p>{agreement.client_signature && <img src={agreement.client_signature} alt={`Drawn signature of ${agreement.client_signed_name}`} className="mt-3 h-28 max-w-full rounded border bg-white object-contain"/>}<p className="mt-2 text-sm">Signed {agreement.client_signed_at ? new Date(agreement.client_signed_at).toLocaleString() : ""}</p><p className="text-sm">Witnessed by {agreement.in_person_witnessed_by_name}</p>{agreement.client_consent_text && <p className="mt-2 text-xs text-neutral-600">{agreement.client_consent_text}</p>}</section>; }
function scheduleLabel(agreement: PublicAgreement) { return ["Weekly", "Biweekly", "Every 4 Weeks", "Multiple Days Per Week"].includes(agreement.frequency) && agreement.days_of_week.length ? agreement.days_of_week.map((day) => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day]).join(", ") : agreement.frequency === "Twice Monthly" && agreement.day_of_month && agreement.second_day_of_month ? `Days ${agreement.day_of_month} and ${agreement.second_day_of_month} of each month` : agreement.frequency === "Monthly" && agreement.day_of_month ? `Day ${agreement.day_of_month} of each month` : agreement.frequency === "Custom" && agreement.custom_interval_days ? `Every ${agreement.custom_interval_days} days` : agreement.frequency; }
function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value); }
function billingLabel(type: string) { return type === "Per Visit" ? "Per Visit Amount" : type === "Weekly" ? "Weekly Contract Amount" : type === "Biweekly" ? "Biweekly Contract Amount" : type === "Monthly" ? "Monthly Contract Amount" : "Contract Value"; }
function message(cause: unknown) { return cause instanceof Error && cause.message ? cause.message : "This secure signing session is unavailable."; }
const secondary = "rounded-lg border border-[#143d1a]/30 bg-white px-4 py-2 text-sm font-bold text-[#143d1a] disabled:opacity-40";
