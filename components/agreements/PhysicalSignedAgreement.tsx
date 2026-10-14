"use client";

import { useEffect, useRef, useState } from "react";
import {
  finalizePhysicalAgreement,
  getPhysicalAgreementSigning,
  physicalAgreementFileUrl,
} from "@/lib/services/physicalAgreements";
import type { AgreementWithRelations } from "@/types/agreement";
import type { PhysicalAgreementSigning } from "@/types/physicalAgreement";

export function PhysicalSignedAgreement({
  agreement,
  canManage,
  onUpdated,
}: {
  agreement: AgreementWithRelations;
  canManage: boolean;
  onUpdated: () => Promise<void>;
}) {
  const replacement = agreement.signing_method === "physical";
  const [details, setDetails] = useState<PhysicalAgreementSigning | null>(null);
  const [signedOn, setSignedOn] = useState(agreement.physically_signed_on ?? "");
  const [clientConfirmed, setClientConfirmed] = useState(false);
  const [othersConfirmed, setOthersConfirmed] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!canManage) return;
    let active = true;
    void getPhysicalAgreementSigning(agreement.id)
      .then((value) => { if (active) setDetails(value); })
      .catch((cause) => { if (active) setError(message(cause)); });
    return () => { active = false; };
  }, [agreement.id, canManage]);

  async function submit() {
    if (!signedOn) { setError("Enter the date the Agreement was physically signed."); return; }
    if (!files.length) { setError("Upload at least one signed Agreement file."); return; }
    if (!clientConfirmed || !othersConfirmed) { setError("Confirm that every required signature is present."); return; }
    if (replacement && !window.confirm("Replace the current physical signed copy? The existing files will remain in the audit history.")) return;
    setBusy(true); setError(null);
    try {
      await finalizePhysicalAgreement({
        agreementId: agreement.id,
        physicallySignedOn: signedOn,
        clientSignatureConfirmed: clientConfirmed,
        otherSignaturesConfirmed: othersConfirmed,
        files,
        replace: replacement,
      });
      setFiles([]); setClientConfirmed(false); setOthersConfirmed(false);
      if (fileInput.current) fileInput.current.value = "";
      setDetails(await getPhysicalAgreementSigning(agreement.id));
      await onUpdated();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!canManage && !replacement) return null;

  return (
    <section className="mt-6 rounded-2xl border border-[#143d1a]/15 bg-[#f8faf7] p-5 print:hidden">
      <div>
        <p className="text-xs font-extrabold uppercase tracking-[.18em] text-[#9a7a17]">Signing record</p>
        <h3 className="mt-1 text-xl font-extrabold text-[#143d1a]">
          {replacement ? "Signed — Physical Copy" : "Upload Signed Agreement"}
        </h3>
      </div>

      {replacement && (
        <dl className="mt-4 grid gap-3 rounded-xl border bg-white p-4 text-sm sm:grid-cols-2">
          <Detail label="Physically signed date" value={formatDate(agreement.physically_signed_on)} />
          <Detail label="Uploaded by" value={agreement.physical_signed_uploaded_by_name || "Recorded administrator"} />
          <Detail label="Uploaded on" value={formatTimestamp(agreement.physical_signed_uploaded_at)} />
          <Detail label="Signing method" value="Physical" />
        </dl>
      )}

      {canManage && details?.files.length ? (
        <div className="mt-4 space-y-2">
          {details.files.map((file, index) => (
            <div key={file.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-3 text-sm">
              <div><b>{details.files.length > 1 ? `Page/File ${index + 1}: ` : ""}{file.original_filename}</b><p className="text-xs text-neutral-500">{formatBytes(file.size_bytes)}</p></div>
              <div className="flex gap-2">
                <a className={secondary} href={physicalAgreementFileUrl(agreement.id, file.id)} target="_blank" rel="noreferrer">View Signed Agreement</a>
                <a className={secondary} href={physicalAgreementFileUrl(agreement.id, file.id, true)}>Download Signed Agreement</a>
              </div>
            </div>
          ))}
          {details.replacementCount > 0 && <p className="text-xs font-semibold text-neutral-500">Replacement history: {details.replacementCount} prior audited version{details.replacementCount === 1 ? "" : "s"} retained.</p>}
        </div>
      ) : null}

      {canManage && (agreement.status === "Sent" || replacement) && (
        <div className="mt-5 rounded-xl border bg-white p-4">
          <h4 className="font-extrabold text-[#143d1a]">{replacement ? "Replace signed document" : "Finalize physical signature"}</h4>
          <p className="mt-1 text-xs leading-5 text-neutral-500">PDF, JPG, or PNG. Select multiple files in page order when the Agreement has more than one page. Each file may be up to 25 MB.</p>
          <label className="mt-4 block text-sm font-semibold">Date physically signed<input type="date" max={today()} value={signedOn} onChange={(event) => setSignedOn(event.target.value)} className={input} /></label>
          <label className="mt-4 block text-sm font-semibold">Signed document files<input ref={fileInput} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(event) => setFiles(Array.from(event.target.files ?? []))} className={`${input} py-2`} /></label>
          {files.length > 0 && <ol className="mt-2 list-decimal pl-5 text-xs text-neutral-600">{files.map((file) => <li key={`${file.name}-${file.lastModified}`}>{file.name}</li>)}</ol>}
          <label className="mt-4 flex items-start gap-3 text-sm font-semibold"><input type="checkbox" checked={clientConfirmed} onChange={(event) => setClientConfirmed(event.target.checked)} className="mt-1" /><span>I confirm the client&apos;s required signature is present.</span></label>
          <label className="mt-3 flex items-start gap-3 text-sm font-semibold"><input type="checkbox" checked={othersConfirmed} onChange={(event) => setOthersConfirmed(event.target.checked)} className="mt-1" /><span>I confirm all other required signatures are present.</span></label>
          {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
          <button type="button" disabled={busy || !signedOn || !files.length || !clientConfirmed || !othersConfirmed} className="mt-4 rounded-lg bg-[#143d1a] px-4 py-2 text-sm font-bold text-white disabled:opacity-50" onClick={() => void submit()}>{busy ? "Uploading and verifying..." : replacement ? "Replace Signed Agreement" : "Upload Signed Agreement"}</button>
        </div>
      )}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs font-bold uppercase tracking-wide text-neutral-500">{label}</dt><dd className="mt-1 font-semibold text-[#143d1a]">{value}</dd></div>; }
function formatDate(value: string | null) { return value ? new Date(`${value}T12:00:00`).toLocaleDateString() : "Not recorded"; }
function formatTimestamp(value: string | null) { return value ? new Date(value).toLocaleString() : "Not recorded"; }
function formatBytes(bytes: number) { return bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`; }
function today() { return new Date().toISOString().slice(0, 10); }
function message(cause: unknown) { return cause instanceof Error && cause.message ? cause.message : "Physical signing operation failed."; }
const input = "mt-1 h-11 w-full rounded-lg border px-3";
const secondary = "rounded-lg border px-3 py-2 text-xs font-bold text-[#143d1a]";
