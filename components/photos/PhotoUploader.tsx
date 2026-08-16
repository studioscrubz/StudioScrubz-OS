"use client";

import { useEffect, useState } from "react";
import { createPhotoSignedUrls, deleteOperationalPhoto, getOperationalPhotos, updateOperationalPhotoCaption, uploadOperationalPhoto } from "@/lib/services/photoStorage";
import { PhotoCaptureQueue } from "@/components/photos/PhotoCaptureQueue";
import { PhotoGallery } from "@/components/photos/PhotoGallery";
import type { OperationalPhoto, OperationalPhotoCategory, OperationalPhotoRecordType, OperationalPhotoWithUrl, PendingOperationalPhoto } from "@/types/photo";

export function PhotoUploader({ recordType, recordId, categories, readonly = false, title }: { recordType: OperationalPhotoRecordType; recordId: string; categories: readonly OperationalPhotoCategory[]; readonly?: boolean; title?: string }) {
  const [photos, setPhotos] = useState<OperationalPhoto[]>([]);
  const [display, setDisplay] = useState<OperationalPhotoWithUrl[]>([]);
  const [pending, setPending] = useState<PendingOperationalPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let active = true; void getOperationalPhotos(recordType, recordId).then(async (items) => { const signed = await createPhotoSignedUrls(items); if (active) { setPhotos(items); setDisplay(signed); } }).catch((cause: unknown) => { console.error("Photo load failed", cause); if (active) setError(message(cause, "Photos could not be loaded.")); }); return () => { active = false; }; }, [recordId, recordType]);
  async function refresh(next: OperationalPhoto[]) { setPhotos(next); setDisplay(await createPhotoSignedUrls(next)); }
  async function upload() { if (!pending.length) return; if (!navigator.onLine) return setError("An internet connection is required to upload photos."); setBusy(true); setError(null); let next = photos; try { for (const queued of pending) { next = await uploadOperationalPhoto({ recordType, recordId, category: queued.category, caption: queued.caption, source: queued.source, file: queued.file, currentPhotos: next }); setPending((current) => current.filter((item) => item.id !== queued.id)); } await refresh(next); } catch (cause) { console.error("Photo upload failed", cause); await refresh(next); setError(message(cause, "Photo upload failed.")); } finally { setBusy(false); } }
  async function remove(photo: OperationalPhoto) { if (!window.confirm("Delete this photo? This cannot be undone.")) return; setBusy(true); setError(null); try { await refresh(await deleteOperationalPhoto(recordType, recordId, photos, photo)); } catch (cause) { console.error("Photo delete failed", cause); setError(message(cause, "Photo could not be deleted.")); } finally { setBusy(false); } }
  async function saveCaption(photo: OperationalPhoto, value: string) { if ((photo.caption ?? "") === value.trim()) return; try { await refresh(await updateOperationalPhotoCaption(recordType, recordId, photos, photo.id, value)); } catch (cause) { console.error("Photo caption failed", cause); setError(message(cause, "Photo caption could not be saved.")); } }
  return <section className="mt-6 rounded-2xl border border-[#143d1a]/10 bg-white p-5"><h3 className="font-extrabold text-[#143d1a]">{title ?? "Photos"}</h3><p className="mt-1 text-sm text-neutral-500">Take a new photo or choose existing photos, review them, then upload securely.</p>{error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}{!readonly && <div className="mt-4"><PhotoCaptureQueue photos={pending} setPhotos={setPending} categories={categories} busy={busy} upload={() => void upload()} /></div>}<div className="mt-5"><PhotoGallery photos={display} readonly={readonly} remove={(photo) => void remove(photo)} saveCaption={(photo, value) => void saveCaption(photo, value)} /></div></section>;
}

function message(error: unknown, fallback: string) { return error instanceof Error && error.message ? error.message : fallback; }
