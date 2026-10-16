"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { isMasterAdmin } from "@/lib/auth/permissions";
import { getCustomerCredits, reclassifyCustomerCreditAsTip } from "@/lib/services/payments";
import type { CustomerCreditWithSource } from "@/types/payment";

export function CustomerCreditsPage() {
  const { profile } = useAuth();
  const [credits, setCredits] = useState<CustomerCreditWithSource[]>([]);
  const [selected, setSelected] = useState<CustomerCreditWithSource | null>(null);
  const [reason, setReason] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const allowed = isMasterAdmin(profile);

  async function load() {
    setCredits(await getCustomerCredits());
  }
  useEffect(() => {
    if (!allowed) { setLoading(false); return; }
    let active = true;
    void getCustomerCredits().then((rows) => { if (active) setCredits(rows); }).catch((cause:unknown) => { if (active) setError(message(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [allowed]);

  if (!allowed) return <section className="rounded-2xl border bg-white p-10 text-center"><h1 className="text-2xl font-extrabold text-[#143d1a]">Unauthorized</h1><p className="mt-3 text-neutral-600">Only an active Master Admin can manage Customer Credits.</p></section>;
  return <>
    <header><p className="text-sm font-extrabold uppercase tracking-[.2em] text-[#9a7a17]">Finances</p><h1 className="mt-2 text-3xl font-extrabold text-[#143d1a]">Customer Credits</h1><p className="mt-2 text-neutral-600">Available customer funds remain separate from Invoice revenue. Tip corrections are permanent and audited.</p></header>
    {notice&&<Alert good text={notice}/>} {error&&<Alert text={error}/>}
    <section className="mt-6 overflow-x-auto rounded-2xl border bg-white"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-[#edf1eb] text-xs uppercase text-[#143d1a]"><tr>{["Customer","Invoice","Original Credit","Available Credit","Status","Source Payment","Action"].map((x)=><th key={x} className="p-4">{x}</th>)}</tr></thead><tbody>{loading?<tr><td colSpan={7} className="p-8 text-center">Loading credits…</td></tr>:credits.length?credits.map((credit)=><tr key={credit.id} className="border-t"><td className="p-4 font-bold">{credit.customer_name_snapshot}</td><td className="p-4">{credit.invoice?.invoice_number??credit.source_invoice_id}</td><td className="p-4">{money(credit.original_amount)}</td><td className="p-4 font-bold">{money(credit.remaining_amount)}</td><td className="p-4">{credit.status}</td><td className="p-4 font-mono text-xs">{credit.source_payment_id}</td><td className="p-4">{credit.status==="Unapplied"&&credit.remaining_amount>0&&!credit.payment?.voided_at?<button className={primary} onClick={()=>{setSelected(credit);setReason("");setIdempotencyKey(crypto.randomUUID());setError(null)}}>Reclassify as Tip</button>:"—"}</td></tr>):<tr><td colSpan={7} className="p-8 text-center text-neutral-500">No Customer Credits found.</td></tr>}</tbody></table></section>
    {selected&&<div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"><section className="w-full max-w-xl rounded-2xl bg-white p-6"><button className="float-right text-xl" onClick={()=>!saving&&setSelected(null)}>×</button><h2 className="text-xl font-extrabold text-[#143d1a]">Reclassify Customer Credit as Tip</h2><div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm"><p>Customer: <b>{selected.customer_name_snapshot}</b></p><p>Invoice: <b>{selected.invoice?.invoice_number}</b></p><p>Payment received: <b>{money(selected.payment?.received_amount??0)}</b></p><p>Applied to Invoice: <b>{money(selected.payment?.amount??0)}</b></p><p>Credit becoming tip: <b>{money(selected.remaining_amount)}</b></p><p className="mt-2 font-bold text-amber-900">This permanently reduces available credit to $0.00. It does not change the Invoice total or original tender.</p></div><label className="mt-5 block text-sm font-bold">Correction reason (required, at least 15 characters)<textarea className={`${input} mt-2 min-h-28 py-3`} value={reason} maxLength={1000} onChange={(e)=>setReason(e.target.value)}/></label>{error&&<Alert text={error}/>}<div className="mt-5 flex justify-end gap-3"><button className={secondary} disabled={saving} onClick={()=>setSelected(null)}>Cancel</button><button className={primary} disabled={saving||reason.trim().replace(/\s+/g," ").length<15} onClick={()=>void submit()}>{saving?"Reclassifying…":"Confirm Reclassification"}</button></div></section></div>}
  </>;

  async function submit() {
    if (!selected) return;
    const normalizedReason = reason.trim().replace(/\s+/g, " ");
    if (normalizedReason.length < 15) return setError("Enter a correction reason of at least 15 characters.");
    if (!window.confirm(`Permanently reclassify ${money(selected.remaining_amount)} of available Customer Credit as a tip?`)) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      await reclassifyCustomerCreditAsTip({ creditId:selected.id, paymentId:selected.source_payment_id, reason:normalizedReason, idempotencyKey });
      await load(); setSelected(null); setNotice(`${money(selected.remaining_amount)} was reclassified as a tip. The audit event was recorded.`);
    } catch (cause) { setError(message(cause)); }
    finally { setSaving(false); }
  }
}

function Alert({text,good}:{text:string;good?:boolean}){return <div className={`mt-5 rounded-xl p-4 text-sm font-bold ${good?"bg-green-50 text-green-800":"bg-red-50 text-red-700"}`}>{text}</div>}
function money(value:number){return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(value??0)}
function message(cause:unknown){if(cause instanceof Error)return cause.message;if(cause&&typeof cause==="object"&&"message" in cause&&typeof cause.message==="string")return cause.message;return"Customer Credit operation failed."}
const input="w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#d4af37]";
const primary="rounded-lg bg-[#143d1a] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50";
const secondary="rounded-lg border border-neutral-200 px-4 py-2.5 text-sm font-bold text-[#143d1a] disabled:opacity-50";
