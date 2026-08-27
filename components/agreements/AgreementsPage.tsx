"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { hasPermission } from "@/lib/auth/permissions";
import { includedServiceDetails } from "@/lib/documents/customerServicePresentation";
import {
  activateAgreement, agreementScopeFromProposal, agreementServiceDescriptionFromProposal, archiveAgreement, cancelAgreement, completeAgreement, createAgreement, createAgreementFromProposal,
  estimatedMonthlyAmount, getAgreements, markAgreementAccepted, markAgreementSent,
  monthlyRecurringRevenue, pauseAgreement, resumeAgreement, saveAgreementEdits, validateAgreementConfiguration,
  getAgreementFinancialSummary,
} from "@/lib/services/agreements";
import { createBiweeklyContractInvoice, createFlatContractInvoice, createMonthlyContractInvoice, createWeeklyContractInvoice, getAgreementInvoices } from "@/lib/services/invoices";
import { getBusinessSettings } from "@/lib/services/businessSettings";
import { cancelOccurrence, createJobFromOccurrence, deleteOccurrence, generateOccurrences, getOccurrences, isDeletedOccurrence, rescheduleOccurrence, skipOccurrence } from "@/lib/services/serviceOccurrences";
import { getClients } from "@/lib/services/clients";
import { getProperties } from "@/lib/services/properties";
import { getActiveCrews } from "@/lib/services/crews";
import { getServiceCatalog } from "@/lib/services/serviceCatalog";
import { catalogAgreementPricing, proposalAgreementPricing } from "@/lib/pricing/agreementPricing";
import { matchingRecurringRules } from "@/lib/pricing/pricingEngine";
import { getProposalById } from "@/lib/services/proposals";
import { getPublicSiteUrl } from "@/lib/publicSiteUrl";
import { formatTime12Hour } from "@/lib/formatTime";
import { StudioScrubzLogo } from "@/components/branding/StudioScrubzLogo";
import { AgreementPricingBreakdown } from "@/components/agreements/AgreementPricingBreakdown";
import { AgreementDocuments } from "@/components/agreements/AgreementDocuments";
import { deliverDocument } from "@/lib/services/unifiedDocumentDelivery";
import { AGREEMENT_BILLING_TYPES, AGREEMENT_FREQUENCIES, AGREEMENT_STATUSES, type AgreementFinancialSummary, type AgreementInput, type AgreementWithRelations, type Weekday } from "@/types/agreement";
import type { InvoiceWithRelations } from "@/types/invoice";
import type { ServiceOccurrenceWithRelations } from "@/types/serviceOccurrence";
import type { Client } from "@/types/client";
import type { PropertyWithClient } from "@/types/property";
import type { CrewWithRelations } from "@/types/crew";
import type { BusinessSettings } from "@/types/businessSettings";
import { useOperationalRealtime } from "@/components/realtime/OperationalRealtimeProvider";
import type { CatalogService, RecurringPricingRule } from "@/types/serviceCatalog";
import type { ProposalWithRelations } from "@/types/proposal";

export function AgreementsPage() {
  const { profile } = useAuth();
  const canManage = hasPermission(profile, "agreements.manage");
  const canCreateJobs = hasPermission(profile, "jobs.create");
  const canViewInvoices = hasPermission(profile, "invoices.view");
  const canCreateInvoices = hasPermission(profile, "invoices.create");
  const [agreements, setAgreements] = useState<AgreementWithRelations[]>([]);
  const [occurrences, setOccurrences] = useState<ServiceOccurrenceWithRelations[]>([]);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [form, setForm] = useState<AgreementWithRelations | null | "new">(null);
  const [proposalSource, setProposalSource] = useState<ProposalWithRelations | null>(null);
  const [preview, setPreview] = useState<AgreementWithRelations | null>(null);
  const [send, setSend] = useState<AgreementWithRelations | null>(null);
  const [documents, setDocuments] = useState<AgreementWithRelations | null>(null);
  const [billing, setBilling] = useState<AgreementWithRelations | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All");
  const [loading, setLoading] = useState(true);

  async function load() {
    const [nextAgreements, nextOccurrences] = await Promise.all([getAgreements(), getOccurrences()]);
    setAgreements(nextAgreements); setOccurrences(nextOccurrences);
  }
  useOperationalRealtime(["service_agreements", "service_occurrences", "jobs", "invoices", "payments"], load);
  useEffect(() => {
    // Initial client-side hydration from Supabase.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void Promise.all([load(), getBusinessSettings().then(setSettings)])
      .catch((cause) => setError(message(cause))).finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search), proposalId = params.get("proposalId"), agreementId = params.get("agreementId");
    if (agreementId) {
      void getAgreements().then((rows) => setPreview(rows.find((row) => row.id === agreementId) ?? null)).catch((cause) => setError(message(cause)));
      return;
    }
    if (!proposalId) return;
    void Promise.all([getProposalById(proposalId), getAgreements()])
      .then(([proposal, rows]) => {
        const existing = rows.find((row) => row.proposal_id === proposalId && !row.archived_at && !["Cancelled", "Archived"].includes(row.status));
        if (existing) { setPreview(existing); return; }
        setProposalSource(proposal); setForm("new");
      })
      .catch((cause) => setError(message(cause)));
  }, []);
  async function act(operation: () => Promise<unknown>, success: string) {
    setError(null); setNotice(null);
    try { await operation(); await load(); setNotice(success); }
    catch (cause) { setError(message(cause)); }
  }
  async function activate(agreement: AgreementWithRelations) {
    setError(null); setNotice(null); setActivatingId(agreement.id);
    setActionErrors((current) => { const next = { ...current }; delete next[agreement.id]; return next; });
    try { await activateAgreement(agreement.id); await load(); setNotice("Agreement activated."); }
    catch (cause) { setActionErrors((current) => ({ ...current, [agreement.id]: message(cause) })); }
    finally { setActivatingId(null); }
  }
  const shown = useMemo(() => agreements.filter((agreement) =>
    (status === "All" || agreement.status === status) &&
    (!query || [agreement.agreement_number, agreement.agreement_name, agreement.service_name, clientName(agreement), agreement.property?.address]
      .filter(Boolean).join(" ").toLowerCase().includes(query.toLowerCase()))), [agreements, query, status]);
  const today = dateOnly();
  const visibleOccurrences = occurrences.filter((row) => !isDeletedOccurrence(row));
  const active = agreements.filter((agreement) => agreement.status === "Active" && !agreement.archived_at);
  const metrics = [
    ["Active Agreements", String(active.length)],
    ["Recurring Monthly Revenue", money(active.reduce((sum, agreement) => sum + monthlyRecurringRevenue(agreement), 0))],
    ["Services This Week", String(visibleOccurrences.filter((row) => row.scheduled_date >= today && row.scheduled_date <= addDays(today, 7)).length)],
    ["Services This Month", String(visibleOccurrences.filter((row) => row.scheduled_date >= today && row.scheduled_date <= addDays(today, 30)).length)],
    ["Expiring Soon", String(active.filter((agreement) => agreement.end_date && agreement.end_date <= addDays(today, 30)).length)],
  ];
  async function completeWithWarning(agreement: AgreementWithRelations) {
    const future = visibleOccurrences.filter((row) => row.agreement_id === agreement.id && row.scheduled_date >= today && !["Completed", "Skipped", "Cancelled"].includes(row.status)).length;
    if (future && !window.confirm(`This agreement has ${future} future service occurrence${future === 1 ? "" : "s"}. Completing it stops new schedule generation but keeps existing occurrences. Continue?`)) return;
    await act(() => completeAgreement(agreement.id), "Agreement completed. New occurrences will no longer be generated.");
  }

  return <>
    <header className="border-b pb-7"><h1 className="text-3xl font-extrabold text-[#143d1a]">Service Agreements</h1><p className="mt-3 text-neutral-600">Manage recurring StudioScrubz service contracts and scheduled services.</p>{canManage && <button disabled={loading||!settings} className={`${primary} mt-5 disabled:opacity-50`} onClick={() => setForm("new")}>New Agreement</button>}</header>
    {error && <Alert text={error}/>} {notice && <Alert text={notice} good/>}
    <div className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-5">{metrics.map(([label, value]) => <Card key={label} label={label} value={loading ? "—" : value}/>)}</div>
    <div className="mt-6 flex gap-3 rounded-xl border bg-white p-4"><input className={input} placeholder="Search agreements" value={query} onChange={(event) => setQuery(event.target.value)}/><select className={input} value={status} onChange={(event) => setStatus(event.target.value)}><option>All</option>{AGREEMENT_STATUSES.map((value) => <option key={value}>{value}</option>)}</select></div>
    <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{shown.map((agreement) => <article className="rounded-xl border bg-white p-5" key={agreement.id}>
      <b className="text-[#143d1a]">{agreement.agreement_number}</b><h2>{agreement.agreement_name}</h2>
      <p className="text-sm font-semibold text-[#34633c]">{agreement.division}</p>
      <p className="text-sm text-neutral-500">{clientName(agreement)} · {agreement.property?.property_name || agreement.property?.address || "Deleted Property"}</p>
      <p>{agreement.service_name} · {agreement.frequency}</p><p>{billingLabel(agreement.billing_type)}: {money(agreement.billing_amount)} · {agreement.status}</p>
      {agreement.sent_at && <p className="mt-1 text-xs text-neutral-500">Last sent {new Date(agreement.sent_at).toLocaleString()} to {agreement.sent_to}</p>}
      {agreement.status === "Sent" && <p className="mt-1 text-xs font-semibold text-amber-700">Awaiting Client Signature</p>}
      {agreement.client_signed_at && <p className="mt-1 text-xs font-semibold text-green-700">Signed by {agreement.client_signed_name} on {new Date(agreement.client_signed_at).toLocaleString()}</p>}
      <div className="mt-3 flex flex-wrap gap-1">
        {canManage && ["Draft", "Sent", "Accepted", "Active", "Paused"].includes(agreement.status) && <button className={secondary} onClick={() => setForm(agreement)}>Edit</button>}
        <button className={secondary} onClick={() => setPreview(agreement)}>Preview</button>
        <button className={secondary} onClick={() => setDocuments(agreement)}>Documents</button>
        {canViewInvoices && (["Weekly","Biweekly"].includes(agreement.billing_type) || agreement.division === "Commercial" && ["Monthly", "Flat Contract"].includes(agreement.billing_type)) && <button className={secondary} onClick={() => setBilling(agreement)}>Contract Billing</button>}
        {canManage && agreement.status === "Draft" && <button className={secondary} onClick={() => setSend(agreement)}>Send to Client</button>}
        {canManage && agreement.status === "Sent" && <><button className={secondary} onClick={() => setSend(agreement)}>Resend</button><button className={secondary} onClick={() => void act(() => markAgreementAccepted(agreement.id), "Agreement marked accepted.")}>Mark Accepted</button></>}
        {canManage && agreement.status === "Accepted" && <button disabled={activatingId === agreement.id} className={secondary} onClick={() => void activate(agreement)}>{activatingId === agreement.id ? "Activating..." : "Activate"}</button>}
        {canManage && agreement.status === "Active" && <><button className={secondary} onClick={() => void act(() => generateOccurrences(agreement.id), "60-day schedule generated.")}>Generate Schedule</button><button className={secondary} onClick={() => void act(() => pauseAgreement(agreement.id), "Agreement paused.")}>Pause</button><button className={secondary} onClick={() => void completeWithWarning(agreement)}>Complete</button><button className={secondary} onClick={() => void act(() => cancelAgreement(agreement.id), "Agreement cancelled.")}>Cancel</button></>}
        {canManage && agreement.status === "Paused" && <><button className={secondary} onClick={() => void act(() => resumeAgreement(agreement.id), "Agreement resumed.")}>Resume</button><button className={secondary} onClick={() => void act(() => cancelAgreement(agreement.id), "Agreement cancelled.")}>Cancel</button></>}
        {canManage && ["Completed", "Cancelled"].includes(agreement.status) && <button className={secondary} onClick={() => void act(() => archiveAgreement(agreement.id), "Agreement archived.")}>Archive</button>}
      </div>
      {actionErrors[agreement.id] && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">{actionErrors[agreement.id]}</p>}
    </article>)}</div>
    <Occurrences rows={visibleOccurrences.filter((row) => row.scheduled_date >= today)} act={act} canManage={canManage} canCreateJobs={canCreateJobs}/>
    <div className="mt-5 flex gap-2"><button className={secondary} onClick={() => exportAgreements(shown, visibleOccurrences)}>Export Agreements CSV</button><button className={secondary} onClick={() => exportOccurrences(visibleOccurrences.filter((row) => row.scheduled_date >= today))}>Export Upcoming Services CSV</button></div>
    {form && <AgreementForm value={form === "new" ? null : form} proposal={form === "new" ? proposalSource : null} settings={settings} close={() => { setForm(null); setProposalSource(null); }} saved={async () => { setForm(null); setProposalSource(null); await load(); }}/>}
    {preview && <Modal close={() => setPreview(null)}><AgreementDocument agreement={preview} settings={settings}/><button className={`${primary} mt-5 print:hidden`} onClick={() => window.print()}>Print Agreement</button></Modal>}
    {documents && <Modal close={() => setDocuments(null)}><h2 className="text-2xl font-bold text-[#143d1a]">{documents.agreement_number} Documents</h2><p className="mt-1 text-sm text-neutral-500">{documents.agreement_name}</p><AgreementDocuments agreementId={documents.id} canManage={canManage}/></Modal>}
    {billing && <ContractBilling agreement={billing} canCreateInvoices={canCreateInvoices} close={() => setBilling(null)}/>}
    {send && <SendAgreementModal agreement={send} settings={settings} sender={profile?.display_name || profile?.email || "Master Admin"} close={() => setSend(null)} sent={async (deliveryNotice) => {
      setSend(null); await load(); setNotice(deliveryNotice);
    }}/>}
  </>;
}

function SendAgreementModal({ agreement, settings, sender, close, sent }: { agreement: AgreementWithRelations; settings: BusinessSettings | null; sender: string; close: () => void; sent: (notice: string) => Promise<void> }) {
  const email = agreement.sent_to?.includes("@") ? agreement.sent_to : agreement.client?.email || "";
  const phone = agreement.client?.phone || "";
  const [subject, setSubject] = useState(`StudioScrubz Service Agreement ${agreement.agreement_number}`);
  const [body, setBody] = useState(`Hello ${clientName(agreement)},\n\nYour StudioScrubz Service Agreement is ready for review.\n\nPlease use the secure link below to review and sign your agreement.\n\nIf you have questions, please contact StudioScrubz.\n\nThank you,\nStudioScrubz`);
  const [token] = useState(() => {
    const validExistingToken = Boolean(agreement.client_access_token && (!agreement.client_access_token_expires_at || new Date(agreement.client_access_token_expires_at).getTime() > Date.now()));
    return validExistingToken ? agreement.client_access_token || "" : generateSecureToken();
  });
  const hasValidToken = token === agreement.client_access_token;
  const reviewUrl = `${getPublicSiteUrl()}/agreement/${token}`;
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function submit() {
    if (!email.trim() && !phone.trim()) { setError("Customer does not have an email address or phone number on file."); return; } if (!token || !reviewUrl) { setError("The secure review link is still being prepared."); return; }
    setBusy(true); setError(null);
    try {
      const expiry = hasValidToken && agreement.client_access_token_expires_at ? agreement.client_access_token_expires_at : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const result = await deliverDocument({ documentType: "Service Agreement", documentId: agreement.id, documentNumber: agreement.agreement_number, clientId: agreement.client_id, propertyId: agreement.property_id, email, phone, subject, messageBody: body, publicUrl: reviewUrl, publicLinkLabel: "Review & Sign Agreement", prepare: async (_channel, recipient) => { await markAgreementSent(agreement.id, recipient, sender, token, expiry); } });
      await sent(result.message);
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  return <Modal close={close}><h2 className="text-2xl font-bold text-[#143d1a]">Send Service Agreement</h2><p className="mt-1 text-sm text-neutral-500">Send uses every available customer contact method.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2"><Field label="Client" value={clientName(agreement)} set={() => undefined} disabled/><DeliverySummary email={email} phone={phone}/></div>
    <Field label="Email Subject" value={subject} set={setSubject}/><label className="mt-3 block">Message<textarea className={`${input} h-36 py-3`} value={body} onChange={(event) => setBody(event.target.value)}/></label><div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-3"><b className="text-[#143d1a]">Review &amp; Sign Agreement</b><p className="mt-1 break-all text-xs">{reviewUrl || "Preparing secure link…"}</p></div>
    <div className="mt-5 rounded-xl border bg-neutral-50 p-4"><AgreementDocument agreement={agreement} settings={settings}/></div>{error && <Alert text={error}/>}<button className={`${primary} mt-5`} disabled={busy||(!email&&!phone)} onClick={() => void submit()}>{busy ? "Sending…" : agreement.sent_at ? "Resend" : "Send"}</button>
  </Modal>;
}

function DeliverySummary({email,phone}:{email:string;phone:string}) { return <div className="rounded-lg border bg-neutral-50 p-3 text-sm"><b className="text-[#143d1a]">Delivery</b><p className="mt-2">{email ? `✓ Email: ${email}` : "— Email: No email address on file"}</p><p className="mt-1">{phone ? `✓ Text: ${phone}` : "— Text: No phone number on file"}</p></div>; }

function AgreementDocument({ agreement, settings }: { agreement: AgreementWithRelations; settings: BusinessSettings | null }) {
  const included=includedServiceDetails(agreement.scope.map(item=>item.text),agreement.service_name,agreement.pricing_snapshot?.catalog_addons??[]);
  const schedule = ["Weekly", "Biweekly", "Every 4 Weeks", "Multiple Days Per Week"].includes(agreement.frequency) && agreement.days_of_week.length ? agreement.days_of_week.map((day) => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day]).join(", ") : agreement.frequency === "Monthly" ? `Day ${agreement.day_of_month} of each month` : agreement.frequency === "Custom" ? `Every ${agreement.custom_interval_days} days` : agreement.frequency;
  return <article id="agreement-document" className="mx-auto max-w-3xl bg-white p-6 text-sm text-neutral-800 print:max-w-none print:p-0">
    <div className="flex flex-col items-center gap-4 border-b-2 border-[#143d1a] pb-4 text-center sm:flex-row sm:text-left"><StudioScrubzLogo size={108}/><div><h1 className="text-3xl font-extrabold text-[#143d1a]">{settings?.business_name || "StudioScrubz"}</h1>{settings?.tagline && <p>{settings.tagline}</p>}<p>{[settings?.business_email, settings?.business_phone, settings?.website].filter(Boolean).join(" · ")}</p><p>{[settings?.address, settings?.city, settings?.state, settings?.zip].filter(Boolean).join(", ")}</p></div></div>
    <h2 className="mt-6 text-2xl font-bold">{agreement.division} Service Agreement</h2><p className="font-semibold">{agreement.agreement_number} · {agreement.status}</p>
    <div className="mt-5 grid grid-cols-2 gap-4"><Detail label="Agreement" value={agreement.agreement_name}/><Detail label="Division" value={agreement.division}/><Detail label={agreement.division === "Commercial" ? "Company / Client" : "Client"} value={clientName(agreement)}/><Detail label={agreement.division === "Commercial" ? "Property / Site" : "Property / Service Location"} value={agreement.property?.property_name || agreement.property?.address || "Deleted Property"}/><Detail label="Service" value={agreement.service_name}/><Detail label="Frequency" value={agreement.frequency}/><Detail label={billingLabel(agreement.billing_type)} value={money(agreement.billing_amount)}/><Detail label="Billing Type" value={agreement.billing_type}/><Detail label="Estimated Monthly Amount" value={estimatedMonthlyAmount(agreement) ? `${money(estimatedMonthlyAmount(agreement))} (estimate)` : "Not applicable"}/><Detail label="Start Date" value={agreement.start_date}/><Detail label="End Date" value={agreement.end_date || "No end date"}/><Detail label="Service Days" value={schedule}/><Detail label="Service Time" value={formatTime12Hour(agreement.default_start_time)}/><Detail label="Assigned Crew" value={agreement.crew?.crew_name || "Not assigned"}/><Detail label="Proposal" value={agreement.proposal?.proposal_number || "Not linked"}/></div>
    <Section title="Service Description" value={agreement.pricing_snapshot?.service_description || "—"}/>{included.length>0&&<Section title="Included Services / Cleaning Specifications" value={included.join("\n")}/>}<Section title="Special Instructions" value={agreement.special_instructions || "—"}/><Section title="Payment Terms" value={agreement.payment_terms || "—"}/><Section title="Agreement Terms" value={agreement.agreement_terms || agreement.notes || "—"}/><Section title="Cancellation Terms" value={agreement.cancellation_terms || "—"}/>
    {agreement.billing_type==="Per Visit"&&<AgreementPricingBreakdown pricing={agreement.pricing_snapshot}/>}
    <p className="mt-5 text-xs text-neutral-500">This operational agreement record reflects the supplied business terms and is not a substitute for independent legal advice.</p>
    <div className="mt-12 grid grid-cols-2 gap-12"><Signature label="Client Signature"/><Signature label="StudioScrubz Signature"/></div>
  </article>;
}
function Detail({ label, value }: { label: string; value: string }) { return <div><b className="block text-[#143d1a]">{label}</b><span>{value}</span></div>; }
function Section({ title, value }: { title: string; value: string }) { return <section className="mt-5"><h3 className="font-bold text-[#143d1a]">{title}</h3><p className="whitespace-pre-line">{value}</p></section>; }
function Signature({ label }: { label: string }) { return <div><div className="h-12 border-b border-neutral-700"/><p className="mt-2">{label} / Date</p></div>; }

function Occurrences({ rows, act, canManage, canCreateJobs }: { rows: ServiceOccurrenceWithRelations[]; act: (operation: () => Promise<unknown>, success: string) => Promise<void>; canManage: boolean; canCreateJobs:boolean }) { function remove(row:ServiceOccurrenceWithRelations){const date=new Date(`${row.scheduled_date}T12:00:00`).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"});if(!window.confirm(`Permanently delete this upcoming service on ${date}?\n\nThis removes the scheduled occurrence and cannot be undone.`))return;void act(()=>deleteOccurrence(row.id),"Upcoming service deleted.")}return <section className="mt-10"><h2 className="text-xl font-bold">Upcoming Services</h2><div className="mt-3 overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[900px] text-sm"><thead><tr>{["Date", "Time", "Agreement", "Service", "Status", "Job", "Actions"].map((label) => <th className="p-3 text-left" key={label}>{label}</th>)}</tr></thead><tbody>{rows.map((row) => <tr className="border-t" key={row.id}><td className="p-3">{row.scheduled_date}</td><td className="p-3">{formatTime12Hour(row.scheduled_start_time)}</td><td className="p-3">{row.agreement.agreement_number}</td><td className="p-3">{row.agreement.service_name}</td><td className="p-3">{row.job?.status === "Completed" ? "Completed" : row.status}</td><td className="p-3">{row.job?.job_number || "—"}</td><td className="p-3"><div className="flex flex-wrap gap-1">{canCreateJobs && row.agreement.status === "Active" && !row.job_id && row.status === "Scheduled" && <button className={secondary} onClick={() => void act(() => createJobFromOccurrence(row.id), "Job created.")}>Create Job</button>}{row.job_id && <a className={secondary} href={`/jobs?jobId=${row.job_id}`}>View Job</a>}{canManage && row.agreement.status === "Active" && !row.job_id && <><button className={secondary} onClick={() => { const next = prompt("New date", row.scheduled_date); if (next) void act(() => rescheduleOccurrence(row.id, next, row.scheduled_start_time), "Rescheduled."); }}>Reschedule</button><button className={secondary} onClick={() => void act(() => skipOccurrence(row.id), "Skipped.")}>Skip</button><button className={secondary} onClick={() => void act(() => cancelOccurrence(row.id), "Cancelled.")}>Cancel</button></>}{canManage&&row.agreement.status==="Active"&&!row.job_id&&row.status==="Scheduled"&&<button className="rounded-lg border border-red-300 px-3 py-2 text-xs font-bold text-red-700" onClick={()=>remove(row)}>Delete Upcoming Service</button>}</div></td></tr>)}</tbody></table>{!rows.length && <p className="p-8 text-center">No upcoming services.</p>}</div></section>; }

function AgreementForm({ value, proposal, settings, close, saved }: { value: AgreementWithRelations | null; proposal: ProposalWithRelations | null; settings: BusinessSettings | null; close: () => void; saved: () => Promise<void> }) {
  const operationalEdit = Boolean(value && value.status !== "Draft");
  const signedEdit = Boolean(value?.client_signed_at);
  const [draft, setDraft] = useState<AgreementInput>(value ? pick(value) : proposal ? proposalBlank(proposal,settings?.default_service_agreement_terms,settings?.default_cancellation_terms) : blank(settings?.default_service_agreement_terms,settings?.default_cancellation_terms)); const [clients, setClients] = useState<Client[]>([]); const [properties, setProperties] = useState<PropertyWithClient[]>([]); const [crews, setCrews] = useState<CrewWithRelations[]>([]); const [services, setServices] = useState<CatalogService[]>([]); const [rules, setRules] = useState<RecurringPricingRule[]>([]); const [selectedServiceId, setSelectedServiceId] = useState("");const [selectedRuleId,setSelectedRuleId]=useState(proposal?.result.recurringPricingRuleId??value?.pricing_snapshot?.recurring_pricing_rule_id??""); const [basePrice,setBasePrice]=useState(proposal?.result.perVisitTotal ?? (value?.proposal_id ? value.billing_amount : value?.pricing_snapshot?.standard_service_price ?? value?.billing_amount ?? 0)); const [manualDiscount,setManualDiscount]=useState(value?.pricing_snapshot?.custom_discount_amount??0); const [pricingDirty,setPricingDirty]=useState(false); const [billingConfirmed,setBillingConfirmed]=useState(!proposal); const [scopeText, setScopeText] = useState(scopeToText(value?.scope ?? (proposal ? agreementScopeFromProposal(proposal) : []))); const [scopeDirty,setScopeDirty]=useState(false); const [error, setError] = useState<string | null>(null); const [saving,setSaving]=useState(false);
  useOperationalRealtime(["services", "recurring_pricing_rules"], async () => { const catalog = await getServiceCatalog(); setServices(catalog.services); setRules(catalog.recurringRules); });
  useEffect(() => { void Promise.all([getClients(), getProperties(), getActiveCrews(), getServiceCatalog()]).then(([nextClients, nextProperties, nextCrews, catalog]) => { setClients(nextClients); setProperties(nextProperties); setCrews(nextCrews); setServices(catalog.services); setRules(catalog.recurringRules); if (value||proposal) { const source=value??proposal!; const name=value?.service_name??proposal?.result.serviceName; setSelectedServiceId(catalog.services.find((service) => service.service_name === name && (service.division===source.division||service.division==="Both"))?.id ?? "historical"); } }).catch((cause) => setError(message(cause))); }, [proposal,value]);
  const selectedService=services.find((item)=>item.id===selectedServiceId);const matchingRules=selectedService?matchingRecurringRules(draft.frequency,rules,selectedService.id):[];const effectiveRuleId=selectedRuleId||(matchingRules.length===1?matchingRules[0].id:"");const pricingRules=matchingRules.length>1&&!effectiveRuleId?[]:rules;
  const pricing=(()=>{if(proposal)return{...proposalAgreementPricing(proposal),service_description:agreementServiceDescriptionFromProposal(proposal,services)};if(value?.proposal_id||(value&&!pricingDirty))return value.pricing_snapshot;return selectedService?catalogAgreementPricing({standardPrice:basePrice,frequency:draft.frequency,serviceId:selectedService.id,rules:pricingRules,recurringPricingRuleId:effectiveRuleId||null,customDiscount:manualDiscount,serviceDescription:selectedService.description}):value?.pricing_snapshot??null})();
  const clientRows = clients.filter((client) => client.client_type === draft.division || client.id === draft.client_id);
  const propertyRows = properties.filter((property) => property.client_id === draft.client_id && (property.property_type === draft.division || property.id === draft.property_id));
  function set<K extends keyof AgreementInput>(key: K, value: AgreementInput[K]) { setDraft((current) => ({ ...current, [key]: value })); }
  function selectService(serviceId: string) { const service = services.find((item) => item.id === serviceId); if (!service) return; setSelectedServiceId(service.id);setSelectedRuleId(""); set("service_name", service.service_name); if (!operationalEdit) setPricingDirty(true); }
  function selectFrequency(frequency: AgreementInput["frequency"]) { if (value?.proposal_id && !operationalEdit) return; const interval = frequency === "Biweekly" ? 2 : frequency === "Every 4 Weeks" ? 4 : 1;setSelectedRuleId(""); setDraft((current) => ({ ...current, frequency, days_of_week: ["Weekly", "Biweekly", "Every 4 Weeks", "Multiple Days Per Week"].includes(frequency) ? current.days_of_week : [], interval_weeks: interval, day_of_month: frequency === "Monthly" ? current.day_of_month : null, custom_interval_days: frequency === "Custom" ? current.custom_interval_days : null })); if (!operationalEdit) setPricingDirty(true); }
  async function save() { try { setError(null); setSaving(true); if(proposal&&!billingConfirmed)throw new Error("Select and confirm a Billing Type.");if(!proposal&&draft.billing_type==="Per Visit"&&matchingRules.length>1&&!effectiveRuleId)throw new Error("Select the recurring pricing rule for this Agreement."); const contract=draft.billing_type!=="Per Visit"; const nextDraft = { ...draft, billing_amount:operationalEdit&&value?value.billing_amount:contract?basePrice:pricing?.final_per_visit_price??draft.billing_amount, pricing_snapshot:operationalEdit&&value?value.pricing_snapshot:pricing, scope: scopeDirty ? scopeFromText(scopeText, draft.scope) : draft.scope }; if(proposal){await createAgreementFromProposal(proposal.id,{startDate:nextDraft.start_date,endDate:nextDraft.end_date,daysOfWeek:nextDraft.days_of_week,intervalWeeks:nextDraft.interval_weeks,dayOfMonth:nextDraft.day_of_month,customIntervalDays:nextDraft.custom_interval_days,billingType:nextDraft.billing_type,billingAmount:nextDraft.billing_type==="Per Visit"?null:basePrice,assignedCrewId:nextDraft.assigned_crew_id,defaultStartTime:nextDraft.default_start_time,scope:nextDraft.scope});await saved();return} const selectedClient=clients.find((row)=>row.id===nextDraft.client_id); const selectedProperty=properties.find((row)=>row.id===nextDraft.property_id); const selectedService=services.find((row)=>row.id===selectedServiceId); const validation=validateAgreementConfiguration(nextDraft,selectedClient,selectedProperty,selectedService,Boolean(value&&["Active","Paused"].includes(value.status))); if(validation)throw new Error(validation); if (value) await saveAgreementEdits(value.id, nextDraft); else await createAgreement(nextDraft); await saved(); } catch (cause) { setError(message(cause)); } finally { setSaving(false); } }
  return <Modal close={close}><h2 className="mb-4 text-2xl font-bold text-[#143d1a]">{proposal ? "Review Accepted Proposal Agreement" : value ? "Edit Agreement" : "New Agreement"}</h2>{proposal&&<div className="mb-5 rounded-xl border border-[#d4af37]/50 bg-[#fffdf4] p-4"><p className="font-bold text-[#143d1a]">Accepted Proposal Authority</p><div className="mt-3 grid gap-2 text-sm sm:grid-cols-2"><p><b>Customer Requested Service Date:</b> {proposal.requested_date||"—"}</p><p><b>Accepted Per-Visit Price:</b> {money(proposal.result.perVisitTotal)}</p><p><b>Service Description:</b> {agreementServiceDescriptionFromProposal(proposal,services)||"—"}</p><p><b>Frequency:</b> {proposal.frequency}</p></div><p className="mt-3 text-xs text-neutral-600">The requested date is customer context, not a confirmed schedule. Confirm the Agreement Start Date and recurrence below.</p>{proposal.result.adjustments.length>0&&<div className="mt-3"><p className="text-xs font-bold uppercase tracking-wide text-[#9a7a17]">Add-Ons</p><div className="mt-2 flex flex-wrap gap-2">{proposal.result.adjustments.map(item=><span key={item.id} className="rounded-full bg-white px-3 py-1 text-xs font-semibold">{item.label}</span>)}</div></div>}</div>}<div className="grid gap-3 sm:grid-cols-2">
    <Select disabled={operationalEdit||Boolean(proposal)} label={draft.division === "Commercial" ? "Company / Client" : "Client"} value={draft.client_id || ""} set={(next) => { set("client_id", next); set("property_id", ""); }} rows={clientRows.map((row) => [row.id, clientOption(row)])}/><Select disabled={operationalEdit||Boolean(proposal)} label={draft.division === "Commercial" ? "Commercial Property / Site" : "Property"} value={draft.property_id || ""} set={(next) => set("property_id", next)} rows={propertyRows.map((row) => [row.id, row.property_name || row.address])}/>
    <Field disabled={Boolean(proposal)} label="Agreement Name" value={draft.agreement_name} set={(next) => set("agreement_name", next)}/><Select disabled={operationalEdit||Boolean(proposal)} label="Division" value={draft.division} set={(next) => {setDraft((current)=>({...current,division:next as AgreementInput["division"],client_id:"",property_id:"",service_name:""}));setSelectedServiceId("");setPricingDirty(true);}} rows={[["Residential", "Residential"], ["Commercial", "Commercial"]]}/><Select disabled={signedEdit||Boolean(proposal)} label="Service" value={selectedServiceId} set={selectService} rows={[...((value||proposal) && !services.some((service) => service.service_name === (value?.service_name??proposal?.result.serviceName)) ? [["historical", `${value?.service_name??proposal?.result.serviceName} (historical)`]] : []), ...services.filter((service)=>service.division===draft.division||service.division==="Both").map((service) => [service.id, `${service.service_name} · ${service.category} · ${service.division}`])]}/><div/>
    {draft.division === "Commercial" && <p className="sm:col-span-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-[#143d1a]">Commercial agreements require a Commercial client with a company name, a Commercial property/site, and a Commercial or Both service.</p>}
    <div className="sm:col-span-2"><b className="block text-sm text-[#143d1a]">Service Description</b><p className="mt-1 min-h-20 whitespace-pre-line rounded-lg border bg-neutral-50 px-3 py-3 text-sm text-neutral-700">{pricing?.service_description||"No service description available."}</p></div><label className="sm:col-span-2">Included Services / Cleaning Specifications<span className="mt-1 block text-xs text-neutral-500">Use for contractual details beyond the Service Description. Purchased extras remain under Add-Ons.</span><textarea className="mt-2 min-h-36 w-full rounded-lg border px-3 py-3" value={scopeText} disabled={signedEdit} onChange={(event) => { setScopeText(event.target.value); setScopeDirty(true); }}/></label>
    <Select disabled={Boolean(proposal)} label="Frequency" value={draft.frequency} set={(next) => selectFrequency(next as AgreementInput["frequency"])} rows={AGREEMENT_FREQUENCIES.map((row) => [row, row])}/>{!proposal&&draft.billing_type==="Per Visit"&&matchingRules.length>0?<Select disabled={operationalEdit} label="Pricing Rule" value={effectiveRuleId} set={setSelectedRuleId} rows={matchingRules.map(rule=>[rule.id,rule.rule_name??`${rule.frequency} rule (historical)`])}/>:<div/>}
    <Field label="Agreement Start Date" type="date" value={draft.start_date} set={(next) => set("start_date", next)}/><Field label="End Date" type="date" value={draft.end_date || ""} set={(next) => set("end_date", next || null)}/><Select disabled={operationalEdit} label="Billing Type (Required)" value={proposal&&!billingConfirmed?"":draft.billing_type} set={(next) => {set("billing_type",next as AgreementInput["billing_type"]);setBillingConfirmed(Boolean(next));if(proposal)setBasePrice(next==="Per Visit"?proposal.result.perVisitTotal:0)}} rows={AGREEMENT_BILLING_TYPES.map((row) => [row, row])}/><Field label={billingLabel(draft.billing_type)} type="number" value={String(basePrice)} set={(next)=>{setBasePrice(Number(next));setPricingDirty(true)}} disabled={operationalEdit||(Boolean(value?.proposal_id)&&draft.billing_type==="Per Visit")||(Boolean(proposal)&&draft.billing_type==="Per Visit")}/><Field label="Manual / Custom Discount" type="number" value={String(manualDiscount)} set={(next)=>{setManualDiscount(Number(next));setPricingDirty(true)}} disabled={operationalEdit||Boolean(value?.proposal_id)||Boolean(proposal)||draft.billing_type!=="Per Visit"}/>
    <Select label="Crew" value={draft.assigned_crew_id || ""} set={(next) => set("assigned_crew_id", next || null)} rows={crews.map((row) => [row.id, row.crew_name])}/><Field label="Start Time" type="time" value={draft.default_start_time || ""} set={(next) => set("default_start_time", next || null)}/><Field label="Estimated Duration" type="number" value={draft.estimated_duration === null ? "" : String(draft.estimated_duration)} set={(next) => set("estimated_duration", next ? Number(next) : null)}/><Field disabled={operationalEdit} label="Payment Terms" value={draft.payment_terms || ""} set={(next) => set("payment_terms", next || null)}/><Field disabled={operationalEdit} label="Agreement Terms" value={draft.agreement_terms || ""} set={(next) => set("agreement_terms", next || null)}/><Field disabled={operationalEdit} label="Cancellation Terms" value={draft.cancellation_terms || ""} set={(next) => set("cancellation_terms", next || null)}/><Field label="Special Instructions" value={draft.special_instructions || ""} set={(next) => set("special_instructions", next || null)}/><Field label="Notes" value={draft.notes || ""} set={(next) => set("notes", next || null)}/>
  </div>{value&&["Active","Paused"].includes(value.status)&&<p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Changes reconcile future occurrences without jobs. Existing jobs, invoices, payments, signed snapshots, and historical occurrences remain unchanged.</p>}{draft.billing_type==="Per Visit"&&<AgreementPricingBreakdown pricing={pricing}/>}<RecurrenceControls draft={draft} set={set}/><BillingGuidance billingType={draft.billing_type}/><label className="mt-3 block"><input type="checkbox" checked={draft.auto_renew} onChange={(event) => set("auto_renew", event.target.checked)}/> Auto Renew</label>{error && <Alert text={error}/>}<button disabled={saving} className={`${primary} mt-4`} onClick={() => void save()}>{saving?"Saving...":"Save Agreement"}</button></Modal>;
}

function RecurrenceControls({ draft, set }: { draft: AgreementInput; set: <K extends keyof AgreementInput>(key: K, value: AgreementInput[K]) => void }) {
  const usesWeekdays = ["Weekly", "Biweekly", "Every 4 Weeks", "Multiple Days Per Week"].includes(draft.frequency);
  return <div className="mt-4 rounded-xl border border-green-100 bg-green-50/50 p-4"><h3 className="font-bold text-[#143d1a]">Recurrence Schedule</h3>
    {usesWeekdays && <div className="mt-3 flex flex-wrap gap-3">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, day) => <label key={label} className="rounded-lg border bg-white px-3 py-2 text-sm"><input type="checkbox" checked={draft.days_of_week.includes(day as Weekday)} onChange={(event) => set("days_of_week", event.target.checked ? [...draft.days_of_week, day as Weekday].sort() as Weekday[] : draft.days_of_week.filter((value) => value !== day))}/> {label}</label>)}</div>}
    {draft.frequency === "Multiple Days Per Week" && <div className="max-w-xs"><Field label="Repeat Every Number of Weeks" type="number" value={String(draft.interval_weeks)} set={(next) => set("interval_weeks", Number(next))}/></div>}
    {draft.frequency === "Biweekly" && <p className="mt-3 text-sm text-neutral-600">Repeats every 2 weeks on the selected day(s).</p>}
    {draft.frequency === "Every 4 Weeks" && <p className="mt-3 text-sm text-neutral-600">Repeats every 4 weeks on the selected day(s).</p>}
    {draft.frequency === "Monthly" && <div className="max-w-xs"><Field label="Day of Month" type="number" value={draft.day_of_month === null ? "" : String(draft.day_of_month)} set={(next) => set("day_of_month", next ? Number(next) : null)}/><p className="mt-2 text-xs text-neutral-600">Services scheduled for the 29th–31st occur only in months containing that date.</p></div>}
    {draft.frequency === "Custom" && <div className="max-w-xs"><Field label="Repeat Every Number of Days" type="number" value={draft.custom_interval_days === null ? "" : String(draft.custom_interval_days)} set={(next) => set("custom_interval_days", next ? Number(next) : null)}/></div>}
    {!usesWeekdays && !["Monthly", "Custom"].includes(draft.frequency) && <p className="mt-2 text-sm text-neutral-600">{draft.frequency === "One-Time" ? "One service date will be scheduled from the agreement start date." : "Service repeats daily from the agreement start date."}</p>}
  </div>;
}
function BillingGuidance({ billingType }: { billingType: AgreementInput["billing_type"] }) {
  if (billingType === "Per Visit") return <p className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm"><b>Per Visit:</b> billing amount is copied to each generated service job.</p>;
  const contract = billingType === "Monthly" ? "monthly contract amount" : billingType === "Flat Contract" ? "total contract amount" : `${billingType.toLowerCase()} contract amount`;
  return <p className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-[#143d1a]"><b>{billingType}:</b> billing amount represents the {contract}. Operational occurrence Jobs carry no contract charge; invoices are generated manually from the Agreement.</p>;
}

function ContractBilling({agreement,canCreateInvoices,close}:{agreement:AgreementWithRelations;canCreateInvoices:boolean;close:()=>void}) {
  const [summary,setSummary]=useState<AgreementFinancialSummary|null>(null),[invoices,setInvoices]=useState<InvoiceWithRelations[]>([]),[month,setMonth]=useState(()=>eligibleBillingMonth(agreement)),[periodStart,setPeriodStart]=useState(()=>eligibleBillingPeriod(agreement)),[amount,setAmount]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[success,setSuccess]=useState<string|null>(null);
  async function load(){const [nextSummary,nextInvoices]=await Promise.all([getAgreementFinancialSummary(agreement.id),getAgreementInvoices(agreement.id)]);setSummary(nextSummary);setInvoices(nextInvoices);if(agreement.billing_type==="Flat Contract")setAmount(nextSummary.remaining??0)}
  // Initial modal hydration; realtime callbacks refresh without replacing Agreement form state.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(()=>{void load().catch(cause=>setError(message(cause)))},[agreement.id]);
  useOperationalRealtime(["invoices","payments"],load);
  async function create(){setError(null);setSuccess(null);if(!canCreateInvoices){setError("Invoice creation permission is required.");return}if(agreement.status!=="Active"){setError("Only Active agreements can create contract invoices.");return}setBusy(true);try{if(agreement.billing_type==="Weekly")await createWeeklyContractInvoice({agreementId:agreement.id,billingPeriodStart:periodStart});else if(agreement.billing_type==="Biweekly")await createBiweeklyContractInvoice({agreementId:agreement.id,billingPeriodStart:periodStart});else if(agreement.billing_type==="Monthly")await createMonthlyContractInvoice({agreementId:agreement.id,billingMonth:month});else if(agreement.billing_type==="Flat Contract")await createFlatContractInvoice({agreementId:agreement.id,amount});else throw new Error("Per Visit Agreements are invoiced from completed Jobs.");await load();setSuccess("Contract invoice generated successfully.")}catch(cause){setError(message(cause))}finally{setBusy(false)}}
  const selectedPeriod=agreement.billing_type==="Monthly"?`${month}-01`:periodStart,already=agreement.billing_type!=="Flat Contract"&&invoices.some(row=>row.contract_billing_type===agreement.billing_type&&row.billing_period_start===selectedPeriod&&!row.archived_at&&!["Cancelled","Archived"].includes(row.status));
  const monthValid=/^\d{4}-(0[1-9]|1[0-2])$/.test(month),periodValid=/^\d{4}-\d{2}-\d{2}$/.test(periodStart),disabled=busy||already||agreement.status!=="Active"||(agreement.billing_type==="Monthly"&&!monthValid)||(["Weekly","Biweekly"].includes(agreement.billing_type)&&!periodValid);
  const periodType=["Weekly","Biweekly"].includes(agreement.billing_type);
  return <Modal close={close}><h2 className="text-2xl font-bold text-[#143d1a]">Contract Billing</h2><p className="mt-1 text-sm text-neutral-500">{agreement.agreement_number} · {agreement.agreement_name}</p>{summary&&<div className="mt-5 grid gap-3 sm:grid-cols-2"><Card label="Billing Type" value={agreement.billing_type}/><Card label={billingLabel(agreement.billing_type)} value={money(summary.contractAmount)}/><Card label="Total Invoiced" value={money(summary.invoiced)}/><Card label="Total Paid" value={money(summary.paid)}/><Card label="Outstanding" value={money(summary.outstanding)}/>{summary.remaining!==null&&<Card label="Remaining Contract Value" value={money(summary.remaining)}/>}</div>}<div className="mt-5 rounded-xl border p-4">{periodType?<><Field label={`${agreement.billing_type} Billing Period Start`} type="date" value={periodStart} set={setPeriodStart}/><p className="mt-2 text-xs text-neutral-600">Billing periods are anchored to the Agreement start date ({agreement.start_date}). The server rejects dates outside that cadence.</p></>:agreement.billing_type==="Monthly"?<Field label="Billing Month" type="month" value={month} set={setMonth}/>:<Field label="Progress Invoice Amount" type="number" value={String(amount)} set={value=>setAmount(Number(value))}/>} {already&&<p className="mt-2 text-sm font-bold text-amber-700">This period already has an active contract invoice.</p>} {error&&<Alert text={error}/>} {success&&<Alert text={success} good/>} {canCreateInvoices&&<button className={`${primary} mt-4`} disabled={disabled} onClick={()=>void create()}>{busy?"Generating...":agreement.billing_type==="Weekly"?"Create Weekly Invoice":agreement.billing_type==="Biweekly"?"Create Biweekly Invoice":agreement.billing_type==="Monthly"?"Create Monthly Invoice":"Create Progress Invoice"}</button>}</div></Modal>;
}

function eligibleBillingMonth(agreement:AgreementWithRelations){const current=dateOnly().slice(0,7),start=agreement.start_date.slice(0,7),end=agreement.end_date?.slice(0,7);return current<start?start:end&&current>end?end:current;}
function eligibleBillingPeriod(agreement:AgreementWithRelations){const length=agreement.billing_type==="Biweekly"?14:7,current=dateOnly(),target=agreement.end_date&&current>agreement.end_date?agreement.end_date:current;if(target<=agreement.start_date)return agreement.start_date;const elapsed=Math.floor((new Date(`${target}T12:00:00`).getTime()-new Date(`${agreement.start_date}T12:00:00`).getTime())/86400000);return addDays(agreement.start_date,Math.floor(elapsed/length)*length);}

function blank(defaultAgreementTerms?: string | null,defaultCancellationTerms?:string|null): AgreementInput { return { client_id: "", property_id: "", proposal_id: null, division: "Residential", agreement_name: "", service_name: "", frequency: "Weekly", days_of_week: [], interval_weeks: 1, day_of_month: null, custom_interval_days: null, start_date: dateOnly(), end_date: null, auto_renew: false, billing_type: "Per Visit", billing_amount: 0, payment_terms: null, agreement_terms: defaultAgreementTerms || null, cancellation_terms: defaultCancellationTerms||null, scope: [], special_instructions: null, assigned_crew_id: null, default_start_time: null, estimated_duration: null, status: "Draft", notes: null }; }
function proposalBlank(proposal:ProposalWithRelations,defaultAgreementTerms?:string|null,defaultCancellationTerms?:string|null):AgreementInput { const requested=proposal.requested_date?new Date(`${proposal.requested_date}T12:00:00`):null;const suggestedDay=requested?.getDay() as Weekday|undefined;return {client_id:proposal.client_id,property_id:proposal.property_id,proposal_id:proposal.id,division:proposal.division,agreement_name:`${proposal.result.serviceName} Service Agreement`,service_name:proposal.result.serviceName,frequency:proposal.frequency,days_of_week:["Weekly","Biweekly"].includes(proposal.frequency)&&suggestedDay!==undefined?[suggestedDay]:[],interval_weeks:proposal.frequency==="Biweekly"?2:1,day_of_month:proposal.frequency==="Monthly"&&requested?requested.getDate():null,custom_interval_days:null,start_date:"",end_date:null,auto_renew:false,billing_type:"Per Visit",billing_amount:proposal.result.perVisitTotal,payment_terms:proposal.result.terms.paymentTerms,agreement_terms:defaultAgreementTerms||null,cancellation_terms:defaultCancellationTerms||null,scope:agreementScopeFromProposal(proposal),special_instructions:proposal.result.terms.accessRequirements||null,assigned_crew_id:null,default_start_time:null,estimated_duration:proposal.result.estimatedDuration,status:"Draft",notes:proposal.notes}; }
function pick(value: AgreementWithRelations): AgreementInput { const { id: _id, agreement_number: _number, sent_at: _sentAt, sent_to: _sentTo, sent_by: _sentBy, accepted_at: _acceptedAt, client_access_token: _token, client_access_token_expires_at: _expires, client_signed_at: _signedAt, client_signed_name: _signedName, client_signature: _signature, client_signed_snapshot: _snapshot, client_consent_text: _consentText, client_consent_at: _consentAt, created_at: _created, updated_at: _updated, archived_at: _archived, client: _client, property: _property, proposal: _proposal, crew: _crew, ...inputValue } = value; return inputValue; }
function Modal({ close, children }: { close: () => void; children: React.ReactNode }) { return <div className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-4 print:static print:block print:bg-white print:p-0"><section className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-white p-6 print:max-h-none print:max-w-none print:overflow-visible print:p-0"><button className="float-right text-xl print:hidden" onClick={close}>×</button>{children}</section></div>; }
function Field({ label, value, set, type = "text", disabled = false }: { label: string; value: string; set: (value: string) => void; type?: string; disabled?: boolean }) { if (label === "Agreement Terms") return <label className="mt-3 block sm:col-span-2">{label}<textarea className="mt-1 min-h-64 w-full rounded-lg border px-3 py-3" value={value} disabled={disabled} onChange={(event) => set(event.target.value)}/></label>; return <label className="mt-3 block">{label}<input className={input} type={type} value={value} disabled={disabled} onChange={(event) => set(event.target.value)}/>{type === "time" && <span className="mt-1 block text-xs font-semibold text-neutral-500">Service Time: {formatTime12Hour(value)}</span>}</label>; }
function Select({ label, value, set, rows, disabled = false }: { label: string; value: string; set: (value: string) => void; rows: string[][]; disabled?: boolean }) { return <label>{label}<select className={input} value={value} disabled={disabled} onChange={(event) => set(event.target.value)}><option value="">Select</option>{rows.map((row) => <option key={row[0]} value={row[0]}>{row[1]}</option>)}</select></label>; }
function Alert({ text, good = false }: { text: string; good?: boolean }) { return <p className={`mt-4 rounded p-3 ${good ? "bg-green-50" : "bg-red-50"}`}>{text}</p>; }
function Card({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border bg-white p-4"><small>{label}</small><b className="block">{value}</b></div>; }
function clientName(agreement: AgreementWithRelations) { return agreement.client?.company_name || [agreement.client?.first_name, agreement.client?.last_name].filter(Boolean).join(" ") || "Deleted Client"; }
function clientOption(client: Client) { const contact=[client.first_name,client.last_name].filter(Boolean).join(" "); return client.company_name ? `${client.company_name}${contact ? ` (${contact})` : ""}` : contact || "Unnamed Client"; }
function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value); }
function billingLabel(type:AgreementInput["billing_type"]){return type==="Per Visit"?"Per Visit Amount":type==="Weekly"?"Weekly Contract Amount":type==="Biweekly"?"Biweekly Contract Amount":type==="Monthly"?"Monthly Contract Amount":"Contract Value";}
function dateOnly() { return new Date().toISOString().slice(0, 10); }
function addDays(value: string, days: number) { const date = new Date(`${value}T12:00:00`); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10); }
function message(cause: unknown) { console.error(cause); if (cause instanceof Error) return cause.message; if (cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string") return cause.message; return "Operation failed."; }
function scopeToText(scope: AgreementInput["scope"]) { return scope.map((item) => item.text).join("\n"); }
function scopeFromText(text: string, existing: AgreementInput["scope"]): AgreementInput["scope"] { return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => ({ id: existing[index]?.id || `scope-${Date.now()}-${index + 1}`, text: line })); }
function generateSecureToken() { const bytes = new Uint8Array(32); window.crypto.getRandomValues(bytes); return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""); }
function exportAgreements(rows: AgreementWithRelations[], occurrences: ServiceOccurrenceWithRelations[]) { download("agreements.csv", [["Agreement Number", "Client", "Property", "Service", "Frequency", "Start Date", "End Date", "Status", "Billing Type", "Billing Amount", "Crew", "Next Service"], ...rows.map((row) => [row.agreement_number, clientName(row), row.property?.address || "Deleted Property", row.service_name, row.frequency, row.start_date, row.end_date || "", row.status, row.billing_type, String(row.billing_amount), row.crew?.crew_name || "", occurrences.find((occurrence) => occurrence.agreement_id === row.id && occurrence.scheduled_date >= dateOnly())?.scheduled_date || ""])]); }
function exportOccurrences(rows: ServiceOccurrenceWithRelations[]) { download("upcoming-services.csv", [["Date", "Agreement", "Service", "Status", "Job"], ...rows.map((row) => [row.scheduled_date, row.agreement.agreement_number, row.agreement.service_name, row.status, row.job?.job_number || ""])]); }
function download(name: string, rows: string[][]) { const url = URL.createObjectURL(new Blob([rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\n")], { type: "text/csv" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url); }
const input = "mt-1 h-11 w-full rounded-lg border px-3";
const primary = "rounded-lg bg-[#143d1a] px-4 py-2 text-sm font-bold text-white disabled:opacity-50";
const secondary = "rounded-lg border px-2 py-1 text-xs font-bold text-[#143d1a]";
