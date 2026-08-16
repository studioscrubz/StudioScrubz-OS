"use client";

import type { OperationalPhotoWithUrl } from "@/types/photo";

export function PhotoViewerModal({ photo, close }: { photo: OperationalPhotoWithUrl; close: () => void }) {
  return <div className="fixed inset-0 z-[100] grid place-items-center bg-black/85 p-4" role="dialog" aria-modal="true" aria-label="Photo preview" onClick={close}><div className="max-h-full max-w-5xl" onClick={(event) => event.stopPropagation()}>{photo.signedUrl ? <img src={photo.signedUrl} alt={photo.caption || photo.originalFilename} className="max-h-[82vh] max-w-full rounded-xl object-contain" /> : <div className="rounded-xl bg-white p-8 text-sm text-neutral-600">Preview is unavailable for this photo format.</div>}<div className="mt-3 flex items-center justify-between text-white"><p className="text-sm">{photo.caption || photo.category}</p><button type="button" onClick={close} className="rounded-lg border border-white/30 px-4 py-2 text-sm font-bold">Close</button></div></div></div>;
}
