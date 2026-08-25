"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { validateOperationalPhoto } from "@/lib/services/photoStorage";
import type { OperationalPhotoCategory, PendingOperationalPhoto } from "@/types/photo";

export function PhotoCaptureQueue({ photos, setPhotos, categories, busy = false, upload, cameraLabel = "Take Photo", libraryLabel = "Choose From Library", uploadLabel }: { photos: PendingOperationalPhoto[]; setPhotos: (photos: PendingOperationalPhoto[]) => void; categories: readonly OperationalPhotoCategory[]; busy?: boolean; upload?: () => void; cameraLabel?: string; libraryLabel?: string; uploadLabel?: string }) {
  const camera = useRef<HTMLInputElement>(null), library = useRef<HTMLInputElement>(null);
  const cameraAttempt = useRef(false);
  const [defaultCategory, setDefaultCategory] = useState<OperationalPhotoCategory>(categories[0]);
  const [retakeId, setRetakeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  function choose(files: FileList | null, source: "camera" | "library") {
    if (source === "camera") cameraAttempt.current = false;
    if (!files?.length) return;
    try {
      const selected = Array.from(files); selected.forEach(validateOperationalPhoto);
      if (retakeId) {
        const replacement = selected[0];
        setPhotos(photos.map((photo) => photo.id === retakeId ? { ...photo, file: replacement, source } : photo));
        setRetakeId(null);
      } else setPhotos([...photos, ...selected.map((file) => ({ id: crypto.randomUUID(), file, category: defaultCategory, caption: "", source }))]);
      setError(null);
    } catch (cause) { setError(message(cause, "Photo could not be selected.")); }
  }
  function patch(id: string, value: Partial<PendingOperationalPhoto>) { setPhotos(photos.map((photo) => photo.id === id ? { ...photo, ...value } : photo)); }
  function openCamera(id: string | null = null) { setRetakeId(id); cameraAttempt.current = true; const returned = () => window.setTimeout(() => { if (cameraAttempt.current) { cameraAttempt.current = false; setRetakeId(null); setError("Camera access was not available. You can still choose a photo from your device."); } }, 500); window.addEventListener("focus", returned, { once: true }); camera.current?.click(); }
  return <div><div className="grid gap-3 sm:grid-cols-[180px_1fr_1fr]"><select value={defaultCategory} onChange={(event) => setDefaultCategory(event.target.value as OperationalPhotoCategory)} className={input}>{categories.map((item) => <option key={item}>{item}</option>)}</select><button type="button" disabled={busy} onClick={() => openCamera()} className={primary}>{cameraLabel}</button><button type="button" disabled={busy} onClick={() => library.current?.click()} className={secondary}>{libraryLabel}</button><input ref={camera} type="file" accept="image/*" capture="environment" onChange={(event) => { choose(event.target.files, "camera"); event.target.value = ""; }} className="sr-only" /><input ref={library} type="file" accept="image/*" multiple onChange={(event) => { choose(event.target.files, "library"); event.target.value = ""; }} className="sr-only" /></div>{error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}<div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{photos.map((photo) => <article key={photo.id} className="overflow-hidden rounded-xl border border-neutral-200"><PendingPreview photo={photo} /><div className="space-y-2 p-3"><p className="flex justify-between text-xs text-neutral-500"><span>{photo.source === "camera" ? "Camera" : "Photo library"}</span><span>{formatBytes(photo.file.size)}</span></p><select value={photo.category} onChange={(event) => patch(photo.id, { category: event.target.value as OperationalPhotoCategory })} className={input}>{categories.map((item) => <option key={item}>{item}</option>)}</select><input value={photo.caption} onChange={(event) => patch(photo.id, { caption: event.target.value })} placeholder="Optional caption" className={input} /><div className="flex gap-3"><button type="button" onClick={() => openCamera(photo.id)} className="text-xs font-bold text-[#143d1a]">Retake</button><button type="button" onClick={() => setPhotos(photos.filter((item) => item.id !== photo.id))} className="text-xs font-bold text-red-700">Remove</button></div></div></article>)}</div>{upload && photos.length > 0 && <button type="button" disabled={busy} onClick={upload} className="mt-4 rounded-lg bg-[#d4af37] px-5 py-3 text-sm font-extrabold text-[#143d1a] disabled:opacity-60">{busy ? "Uploading…" : uploadLabel ?? `Upload ${photos.length} Photo${photos.length === 1 ? "" : "s"}`}</button>}</div>;
}

function PendingPreview({ photo }: { photo: PendingOperationalPhoto }) { const url = useMemo(() => URL.createObjectURL(photo.file), [photo.file]); useEffect(() => () => URL.revokeObjectURL(url), [url]); return <div className="aspect-[4/3] bg-neutral-100"><img src={url} alt={photo.caption || "Photo awaiting upload"} className="size-full object-cover" /></div>; }
function formatBytes(bytes: number) { return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`; }
function message(error: unknown, fallback: string) { return error instanceof Error && error.message ? error.message : fallback; }
const input = "w-full rounded-lg border border-neutral-200 bg-white px-3.5 py-2.5 text-sm text-neutral-800 outline-none focus:border-[#d4af37]";
const primary = "rounded-lg bg-[#143d1a] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60";
const secondary = "rounded-lg border border-[#143d1a]/20 bg-white px-4 py-2.5 text-sm font-bold text-[#143d1a] disabled:opacity-60";
