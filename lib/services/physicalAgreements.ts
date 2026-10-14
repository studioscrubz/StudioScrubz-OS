import type { ServiceAgreement } from "@/types/agreement";
import type { PhysicalAgreementSigning } from "@/types/physicalAgreement";

export async function getPhysicalAgreementSigning(agreementId: string): Promise<PhysicalAgreementSigning> {
  const response = await fetch(`/api/agreements/${encodeURIComponent(agreementId)}/physical-signing`, { cache: "no-store" });
  return parseResponse<PhysicalAgreementSigning>(response, "Physical signing details could not be loaded.");
}

export async function finalizePhysicalAgreement(input: {
  agreementId: string;
  physicallySignedOn: string;
  clientSignatureConfirmed: boolean;
  otherSignaturesConfirmed: boolean;
  files: File[];
  replace: boolean;
}): Promise<ServiceAgreement> {
  const form = new FormData();
  form.set("physicallySignedOn", input.physicallySignedOn);
  form.set("clientSignatureConfirmed", String(input.clientSignatureConfirmed));
  form.set("otherSignaturesConfirmed", String(input.otherSignaturesConfirmed));
  form.set("replace", String(input.replace));
  input.files.forEach((file) => form.append("files", file));
  const response = await fetch(`/api/agreements/${encodeURIComponent(input.agreementId)}/physical-signing`, {
    method: "POST",
    body: form,
  });
  return parseResponse<ServiceAgreement>(response, "The physical signed Agreement could not be saved.");
}

export function physicalAgreementFileUrl(agreementId: string, fileId: string, download = false) {
  return `/api/agreements/${encodeURIComponent(agreementId)}/physical-signed-files/${encodeURIComponent(fileId)}${download ? "?download=1" : ""}`;
}

async function parseResponse<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => null) as { error?: string } | T | null;
  if (!response.ok) throw new Error(body && typeof body === "object" && "error" in body && body.error ? body.error : fallback);
  return body as T;
}
