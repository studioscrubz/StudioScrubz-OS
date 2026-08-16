"use client";

import { useState } from "react";
import { PhotoViewerModal } from "@/components/photos/PhotoViewerModal";
import type { OperationalPhotoWithUrl } from "@/types/photo";

export function PhotoGallery({ photos, remove, saveCaption, readonly = false }: { photos: OperationalPhotoWithUrl[]; remove?: (photo: OperationalPhotoWithUrl) => void; saveCaption?: (photo: OperationalPhotoWithUrl, caption: string) => void; readonly?: boolean }) {
  const [viewing, setViewing] = useState<OperationalPhotoWithUrl | null>(null);
  if (!photos.length) return <p className="rounded-xl border border-dashed border-[#143d1a]/20 px-5 py-8 text-center text-sm text-neutral-500">No photos uploaded.</p>;
  return <><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{photos.map((photo) => <article key={photo.id} className="overflow-hidden rounded-xl border border-neutral-200 bg-white"><button type="button" onClick={() => setViewing(photo)} className="block aspect-[4/3] w-full bg-neutral-100">{photo.signedUrl ? <img src={photo.signedUrl} alt={photo.caption || photo.originalFilename} loading="lazy" className="size-full object-cover" /> : <span className="grid size-full place-items-center px-4 text-xs font-bold text-neutral-500">{photo.mimeType.includes("heic") || photo.mimeType.includes("heif") ? "HEIC/HEIF preview unavailable — open to view if supported" : "Preview unavailable"}</span>}</button><div className="space-y-2 p-3"><p className="text-xs font-extrabold uppercase tracking-wide text-[#9a7a17]">{photo.category}</p>{readonly ? <p className="text-sm text-neutral-600">{photo.caption || "No caption"}</p> : <input defaultValue={photo.caption ?? ""} onBlur={(event) => saveCaption?.(photo, event.target.value)} placeholder="Add a caption" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm" />}{!readonly && <button type="button" onClick={() => remove?.(photo)} className="text-xs font-bold text-red-700">Delete photo</button>}</div></article>)}</div>{viewing && <PhotoViewerModal photo={viewing} close={() => setViewing(null)} />}</>;
}
