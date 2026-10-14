export const PHYSICAL_AGREEMENT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;

export const MAX_PHYSICAL_AGREEMENT_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_PHYSICAL_AGREEMENT_FILES = 20;

export type PhysicalAgreementMimeType = (typeof PHYSICAL_AGREEMENT_MIME_TYPES)[number];

export type PhysicalAgreementFile = {
  id: string;
  agreement_id: string;
  signing_event_id: string;
  original_filename: string;
  mime_type: PhysicalAgreementMimeType;
  size_bytes: number;
  page_order: number;
  uploaded_by_name: string;
  uploaded_at: string;
  archived_at: string | null;
};

export type PhysicalAgreementSigning = {
  signingMethod: "physical" | null;
  physicallySignedOn: string | null;
  uploadedBy: string | null;
  uploadedAt: string | null;
  files: PhysicalAgreementFile[];
  replacementCount: number;
};
