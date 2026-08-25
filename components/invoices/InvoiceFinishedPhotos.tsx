"use client";

import { useCallback, useEffect, useState } from "react";
import { PhotoViewerModal } from "@/components/photos/PhotoViewerModal";
import { useOperationalRealtime } from "@/components/realtime/OperationalRealtimeProvider";
import { getInvoiceJobPhotos, setInvoiceJobPhotoVisibility } from "@/lib/services/invoices";
import type { InvoiceJobPhotoWithUrl, OperationalPhotoWithUrl } from "@/types/photo";

export function InvoiceFinishedPhotos({ invoiceId, canToggle }: { invoiceId: string; canToggle: boolean }) {
  const [photos, setPhotos] = useState<InvoiceJobPhotoWithUrl[]>([]);
  const [viewing, setViewing] = useState<InvoiceJobPhotoWithUrl | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setPhotos(await getInvoiceJobPhotos(invoiceId)); setError(null); }
    catch (cause) { setError(message(cause, "Finished Job photos could not be loaded.")); }
  }, [invoiceId]);

  useOperationalRealtime(["jobs", "invoice_job_photos"], load);
  useEffect(() => {
    let active = true;
    void getInvoiceJobPhotos(invoiceId).then((items) => { if (active) { setPhotos(items); setError(null); } }).catch((cause) => { if (active) setError(message(cause, "Finished Job photos could not be loaded.")); });
    return () => { active = false; };
  }, [invoiceId]);

  async function toggle(photo: InvoiceJobPhotoWithUrl) {
    setBusyId(photo.id); setError(null);
    try { await setInvoiceJobPhotoVisibility(invoiceId, photo.id, !photo.customer_visible); await load(); }
    catch (cause) { setError(message(cause, "Customer visibility could not be changed.")); }
    finally { setBusyId(null); }
  }

  return <section className="mt-6">
    <h3 className="font-extrabold text-[#143d1a]">Finished Job Photos</h3>
    <p className="mt-1 text-sm text-neutral-500">Private by default. Only approved photos appear on the customer Invoice or paid receipt.</p>
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
    {!photos.length ? <p className="mt-3 rounded-xl border border-dashed p-6 text-center text-sm text-neutral-500">No finished-photo snapshots are associated with this Invoice.</p> : <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{photos.map(photo => <article key={photo.id} className="overflow-hidden rounded-xl border bg-white">
      <button type="button" onClick={() => setViewing(photo)} className="block aspect-[4/3] w-full bg-neutral-100">{photo.signedUrl ? <img src={photo.signedUrl} alt={photo.caption || photo.original_filename} loading="lazy" className="size-full object-cover" /> : <span className="grid size-full place-items-center text-xs text-neutral-500">Preview unavailable</span>}</button>
      <div className="space-y-2 p-3"><p className="text-sm text-neutral-700">{photo.caption || "Finished work"}</p><p className="text-xs text-neutral-500">Uploaded {formatDate(photo.uploaded_at)}</p><p className={`text-xs font-extrabold ${photo.customer_visible ? "text-green-700" : "text-neutral-500"}`}>{photo.customer_visible ? "Included on Customer Invoice / Receipt" : "Internal only"}</p>{canToggle && <button type="button" disabled={busyId === photo.id} onClick={() => void toggle(photo)} className="rounded-lg border px-3 py-2 text-xs font-bold text-[#143d1a] disabled:opacity-50">{photo.customer_visible ? "Hide from Customer" : "Include on Customer Invoice / Receipt"}</button>}</div>
    </article>)}</div>}
    {viewing && <PhotoViewerModal photo={asOperationalPhoto(viewing)} close={() => setViewing(null)} />}
  </section>;
}

function asOperationalPhoto(photo: InvoiceJobPhotoWithUrl): OperationalPhotoWithUrl { return { id: photo.job_photo_id, storagePath: photo.storage_path, category: "After", originalFilename: photo.original_filename, mimeType: photo.mime_type, sizeBytes: photo.size_bytes, uploadedAt: photo.uploaded_at, uploadedBy: photo.uploaded_by, caption: photo.caption, source: photo.source, signedUrl: photo.signedUrl }; }
function formatDate(value:string){const date=new Date(value);return Number.isNaN(date.valueOf())?value:date.toLocaleDateString("en-US",{dateStyle:"medium"})}
function message(cause:unknown,fallback:string){if(cause instanceof Error&&cause.message)return cause.message;if(cause&&typeof cause==="object"&&"message" in cause&&typeof cause.message==="string")return cause.message;return fallback}
