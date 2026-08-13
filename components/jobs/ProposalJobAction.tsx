"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createJobFromProposal, getJobForProposal } from "@/lib/services/jobs";
import type { JobWithRelations } from "@/types/job";

export const PROPOSAL_JOB_CREATED_EVENT = "studioscrubz:proposal-job-created";

export function ProposalJobAction({ proposalId }: { proposalId: string }) {
  const [job, setJob] = useState<JobWithRelations | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getJobForProposal(proposalId)
      .then((value) => {
        if (active) setJob(value);
      })
      .catch((cause: unknown) => {
        console.error("Job relationship load failed", cause);
        if (active) setError("Unable to check Job status.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [proposalId]);

  async function create() {
    setSaving(true);
    setFailed(false);
    setError(null);
    try {
      const created = await createJobFromProposal(proposalId);
      const linked = (await getJobForProposal(proposalId)) ?? created;
      setJob(linked);
      window.dispatchEvent(new Event(PROPOSAL_JOB_CREATED_EVENT));
    } catch (cause) {
      console.error("Job creation failed", cause);
      setFailed(true);
      setError("Unable to create Job.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <span className="rounded border px-2 py-1 text-[10px] font-bold text-neutral-400">Checking Job…</span>;
  if (job) return <><span className="rounded bg-[#edf4ec] px-2 py-1 text-[10px] font-bold text-[#143d1a]">Job Created</span><Link href={`/jobs?jobId=${job.id}`} className="rounded border px-2 py-1 text-[10px] font-bold text-[#143d1a]">View Job</Link></>;
  return <><button type="button" disabled={saving} onClick={() => void create()} className="rounded bg-[#143d1a] px-2 py-1 text-[10px] font-bold text-white disabled:opacity-50">{saving ? "Creating Job…" : failed ? "Retry Job Creation" : "Create Job"}</button>{error && <span className="w-full text-xs font-bold text-red-700">{error}</span>}</>;
}
