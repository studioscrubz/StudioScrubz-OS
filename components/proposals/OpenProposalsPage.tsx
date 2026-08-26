"use client";
import { useEffect, useMemo, useState } from "react";
import { ProposalBuilder } from "./ProposalBuilder";
import {
  PROPOSAL_JOB_CREATED_EVENT,
  ProposalJobAction,
} from "@/components/jobs/ProposalJobAction";
import { ProposalAgreementAction } from "@/components/agreements/ProposalAgreementAction";
import { isRecurringFrequency } from "@/lib/scheduling/frequency";
import { getJobProposalIds } from "@/lib/services/jobs";
import { useAuth } from "@/components/auth/AuthProvider";
import { canManageProposalPricingPhotos, hasPermission } from "@/lib/auth/permissions";
import {
  ACCEPTANCE_METHODS,
  APPROVAL_STATUSES,
  PROPOSAL_STATUSES,
  type ProposalAcceptanceMethod,
  type ProposalApprovalStatus,
  type ProposalHistory,
  type ProposalStatus,
  type ProposalWithRelations,
} from "@/types/proposal";
import {
  approveProposal,
  archiveProposal,
  expireDueProposals,
  getProposalHistory,
  getProposals,
  markProposalAccepted,
  markProposalDeclined,
  markProposalSent,
  markProposalViewed,
  rejectProposal,
  renewProposal,
  requestProposalChanges,
  submitProposalForApproval,
} from "@/lib/services/proposals";
import { deliverDocument } from "@/lib/services/unifiedDocumentDelivery";
import { getPublicSiteUrl } from "@/lib/publicSiteUrl";
import { clientTokenExpiration, generateSecureClientToken, validClientToken } from "@/lib/secureClientToken";
import { StudioScrubzLogo } from "@/components/branding/StudioScrubzLogo";
import { ProposalDocument, proposalDeliverySnapshot, proposalDocumentFromRecord } from "./ProposalDocument";
import { ProposalPricingPhotos } from "./ProposalPricingPhotos";
import { useOperationalRealtime } from "@/components/realtime/OperationalRealtimeProvider";
type Sort =
  | "Newest"
  | "Oldest"
  | "Client Name"
  | "Proposal Number"
  | "Expiration Date"
  | "Price High to Low"
  | "Price Low to High";
const columns: ProposalStatus[] = [
  "Draft",
  "Ready for Approval",
  "Approved",
  "Sent",
  "Accepted",
  "Declined",
  "Expired",
  "Archived",
];
export function OpenProposalsPage() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<ProposalWithRelations[]>([]);
  const [jobProposalIds, setJobProposalIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"All" | ProposalStatus>("All");
  const [division, setDivision] = useState("All");
  const [approval, setApproval] = useState<"All" | ProposalApprovalStatus>(
    "All",
  );
  const [sort, setSort] = useState<Sort>("Newest");
  const [view, setView] = useState<ProposalWithRelations | null>(null);
  const [edit, setEdit] = useState<ProposalWithRelations | null>(null);
  const [accepting, setAccepting] = useState<ProposalWithRelations | null>(
    null,
  );
  const [history, setHistory] = useState<{
    p: ProposalWithRelations;
    rows: ProposalHistory[];
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sending, setSending] = useState<ProposalWithRelations | null>(null);
  useEffect(() => {
    let active = true;
    void loadPageData()
      .then(({ proposals, proposalIds }) => {
        if (active) {
          setRows(proposals);
          setJobProposalIds(new Set(proposalIds));
        }
      })
      .catch((x: unknown) => {
        console.error("Proposal load failed", x);
        if (active) setError(msg(x, "Proposals could not be loaded."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function refresh(text?: string) {
    const { proposals, proposalIds } = await loadPageData();
    setRows(proposals);
    setJobProposalIds(new Set(proposalIds));
    if (text) setNotice(text);
  }
  useOperationalRealtime(["proposals", "jobs", "service_agreements"], refresh);
  async function mutate(
    p: ProposalWithRelations,
    fn: () => Promise<unknown>,
    text: string,
  ) {
    setBusy(p.id);
    setError(null);
    try {
      await fn();
      await refresh(text);
    } catch (x) {
      console.error("Proposal mutation failed", x);
      setError(msg(x, "Proposal action failed."));
    } finally {
      setBusy(null);
    }
  }
  useEffect(() => {
    const handleJobCreated = () => {
      void refresh("Job created successfully.").catch((x: unknown) => {
        console.error("Proposal refresh after Job creation failed", x);
        setError(
          msg(x, "Job was created, but proposals could not be refreshed."),
        );
      });
    };
    window.addEventListener(PROPOSAL_JOB_CREATED_EVENT, handleJobCreated);
    return () =>
      window.removeEventListener(PROPOSAL_JOB_CREATED_EVENT, handleJobCreated);
  }, []);
  const visibleRows = useMemo(
    () =>
      rows.filter((p) => p.status !== "Accepted" || !jobProposalIds.has(p.id)),
    [jobProposalIds, rows],
  );
  const filtered = useMemo(
    () =>
      visibleRows
        .filter((p) => {
          const hay = [
            p.proposal_number,
            p.client_name,
            p.property_name,
            p.customer_phone,
            p.customer_email,
            p.result.serviceName,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return (
            (!search || hay.includes(search.toLowerCase())) &&
            (status === "All" || p.status === status) &&
            (division === "All" || p.division === division) &&
            (approval === "All" || p.approval_status === approval)
          );
        })
        .sort((a, b) => compare(a, b, sort)),
    [approval, division, search, sort, status, visibleRows],
  );
  const summary = {
    total: visibleRows.filter((p) => !p.archived_at).length,
    pending: visibleRows.filter((p) => p.approval_status === "Pending Approval")
      .length,
    sent: visibleRows.filter(
      (p) => p.status === "Sent" || p.status === "Viewed",
    ).length,
    accepted: visibleRows.filter((p) => p.status === "Accepted").length,
    expired: visibleRows.filter((p) => p.status === "Expired").length,
  };
  async function showHistory(p: ProposalWithRelations) {
    try {
      setHistory({ p, rows: await getProposalHistory(p.id) });
    } catch (x) {
      setError(msg(x, "History could not be loaded."));
    }
  }
  return (
    <>
      {<Header />}
      {notice && <Alert text={notice} success />}
      {error && <Alert text={error} />}
      <section className="mt-7 grid grid-cols-2 gap-4 xl:grid-cols-5">
        <Summary l="Total Proposals" v={loading ? "—" : summary.total} />
        <Summary l="Pending Approval" v={loading ? "—" : summary.pending} />
        <Summary l="Sent" v={loading ? "—" : summary.sent} />
        <Summary l="Accepted" v={loading ? "—" : summary.accepted} />
        <Summary l="Expired" v={loading ? "—" : summary.expired} />
      </section>
      <section className="mt-6 rounded-2xl border bg-white p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_170px_170px_180px_190px]">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search proposals"
            className={input}
          />
          <Filter
            v={status}
            set={(v) => setStatus(v as typeof status)}
            opts={["All", ...PROPOSAL_STATUSES]}
          />
          <Filter
            v={division}
            set={setDivision}
            opts={["All", "Residential", "Commercial"]}
          />
          <Filter
            v={approval}
            set={(v) => setApproval(v as typeof approval)}
            opts={["All", ...APPROVAL_STATUSES]}
          />
          <Filter
            v={sort}
            set={(v) => setSort(v as Sort)}
            opts={[
              "Newest",
              "Oldest",
              "Client Name",
              "Proposal Number",
              "Expiration Date",
              "Price High to Low",
              "Price Low to High",
            ]}
          />
        </div>
      </section>
      {loading ? (
        <Loading />
      ) : (
        <Pipeline
          rows={filtered}
          busy={busy}
          view={setView}
          edit={setEdit}
          accept={setAccepting}
          history={(p) => void showHistory(p)}
          send={setSending}
          mutate={mutate}
        />
      )}{" "}
      {view && <SharedProposalPreview p={view} close={() => setView(null)} />}{" "}
      {edit && (
        <EditModal
          p={edit}
          close={() => setEdit(null)}
          saved={() => {
            setEdit(null);
            void refresh("Proposal updated.");
          }}
        />
      )}
      {accepting && (
        <AcceptanceModal
          proposal={accepting}
          close={() => setAccepting(null)}
          saved={() => {
            setAccepting(null);
            void refresh("Proposal accepted.");
          }}
        />
      )}
      {history && (
        <HistoryModal data={history} close={() => setHistory(null)} />
      )}
      {sending && <SendProposalModal proposal={sending} sender={profile?.display_name||profile?.email||"StudioScrubz User"} close={()=>setSending(null)} sent={(notice)=>{setSending(null);void refresh(notice)}} />}
    </>
  );
}
function Pipeline({
  rows,
  busy,
  view,
  edit,
  accept,
  history,
  send,
  mutate,
}: {
  rows: ProposalWithRelations[];
  busy: string | null;
  view: (p: ProposalWithRelations) => void;
  edit: (p: ProposalWithRelations) => void;
  accept: (p: ProposalWithRelations) => void;
  history: (p: ProposalWithRelations) => void;
  send: (p: ProposalWithRelations) => void;
  mutate: (
    p: ProposalWithRelations,
    fn: () => Promise<unknown>,
    text: string,
  ) => Promise<void>;
}) {
  return (
    <div className="mt-6 overflow-x-auto pb-4">
      <div className="grid min-w-[2100px] grid-cols-8 gap-4">
        {columns.map((c) => (
          <section key={c} className="rounded-2xl bg-[#eef1ed] p-3">
            <h2 className="mb-3 text-xs font-extrabold uppercase tracking-wider text-[#143d1a]">
              {c}{" "}
              <span className="float-right">
                {rows.filter((p) => pipelineStatus(p) === c).length}
              </span>
            </h2>
            {rows
              .filter((p) => pipelineStatus(p) === c)
              .map((p) => (
                <Card
                  key={p.id}
                  p={p}
                  busy={busy === p.id}
                  view={() => view(p)}
                  edit={() => edit(p)}
                  accept={() => accept(p)}
                  history={() => history(p)}
                  openSend={() => send(p)}
                  mutate={(fn, t) => void mutate(p, fn, t)}
                />
              ))}
          </section>
        ))}
      </div>
    </div>
  );
}
function Card({
  p,
  busy,
  view,
  edit,
  accept,
  history,
  openSend,
  mutate,
}: {
  p: ProposalWithRelations;
  busy: boolean;
  view: () => void;
  edit: () => void;
  accept: () => void;
  history: () => void;
  openSend: () => void;
  mutate: (fn: () => Promise<unknown>, text: string) => void;
}) {
  const { profile } = useAuth();
  const canApprove = hasPermission(profile, "proposals.approve");
  const canSend = hasPermission(profile, "proposals.send");
  function promptAction(kind: "changes" | "reject" | "decline" | "renew") {
    const value =
      window.prompt(
        kind === "renew"
          ? "New expiration date (YYYY-MM-DD)"
          : kind === "decline"
            ? "Decline reason"
            : "Approval notes",
      ) ?? "";
    if (kind === "changes")
      mutate(() => requestProposalChanges(p.id, value), "Changes requested.");
    if (kind === "reject")
      mutate(() => rejectProposal(p.id, value), "Proposal rejected.");
    if (kind === "decline")
      mutate(() => markProposalDeclined(p.id, value), "Proposal declined.");
    if (kind === "renew" && value)
      mutate(() => renewProposal(p.id, value), "Proposal renewed.");
  }
  return (
    <article className="mb-3 rounded-xl bg-white p-4 shadow-sm">
      <button type="button" onClick={view} className="w-full text-left">
        <p className="font-extrabold text-[#143d1a]">{p.proposal_number}</p>
        <p className="mt-1 text-sm text-neutral-600">{p.client_name}</p>
        <p className="mt-1 text-xs text-neutral-500">{p.property_name}</p>
        <p className="mt-3 text-xl font-extrabold text-[#143d1a]">
          {money(p.result.perVisitTotal)}
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          <Badge t={p.division} />
          <Badge t={p.frequency} />
          {p.status === "Viewed" && <Badge t="Viewed" />}
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          Approval: {p.approval_status}
        </p>
        <p className="text-xs text-neutral-500">Expires: {p.expiration_date}</p>
        {p.estimate_id && (
          <p className="text-xs text-[#9a7a17]">Estimate linked</p>
        )}
        {p.walkthrough_id && (
          <p className="text-xs text-[#9a7a17]">Walkthrough linked</p>
        )}
      </button>
      <div className="mt-3 flex flex-wrap gap-1 border-t pt-3">
        <Action t="Preview" f={view} />
        {p.status === "Draft" && (
          <>
            <Action t="Edit" f={edit} />
            <Action
              t={busy ? "Submitting…" : "Submit for Approval"}
              disabled={busy}
              f={() =>
                mutate(
                  () => submitProposalForApproval(p.id),
                  "Submitted for approval.",
                )
              }
            />
          </>
        )}
        {canApprove && p.status === "Ready for Approval" &&
          p.approval_status === "Pending Approval" && (
            <>
              <Action
                t={busy ? "Approving…" : "Approve"}
                disabled={busy}
                f={() =>
                  mutate(() => approveProposal(p.id), "Proposal approved.")
                }
              />
              <Action
                t="Request Changes"
                disabled={busy}
                f={() => promptAction("changes")}
              />
              <Action
                t="Reject"
                disabled={busy}
                f={() => promptAction("reject")}
              />
            </>
          )}
        {canSend && p.status === "Approved" && p.approval_status === "Approved" && (
          <>
            <Action t="Send to Client" f={openSend} />
            <Action t="Print / Save PDF" f={() => printProposal(p)} />
          </>
        )}
        {(p.status === "Sent" || p.status === "Viewed") && (
          <>
            {canSend && <Action t="Resend Proposal" f={openSend} />}
            <Action
              t="Viewed"
              f={() => mutate(() => markProposalViewed(p.id), "Marked viewed.")}
            />
            <Action t="Accept" f={accept} />
            <Action t="Decline" f={() => promptAction("decline")} />
            <Action t="Print" f={() => printProposal(p)} />
          </>
        )}
        {p.status === "Accepted" && (
          <>
            {isRecurringFrequency(p.frequency) ? <ProposalAgreementAction proposalId={p.id} /> : <ProposalJobAction proposalId={p.id} />}
            <Action t="Print / Save PDF" f={() => printProposal(p)} />
          </>
        )}{" "}
        {p.status === "Expired" && (
          <Action t="Renew" f={() => promptAction("renew")} />
        )}
        <Action t="History" f={history} />
        {p.status !== "Archived" && (
          <Action
            t={busy ? "…" : "Archive"}
            disabled={busy}
            f={() => mutate(() => archiveProposal(p.id), "Proposal archived.")}
          />
        )}
      </div>
    </article>
  );
}
function SharedProposalPreview({p,close}:{p:ProposalWithRelations;close:()=>void}){const{profile}=useAuth();return <Modal title={p.proposal_number} close={close}><ProposalDocument document={proposalDocumentFromRecord(p)}/><div className="mt-6 print:hidden"><ProposalPricingPhotos proposalId={p.id} status={p.status} canManage={canManageProposalPricingPhotos(profile)}/></div><button type="button" onClick={()=>window.print()} className="mt-5 rounded-lg bg-[#143d1a] px-4 py-2 text-sm font-bold text-white print:hidden">Print / Save PDF</button></Modal>}

function SendProposalModal({proposal,sender,close,sent}:{proposal:ProposalWithRelations;sender:string;close:()=>void;sent:(notice:string)=>void}){const email=proposal.customer_email||"";const phone=proposal.customer_phone||"";const[subject,setSubject]=useState(`StudioScrubz Proposal ${proposal.proposal_number}`);const[body,setBody]=useState(`Hello ${proposal.client?.first_name||proposal.client_name||"Client"},\n\nYour StudioScrubz Proposal is ready for review.\n\nThank you,\nStudioScrubz`);const[busy,setBusy]=useState(false);const[error,setError]=useState<string|null>(null);const token=useMemo(()=>validClientToken(proposal.client_access_token,proposal.client_access_token_expires_at)?proposal.client_access_token!:generateSecureClientToken(),[proposal]);const expiresAt=useMemo(()=>validClientToken(proposal.client_access_token,proposal.client_access_token_expires_at)?proposal.client_access_token_expires_at!:clientTokenExpiration(),[proposal]);const reviewUrl=`${getPublicSiteUrl()}/proposal/${token}`;async function submit(){if(!email&&!phone)return setError("Customer does not have an email address or phone number on file.");setBusy(true);setError(null);try{const result=await deliverDocument({documentType:"Proposal",documentId:proposal.id,documentNumber:proposal.proposal_number,clientId:proposal.client_id,propertyId:proposal.property_id,email,phone,subject:subject.trim(),messageBody:body.trim(),publicUrl:reviewUrl,publicLinkLabel:"Review Proposal",prepare:async(channel,recipient)=>{await markProposalSent(proposal.id,channel,{recipient,sender,token,expiresAt,snapshot:proposalDeliverySnapshot(proposal)})}});sent(result.message)}catch(caught){console.error("Proposal delivery failed",caught);setError(msg(caught,"Proposal delivery could not be completed."));setBusy(false)}}return <Modal title={`Send Proposal ${proposal.proposal_number}`} close={close}><div className="space-y-5"><ProposalDocument document={proposalDocumentFromRecord(proposal)}/><DeliverySummary email={email} phone={phone}/><label className="block text-sm font-bold">Subject<input className={`${input} mt-2`} value={subject} onChange={e=>setSubject(e.target.value)}/></label><label className="block text-sm font-bold">Editable Message<textarea className="mt-2 min-h-36 w-full rounded-lg border border-neutral-200 p-3 font-normal" value={body} onChange={e=>setBody(e.target.value)}/></label><div><p className="text-sm font-bold">Review Proposal</p><p className="mt-1 break-all rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600">{reviewUrl}</p></div>{error&&<p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}<div className="flex flex-wrap gap-3 print:hidden"><button type="button" disabled={busy||(!email&&!phone)} onClick={()=>void submit()} className="rounded-lg bg-[#143d1a] px-5 py-2.5 font-bold text-white disabled:opacity-50">{busy?"Sending…":proposal.sent_at?"Resend":"Send"}</button><button type="button" onClick={()=>window.print()} className="rounded-lg border px-4 py-2 font-bold text-[#143d1a]">Print / Save PDF</button><button type="button" onClick={close} className="rounded-lg border px-4 py-2 font-bold text-[#143d1a]">Cancel</button></div></div></Modal>}

function DeliverySummary({email,phone}:{email:string;phone:string}){return <div className="rounded-lg border bg-neutral-50 p-3 text-sm"><p className="font-bold text-[#143d1a]">Delivery</p><p className="mt-2">{email?`✓ Email: ${email}`:"— Email: No email address on file"}</p><p className="mt-1">{phone?`✓ Text: ${phone}`:"— Text: No phone number on file"}</p></div>}

function ViewModal({
  p,
  close,
}: {
  p: ProposalWithRelations;
  close: () => void;
}) {
  return (
    <Modal title={p.proposal_number} close={close}>
      <div className="print-proposal">
        <div className="mb-6 flex items-center gap-4 border-b-2 border-[#143d1a] pb-4"><StudioScrubzLogo size={88}/><div><h1 className="text-2xl font-extrabold text-[#143d1a]">StudioScrubz Proposal</h1><p>{p.proposal_number}</p></div></div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Details
            title="Customer"
            rows={[
              ["Client", p.client_name ?? "—"],
              ["Phone", p.customer_phone ?? "—"],
              ["Email", p.customer_email ?? "—"],
              ["Property", p.property_name ?? "—"],
            ]}
          />
          <Details
            title="Service"
            rows={[
              ["Service", p.result.serviceName],
              ["Frequency", p.frequency],
              ["Per Visit", money(p.result.perVisitTotal)],
              [
                "Monthly",
                p.result.monthlyTotal ? money(p.result.monthlyTotal) : "—",
              ],
              ["Expiration", p.expiration_date],
            ]}
          />
          <div className="sm:col-span-2">
            <h3 className="font-extrabold text-[#143d1a]">Scope</h3>
            <ul className="mt-2 list-disc pl-5 text-sm">
              {p.result.scope.map((x) => (
                <li key={x.id}>{x.text}</li>
              ))}
            </ul>
          </div>
          <Details
            title="Terms"
            rows={Object.entries(p.result.terms).map(([k, v]) => [human(k), v])}
          />
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="mt-6 rounded-lg bg-[#143d1a] px-4 py-2 text-sm font-bold text-white print:hidden"
        >
          Print / Save PDF
        </button>
      </div>
    </Modal>
  );
}
function AcceptanceModal({
  proposal,
  close,
  saved,
}: {
  proposal: ProposalWithRelations;
  close: () => void;
  saved: () => void;
}) {
  const [name, setName] = useState("");
  const [method, setMethod] =
    useState<(typeof ACCEPTANCE_METHODS)[number]>("Text Message");
  const [other, setOther] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    if (!name.trim()) return setError("Accepted By Name is required.");
    if (method === "Other" && !other.trim())
      return setError(
        "Describe Confirmation Method is required when Other is selected.",
      );
    const acceptanceMethod: ProposalAcceptanceMethod =
      method === "Other" ? `Other: ${other.trim()}` : method;
    setSaving(true);
    setError(null);
    try {
      await markProposalAccepted(proposal.id, name.trim(), acceptanceMethod);
      saved();
    } catch (x) {
      console.error("Proposal acceptance failed", x);
      setError(msg(x, "Proposal could not be accepted."));
      setSaving(false);
    }
  }
  return (
    <Modal title="Mark Proposal Accepted" close={close}>
      <div className="space-y-4">
        <label className="block text-sm font-bold text-neutral-700">
          Accepted By Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`${input} mt-2`}
            autoFocus
          />
        </label>
        <label className="block text-sm font-bold text-neutral-700">
          How was confirmation received?
          <select
            value={method}
            onChange={(e) =>
              setMethod(e.target.value as (typeof ACCEPTANCE_METHODS)[number])
            }
            className={`${input} mt-2`}
          >
            {ACCEPTANCE_METHODS.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
        {method === "Other" && (
          <label className="block text-sm font-bold text-neutral-700">
            Describe Confirmation Method
            <input
              value={other}
              onChange={(e) => setOther(e.target.value)}
              className={`${input} mt-2`}
            />
          </label>
        )}
        {error && <Alert text={error} />}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={close}
            className="rounded-lg border px-4 py-2 text-sm font-bold"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void submit()}
            className="rounded-lg bg-[#143d1a] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Mark Accepted"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
function EditModal({
  p,
  close,
  saved,
}: {
  p: ProposalWithRelations;
  close: () => void;
  saved: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[80] overflow-y-auto bg-[#07190a]/70 p-5">
      <div className="mx-auto max-w-6xl rounded-2xl bg-[#f5f6f4] p-6">
        <button onClick={close} className="float-right">
          ×
        </button>
        <ProposalBuilder proposal={p} onSaved={saved} />
      </div>
    </div>
  );
}
function HistoryModal({
  data,
  close,
}: {
  data: { p: ProposalWithRelations; rows: ProposalHistory[] };
  close: () => void;
}) {
  return (
    <Modal title={`History — ${data.p.proposal_number}`} close={close}>
      <div className="space-y-3">
        {data.rows.map((x) => (
          <div key={x.id} className="rounded-lg border p-3">
            <p className="font-bold text-[#143d1a]">{x.event_type}</p>
            <p className="text-xs text-neutral-500">
              {new Date(x.created_at).toLocaleString()} · {x.performed_by}
            </p>
            {x.description && <p className="mt-1 text-sm">{x.description}</p>}
          </div>
        ))}
      </div>
    </Modal>
  );
}
async function loadAndExpire() {
  let r = await getProposals();
  if (await expireDueProposals(r)) r = await getProposals();
  return r;
}
function pipelineStatus(p: ProposalWithRelations): ProposalStatus {
  return p.status === "Viewed" ? "Sent" : p.status;
}
function compare(a: ProposalWithRelations, b: ProposalWithRelations, s: Sort) {
  if (s === "Oldest")
    return Date.parse(a.created_at) - Date.parse(b.created_at);
  if (s === "Client Name")
    return (a.client_name ?? "").localeCompare(b.client_name ?? "");
  if (s === "Proposal Number")
    return a.proposal_number.localeCompare(b.proposal_number);
  if (s === "Expiration Date")
    return a.expiration_date.localeCompare(b.expiration_date);
  if (s === "Price High to Low")
    return b.result.perVisitTotal - a.result.perVisitTotal;
  if (s === "Price Low to High")
    return a.result.perVisitTotal - b.result.perVisitTotal;
  return Date.parse(b.created_at) - Date.parse(a.created_at);
}
async function loadPageData() {
  const [proposals, proposalIds] = await Promise.all([
    loadAndExpire(),
    getJobProposalIds(),
  ]);
  return { proposals, proposalIds };
}
function printProposal(p: ProposalWithRelations) {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(
    `<html><head><title>${p.proposal_number}</title><style>body{font-family:Arial;padding:40px;color:#143d1a}h1{border-bottom:3px solid #d4af37;padding-bottom:12px}li{margin:8px 0}</style></head><body><h1>StudioScrubz</h1><h2>Proposal ${p.proposal_number}</h2><p><b>Customer:</b> ${escapeHtml(p.client_name ?? "")}</p><p><b>Property:</b> ${escapeHtml(p.property_name ?? "")}</p><p><b>Service:</b> ${escapeHtml(p.result.serviceName)}</p><p><b>Frequency:</b> ${p.frequency}</p><h3>Scope</h3><ul>${p.result.scope.map((x) => `<li>${escapeHtml(x.text)}</li>`).join("")}</ul><h3>Pricing</h3><p><b>Per Visit:</b> ${money(p.result.perVisitTotal)}</p><p><b>Expiration:</b> ${p.expiration_date}</p><h3>Terms</h3>${Object.values(
      p.result.terms,
    )
      .map((x) => `<p>${escapeHtml(x)}</p>`)
      .join("")}</body></html>`,
  );
  w.document.close();
  w.print();
}
function Header() {
  return (
    <header className="border-b border-[#143d1a]/10 pb-7">
      <p className="mb-3 text-[11px] font-extrabold uppercase tracking-[.2em] text-[#9a7a17]">
        Operations workspace
      </p>
      <h1 className="text-3xl font-extrabold text-[#143d1a]">Open Proposals</h1>
      <p className="mt-3 text-neutral-600">
        Review, approve, send, and track StudioScrubz proposals.
      </p>
    </header>
  );
}
function Summary({ l, v }: { l: string; v: number | string }) {
  return (
    <article className="rounded-2xl border bg-white p-5">
      <p className="text-xs font-bold uppercase text-neutral-500">{l}</p>
      <p className="mt-4 text-3xl font-extrabold text-[#143d1a]">{v}</p>
    </article>
  );
}
function Filter({
  v,
  set,
  opts,
}: {
  v: string;
  set: (x: string) => void;
  opts: readonly string[];
}) {
  return (
    <select value={v} onChange={(e) => set(e.target.value)} className={input}>
      {opts.map((x) => (
        <option key={x}>{x}</option>
      ))}
    </select>
  );
}
function Action({
  t,
  f,
  disabled = false,
}: {
  t: string;
  f: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={f}
      className="rounded border px-2 py-1 text-[10px] font-bold text-[#143d1a] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {t}
    </button>
  );
}
function Badge({ t }: { t: string }) {
  return (
    <span className="rounded-full bg-[#edf4ec] px-2 py-1 text-[10px] font-bold text-[#143d1a]">
      {t}
    </span>
  );
}
function Alert({ text, success }: { text: string; success?: boolean }) {
  return (
    <div
      className={`mt-5 rounded-xl border p-4 text-sm font-bold ${success ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}
    >
      {text}
    </div>
  );
}
function Loading() {
  return <div className="mt-6 h-64 animate-pulse rounded-2xl bg-neutral-200" />;
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center overflow-y-auto bg-[#07190a]/70 p-5">
      <section className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6">
        <button onClick={close} className="float-right text-xl">
          ×
        </button>
        <h2 className="mb-6 text-xl font-extrabold text-[#143d1a]">{title}</h2>
        {children}
      </section>
    </div>
  );
}
function Details({ title, rows }: { title: string; rows: string[][] }) {
  return (
    <section>
      <h3 className="font-extrabold text-[#143d1a]">{title}</h3>
      {rows.map(([a, b]) => (
        <div key={a} className="mt-2 flex justify-between gap-4 text-sm">
          <span className="text-neutral-500">{a}</span>
          <b className="text-right">{b}</b>
        </div>
      ))}
    </section>
  );
}
function money(v: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(v);
}
function human(k: string) {
  return k.replace(/([A-Z])/g, " $1").replace(/^./, (x) => x.toUpperCase());
}
function msg(x: unknown, f: string) {
  return x instanceof Error ? x.message : f;
}
function escapeHtml(x: string) {
  return x.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] ?? c,
  );
}
const input =
  "h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#d4af37]";
