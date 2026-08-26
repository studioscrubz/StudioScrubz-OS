"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { useOperationalRealtime } from "@/components/realtime/OperationalRealtimeProvider";
import {
  createProposalPhotoSignedUrls,
  getProposalPricingPhotos,
  removeProposalPricingPhoto,
  setProposalPricingPhotoCaption,
  uploadProposalPricingPhoto,
} from "@/lib/services/proposalPhotos";
import { validateOperationalPhoto } from "@/lib/services/photoStorage";
import type { ProposalPricingPhotoWithUrl, ProposalStatus } from "@/types/proposal";

const REALTIME_TABLES = ["proposals"] as const;
type Pending = { id: string; file: File; caption: string; source: "camera" | "library"; preview: string };

export function ProposalPricingPhotos({ proposalId, status, canManage }: { proposalId: string; status: ProposalStatus; canManage: boolean }) {
  const editable = canManage && status === "Draft";
  const [photos, setPhotos] = useState<ProposalPricingPhotoWithUrl[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [viewing, setViewing] = useState<ProposalPricingPhotoWithUrl | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef<Pending[]>([]);

  const refresh = useCallback(async () => {
    const saved = await getProposalPricingPhotos(proposalId);
    setPhotos(await createProposalPhotoSignedUrls(saved));
  }, [proposalId]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void refresh().catch((cause: unknown) => { if (active) setError(message(cause)); }).finally(() => { if (active) setLoading(false); });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [refresh]);
  useEffect(() => { pendingRef.current = pending; }, [pending]);
  useEffect(() => () => pendingRef.current.forEach((item) => URL.revokeObjectURL(item.preview)), []);
  useOperationalRealtime(REALTIME_TABLES, refresh);

  function queue(files: FileList | null, source: Pending["source"]) {
    if (!files?.length) return;
    setError(null);
    const next: Pending[] = [];
    for (const file of Array.from(files)) {
      try {
        validateOperationalPhoto(file);
        next.push({ id: crypto.randomUUID(), file, caption: "", source, preview: URL.createObjectURL(file) });
      } catch (cause) { setError(message(cause)); }
    }
    setPending((current) => [...current, ...next]);
  }
  function discard(id: string) {
    setPending((current) => { const item = current.find((entry) => entry.id === id); if (item) URL.revokeObjectURL(item.preview); return current.filter((entry) => entry.id !== id); });
  }
  async function uploadAll() {
    setBusy(true); setError(null);
    try {
      for (const item of pending) {
        await uploadProposalPricingPhoto({ proposalId, file: item.file, caption: item.caption, source: item.source });
        discard(item.id);
      }
      await refresh();
    } catch (cause) { setError(message(cause)); await refresh().catch(() => undefined); }
    finally { setBusy(false); }
  }
  async function saveCaption(photo: ProposalPricingPhotoWithUrl, caption: string) {
    if ((photo.caption ?? "") === caption.trim()) return;
    setBusy(true); setError(null);
    try { await setProposalPricingPhotoCaption(proposalId, photo.id, caption); await refresh(); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  async function remove(photo: ProposalPricingPhotoWithUrl) {
    if (!window.confirm("Remove this photo from the Proposal pricing context?")) return;
    setBusy(true); setError(null);
    try { await removeProposalPricingPhoto(proposalId, photo.id); await refresh(); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }

  return <section className="rounded-2xl border border-[#143d1a]/10 bg-white p-5 shadow-sm sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="font-extrabold text-[#143d1a]">Proposal Pricing Photos</h2><p className="mt-1 text-sm text-neutral-500">Pricing references preserve the source photo visibility for later customer documents. Proposal-owned pricing uploads remain Internal Only.</p></div>
      {editable && <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => cameraRef.current?.click()} className={button}>Take Pricing Photo</button>
        <button type="button" disabled={busy} onClick={() => libraryRef.current?.click()} className={button}>Upload Pricing Photos</button>
        <input ref={cameraRef} className="hidden" type="file" accept="image/*" capture="environment" onChange={(event) => { queue(event.target.files, "camera"); event.target.value = ""; }} />
        <input ref={libraryRef} className="hidden" type="file" accept="image/*" multiple onChange={(event) => { queue(event.target.files, "library"); event.target.value = ""; }} />
      </div>}
    </div>
    {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
    {pending.length > 0 && <div className="mt-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{pending.map((item) => <div key={item.id} className="overflow-hidden rounded-xl border bg-neutral-50"><div className="relative aspect-[4/3]"><Image unoptimized fill src={item.preview} alt="Pending Proposal pricing upload" className="object-cover" /></div><div className="space-y-2 p-3"><input value={item.caption} onChange={(event) => setPending((current) => current.map((entry) => entry.id === item.id ? { ...entry, caption: event.target.value } : entry))} maxLength={1000} placeholder="Optional caption" className={input}/><button type="button" onClick={() => discard(item.id)} className="text-sm font-bold text-red-700">Remove</button></div></div>)}</div>
      <button type="button" disabled={busy} onClick={() => void uploadAll()} className="mt-3 rounded-lg bg-[#143d1a] px-5 py-3 font-bold text-white disabled:opacity-50">{busy ? "Uploading…" : `Upload ${pending.length} Photo${pending.length === 1 ? "" : "s"}`}</button>
    </div>}
    {loading ? <p className="mt-5 text-sm text-neutral-500">Loading pricing photos…</p> : photos.length === 0 ? <p className="mt-5 rounded-xl border border-dashed p-6 text-center text-sm text-neutral-500">No pricing photos are saved with this Proposal.</p> : <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{photos.map((photo) => <article key={photo.id} className="overflow-hidden rounded-xl border bg-white">
      <button type="button" disabled={!photo.signedUrl} onClick={() => setViewing(photo)} className="relative block aspect-[4/3] w-full bg-neutral-100 disabled:cursor-default">{photo.signedUrl ? <Image unoptimized fill src={photo.signedUrl} alt={photo.caption || photo.originalFilename || photo.fileName || "Proposal pricing photo"} className="object-cover" /> : <span className="absolute inset-0 grid place-items-center text-sm text-neutral-500">Preview unavailable</span>}</button>
      <div className="space-y-2 p-3"><span className="inline-flex rounded-full bg-[#edf4ec] px-2.5 py-1 text-[11px] font-bold text-[#143d1a]">{sourceLabel(photo)}</span><p className={`text-xs font-extrabold ${photo.customerVisible ? "text-green-700" : "text-neutral-500"}`}>{photo.customerVisible ? "Customer Visible" : "Internal Only"}</p>{editable ? <input defaultValue={photo.caption ?? ""} maxLength={1000} placeholder="Optional caption" disabled={busy} onBlur={(event) => void saveCaption(photo, event.target.value)} className={input}/> : photo.caption ? <p className="text-sm text-neutral-700">{photo.caption}</p> : null}{editable && <button type="button" disabled={busy} onClick={() => void remove(photo)} className="text-sm font-bold text-red-700 disabled:opacity-50">Remove from Proposal</button>}</div>
    </article>)}</div>}
    {viewing?.signedUrl && <div role="dialog" aria-modal="true" aria-label="Proposal pricing photo" onClick={() => setViewing(null)} className="fixed inset-0 z-[100] grid place-items-center bg-black/80 p-3 sm:p-8"><button type="button" aria-label="Close photo" onClick={() => setViewing(null)} className="absolute right-4 top-4 h-11 w-11 rounded-full bg-white text-2xl font-bold">×</button><div onClick={(event) => event.stopPropagation()} className="relative h-[80vh] w-full max-w-5xl"><Image unoptimized fill src={viewing.signedUrl} alt={viewing.caption || viewing.originalFilename || "Proposal pricing photo"} className="object-contain" /></div></div>}
  </section>;
}

function sourceLabel(photo: ProposalPricingPhotoWithUrl) { return photo.ownership === "walkthrough-reference" ? "From Walkthrough" : photo.ownership === "proposal" ? "Added During Proposal Review" : "Legacy Proposal Photo"; }
function message(cause: unknown) { return cause instanceof Error ? cause.message : "Proposal photo action failed."; }
const button = "min-h-11 rounded-lg border border-[#143d1a]/20 bg-white px-4 py-2 text-sm font-bold text-[#143d1a] disabled:opacity-50";
const input = "w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#d4af37] focus:ring-2 focus:ring-[#d4af37]/15";
