"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createPostConstructionDraftAgreement, getAgreementForProposal } from "@/lib/services/agreements";
import type { AgreementWithRelations } from "@/types/agreement";
export function ProposalAgreementAction({
  proposalId,
  autoDraft = false,
}: {
  proposalId: string;
  autoDraft?: boolean;
}) {
  const [a, setA] = useState<AgreementWithRelations | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [creating,setCreating]=useState(false);
  useEffect(() => {
    void getAgreementForProposal(proposalId)
      .then(setA)
      .catch(() => setError("Agreement status unavailable."))
      .finally(() => setLoading(false));
  }, [proposalId]);
  if (loading)
    return (
      <span className="rounded border px-2 py-1 text-xs font-bold text-neutral-400">
        Checking Agreement…
      </span>
    );
  async function createDraft(){setCreating(true);setError(null);try{setA(await createPostConstructionDraftAgreement(proposalId))}catch(cause){setError(cause instanceof Error?cause.message:"Draft Agreement could not be created.")}finally{setCreating(false)}}
  return a ? (
    <>
      <span className="rounded bg-green-50 px-2 py-1 text-xs font-bold">
        {a.status} Agreement
      </span>
      <Link
        className="rounded border px-2 py-1 text-xs font-bold"
        href={`/agreements?agreementId=${a.id}`}
      >
        Open / Review Agreement
      </Link>
    </>
  ) : (
    <>
      {autoDraft ? <button type="button" disabled={creating} className="rounded bg-[#143d1a] px-2 py-1 text-xs font-bold text-white disabled:opacity-50" onClick={()=>void createDraft()}>{creating?"Creating…":"Regenerate Draft Agreement"}</button> : <Link
        className="rounded bg-[#143d1a] px-2 py-1 text-xs font-bold text-white"
        href={`/agreements?proposalId=${proposalId}`}
      >
        Create Service Agreement
      </Link>}
      {error && <span className="text-xs text-red-700">{error}</span>}
    </>
  );
}
