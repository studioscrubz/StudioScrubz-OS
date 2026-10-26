"use client";

import type { ChangeEvent } from "react";
import { EMAIL_ATTACHMENT_TYPES, MAX_EMAIL_FILES, MAX_EMAIL_FILE_BYTES, MAX_EMAIL_TOTAL_BYTES, type EmailAttachmentInput } from "@/lib/email/attachmentLimits";

export function EmailAttachmentPicker({ files, onChange, disabled }: { files: File[]; onChange: (files: File[]) => void; disabled?: boolean }) {
  const total = files.reduce((n, file) => n + file.size, 0);
  function select(event: ChangeEvent<HTMLInputElement>) {
    const next = [...files, ...Array.from(event.target.files ?? [])];
    event.target.value = "";
    if (next.length > MAX_EMAIL_FILES) { window.alert("Choose up to 3 files."); return; }
    if (next.some(file => !file.size || file.size > MAX_EMAIL_FILE_BYTES || EMAIL_ATTACHMENT_TYPES[file.name.split(".").pop()?.toLowerCase() ?? ""] === undefined)) {
      window.alert("Choose PDF, JPG, PNG, WebP, DOCX, XLSX, TXT or CSV files (each up to 2 MB)."); return;
    }
    if (next.reduce((n, file) => n + file.size, 0) > MAX_EMAIL_TOTAL_BYTES) { window.alert("Attachments must total 2 MB or less."); return; }
    onChange(next);
  }
  return <section className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
    <label className="block text-sm font-bold text-[#143d1a]">Attachments (optional)
      <input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.txt,.csv" onChange={select}
        disabled={disabled || files.length >= MAX_EMAIL_FILES} className="mt-2 block w-full text-sm text-neutral-700 file:mr-3 file:rounded-lg file:border file:border-[#143d1a] file:bg-white file:px-3 file:py-2 file:font-bold file:text-[#143d1a]" />
    </label>
    <p className="mt-1 text-xs text-neutral-500">Up to 3 files, 2 MB combined. Documents, images, TXT and CSV. Files are sent with your email, not saved in StudioScrubz storage.</p>
    {files.map((file,index) => <div key={index} className="mt-2 flex items-center justify-between gap-3 text-sm">
      <span className="min-w-0 break-all">{file.name} ({Math.ceil(file.size / 1024)} KB)</span>
      <button type="button" disabled={disabled} onClick={() => onChange(files.filter((_,i) => i !== index))} className="rounded border px-2 py-1 text-xs font-bold text-red-700">Remove</button>
    </div>)}
    {files.length > 0 && <p className="mt-2 text-xs text-neutral-500">{Math.ceil(total / 1024)} KB selected</p>}
  </section>;
}

export async function encodeEmailFiles(files: File[]): Promise<EmailAttachmentInput[]> {
  let total = 0;
  if (files.length > MAX_EMAIL_FILES) throw new Error("Choose up to 3 files.");
  const output: EmailAttachmentInput[] = [];
  for (const file of files) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const contentType = EMAIL_ATTACHMENT_TYPES[ext];
    total += file.size;
    if (!contentType || !file.size || file.size > MAX_EMAIL_FILE_BYTES || total > MAX_EMAIL_TOTAL_BYTES) throw new Error("Invalid attachment or 2 MB limit exceeded.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    let encoded = "";
    for (let offset = 0; offset < bytes.length; offset += 32768) encoded += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    output.push({ filename: file.name, content: btoa(encoded), contentType });
  }
  return output;
}
