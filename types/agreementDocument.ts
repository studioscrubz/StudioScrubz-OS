export const AGREEMENT_DOCUMENT_BUCKET = "agreement-documents";
export const MAX_AGREEMENT_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const AGREEMENT_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type AgreementDocumentMimeType = (typeof AGREEMENT_DOCUMENT_MIME_TYPES)[number];

export type ServiceAgreementDocument = {
  id: string;
  agreement_id: string;
  document_name: string;
  description: string | null;
  original_filename: string;
  storage_path: string;
  mime_type: AgreementDocumentMimeType;
  size_bytes: number;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AgreementDocumentInsert = Pick<
  ServiceAgreementDocument,
  "id" | "agreement_id" | "document_name" | "description" | "original_filename" | "storage_path" | "mime_type" | "size_bytes"
>;
