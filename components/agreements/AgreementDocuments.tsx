"use client";

import { useEffect, useRef, useState } from "react";
import { useOperationalRealtime } from "@/components/realtime/OperationalRealtimeProvider";
import {
  archiveAgreementDocument,
  deleteAgreementDocument,
  getAgreementDocuments,
  getAgreementDocumentSignedUrl,
  restoreAgreementDocument,
  uploadAgreementDocument,
} from "@/lib/services/agreementDocuments";
import type { ServiceAgreementDocument } from "@/types/agreementDocument";

export function AgreementDocuments({ agreementId, canManage }: { agreementId: string; canManage: boolean }) {
  const [documents, setDocuments] = useState<ServiceAgreementDocument[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function load() {
    setDocuments(await getAgreementDocuments(agreementId, true));
    setError(null);
  }
  useOperationalRealtime(["service_agreement_documents"], load);
  useEffect(() => {
    let active = true;
    void getAgreementDocuments(agreementId, true).then((rows) => { if (active) setDocuments(rows); }).catch((cause) => { if (active) setError(message(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [agreementId]);

  async function upload() {
    if (!file) { setError("Choose a document to upload."); return; }
    setBusy(true); setError(null);
    try {
      await uploadAgreementDocument({ agreementId, file, documentName: name, description });
      setName(""); setDescription(""); setFile(null); if (fileInput.current) fileInput.current.value = "";
      await load();
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  async function openDocument(document: ServiceAgreementDocument) {
    setBusy(true); setError(null);
    try {
      const download = document.mime_type === "application/msword" || document.mime_type.includes("wordprocessingml");
      const url = await getAgreementDocumentSignedUrl(document, download);
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      if (!opened) window.location.assign(url);
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  async function archive(document: ServiceAgreementDocument) { await action(() => archiveAgreementDocument(document.id)); }
  async function restore(document: ServiceAgreementDocument) { await action(() => restoreAgreementDocument(document.id)); }
  async function remove(document: ServiceAgreementDocument) {
    if (!window.confirm(`Permanently delete "${document.document_name}"? This cannot be undone.`)) return;
    await action(() => deleteAgreementDocument(document));
  }
  async function action(operation: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await operation(); await load(); } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }

  const visible = documents.filter((document) => showArchived || !document.archived_at);
  return <section className="mt-5 rounded-2xl border border-[#143d1a]/15 bg-[#f8faf7] p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-extrabold text-[#143d1a]">Agreement Documents</h3><p className="mt-1 text-sm text-neutral-500">Private supporting files for this Service Agreement. These are not visible on the public agreement page.</p></div><label className="text-sm font-semibold"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)}/> Show archived</label></div>
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
    {canManage && <div className="mt-4 grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2"><label className="text-sm font-semibold">Document Name<input className={input} value={name} maxLength={200} onChange={(event) => setName(event.target.value)} placeholder="Signed contract, insurance certificate..."/></label><label className="text-sm font-semibold">File<input ref={fileInput} className={`${input} py-2`} type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)}/></label><label className="text-sm font-semibold sm:col-span-2">Description (optional)<textarea className="mt-1 min-h-20 w-full rounded-lg border px-3 py-2" value={description} maxLength={1000} onChange={(event) => setDescription(event.target.value)}/></label><div className="sm:col-span-2"><button type="button" disabled={busy || !file || !name.trim()} className="rounded-lg bg-[#143d1a] px-4 py-2 text-sm font-bold text-white disabled:opacity-50" onClick={() => void upload()}>{busy ? "Working..." : "Upload Document"}</button><p className="mt-2 text-xs text-neutral-500">PDF, DOC, DOCX, JPEG, PNG, or WebP - 25 MB maximum</p></div></div>}
    {loading ? <div className="mt-4 h-20 animate-pulse rounded-xl bg-neutral-100"/> : <div className="mt-4 space-y-3">{visible.map((document) => <article key={document.id} className={`rounded-xl border bg-white p-4 ${document.archived_at ? "opacity-65" : ""}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-extrabold text-[#143d1a]">{document.document_name}</p><p className="text-sm text-neutral-600">{document.original_filename} - {formatBytes(document.size_bytes)}</p>{document.description && <p className="mt-1 text-sm text-neutral-600">{document.description}</p>}<p className="mt-1 text-xs text-neutral-500">Uploaded {new Date(document.uploaded_at).toLocaleString()} by {document.uploaded_by_name || uploader(document.uploaded_by)}</p>{document.archived_at && <p className="mt-1 text-xs font-bold text-amber-700">Archived {new Date(document.archived_at).toLocaleString()}</p>}</div><div className="flex flex-wrap gap-2">{!document.archived_at && <button type="button" disabled={busy} className={secondary} onClick={() => void openDocument(document)}>{document.mime_type.includes("word") ? "Download" : "Open"}</button>}{canManage && !document.archived_at && <button type="button" disabled={busy} className={secondary} onClick={() => void archive(document)}>Archive</button>}{canManage && document.archived_at && <><button type="button" disabled={busy} className={secondary} onClick={() => void restore(document)}>Restore</button><button type="button" disabled={busy} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-700" onClick={() => void remove(document)}>Delete Permanently</button></>}</div></div></article>)}</div>}
    {!loading && !visible.length && <p className="mt-4 text-sm text-neutral-500">No {showArchived ? "agreement documents" : "active agreement documents"}.</p>}
  </section>;
}

function uploader(id: string | null) { return id ? `user ${id.slice(0, 8)}` : "a deleted user"; }
function formatBytes(bytes: number) { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / 1024 ** 2).toFixed(1)} MB`; }
function message(cause: unknown) { console.error(cause); return cause instanceof Error && cause.message ? cause.message : "Document operation failed."; }
const input = "mt-1 h-11 w-full rounded-lg border px-3";
const secondary = "rounded-lg border px-3 py-2 text-xs font-bold text-[#143d1a] disabled:opacity-50";
