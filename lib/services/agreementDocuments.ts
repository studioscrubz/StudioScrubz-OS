import { getSupabaseClient } from "@/lib/supabase/client";
import {
  AGREEMENT_DOCUMENT_BUCKET,
  AGREEMENT_DOCUMENT_MIME_TYPES,
  MAX_AGREEMENT_DOCUMENT_BYTES,
  type AgreementDocumentInsert,
  type AgreementDocumentMimeType,
  type ServiceAgreementDocument,
} from "@/types/agreementDocument";

const SIGNED_URL_SECONDS = 15 * 60;

export async function getAgreementDocuments(agreementId: string, includeArchived = false): Promise<ServiceAgreementDocument[]> {
  assertUuid(agreementId, "A saved Service Agreement is required.");
  let query = getSupabaseClient().from("service_agreement_documents").select("*").eq("agreement_id", agreementId);
  if (!includeArchived) query = query.is("archived_at", null);
  const { data, error } = await query.order("uploaded_at", { ascending: false });
  if (error) throw new Error(error.message || "Agreement documents could not be loaded.");
  return data as ServiceAgreementDocument[];
}

export async function uploadAgreementDocument(input: { agreementId: string; file: File; documentName: string; description?: string | null }): Promise<ServiceAgreementDocument> {
  if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("An internet connection is required to upload documents.");
  assertUuid(input.agreementId, "A saved Service Agreement is required before uploading documents.");
  const documentName = input.documentName.trim();
  if (!documentName) throw new Error("Enter a document name.");
  if (documentName.length > 200) throw new Error("Document name must be 200 characters or fewer.");
  const description = input.description?.trim() || null;
  if (description && description.length > 1000) throw new Error("Description must be 1,000 characters or fewer.");
  validateAgreementDocument(input.file);

  const id = crypto.randomUUID();
  const safeFilename = sanitizedFilename(input.file.name, input.file.type as AgreementDocumentMimeType);
  const storagePath = `agreements/${input.agreementId}/${id}/${safeFilename}`;
  const metadata: AgreementDocumentInsert = {
    id,
    agreement_id: input.agreementId,
    document_name: documentName,
    description,
    original_filename: input.file.name.slice(0, 255),
    storage_path: storagePath,
    mime_type: input.file.type as AgreementDocumentMimeType,
    size_bytes: input.file.size,
  };
  const storage = getSupabaseClient().storage.from(AGREEMENT_DOCUMENT_BUCKET);
  const { error: uploadError } = await storage.upload(storagePath, input.file, { contentType: input.file.type, cacheControl: "3600", upsert: false });
  if (uploadError) throw new Error(uploadError.message || "Document upload failed.");

  const { data, error: metadataError } = await getSupabaseClient().from("service_agreement_documents").insert(metadata).select().single();
  if (metadataError) {
    const { error: cleanupError } = await storage.remove([storagePath]);
    if (cleanupError) console.error("Agreement document cleanup after metadata failure failed", { storagePath, message: cleanupError.message });
    throw new Error(metadataError.message || "Document metadata could not be saved.");
  }
  return data as ServiceAgreementDocument;
}

export async function getAgreementDocumentSignedUrl(document: ServiceAgreementDocument, download = false): Promise<string> {
  if (document.archived_at) throw new Error("Restore this document before opening it.");
  const options = download ? { download: document.original_filename } : undefined;
  const { data, error } = await getSupabaseClient().storage.from(AGREEMENT_DOCUMENT_BUCKET).createSignedUrl(document.storage_path, SIGNED_URL_SECONDS, options);
  if (error) throw new Error(error.message || "A secure document link could not be created.");
  return data.signedUrl;
}

export async function archiveAgreementDocument(documentId: string): Promise<ServiceAgreementDocument> {
  return setArchivedAt(documentId, new Date().toISOString());
}

export async function restoreAgreementDocument(documentId: string): Promise<ServiceAgreementDocument> {
  return setArchivedAt(documentId, null);
}

export async function deleteAgreementDocument(document: ServiceAgreementDocument): Promise<void> {
  const client = getSupabaseClient();
  const { error: storageError } = await client.storage.from(AGREEMENT_DOCUMENT_BUCKET).remove([document.storage_path]);
  if (storageError) throw new Error(storageError.message || "The stored document could not be removed.");
  const { error: metadataError } = await client.from("service_agreement_documents").delete().eq("id", document.id).eq("storage_path", document.storage_path);
  if (metadataError) {
    const { error: archiveError } = await client.from("service_agreement_documents").update({ archived_at: document.archived_at ?? new Date().toISOString() }).eq("id", document.id);
    if (archiveError) console.error("Agreement document metadata recovery failed", { documentId: document.id, message: archiveError.message });
    throw new Error("The file was removed, but its metadata could not be deleted. Retry permanent deletion to finish cleanup.");
  }
}

export function validateAgreementDocument(file: File): void {
  if (!file || file.size < 1) throw new Error("Choose a non-empty document.");
  if (!(AGREEMENT_DOCUMENT_MIME_TYPES as readonly string[]).includes(file.type)) throw new Error("Unsupported file type. Choose a PDF, DOC, DOCX, JPEG, PNG, or WebP file.");
  if (file.size > MAX_AGREEMENT_DOCUMENT_BYTES) throw new Error("Document is too large. The maximum size is 25 MB.");
}

async function setArchivedAt(documentId: string, archivedAt: string | null): Promise<ServiceAgreementDocument> {
  assertUuid(documentId, "Document identifier is invalid.");
  const { data, error } = await getSupabaseClient().from("service_agreement_documents").update({ archived_at: archivedAt }).eq("id", documentId).select().single();
  if (error) throw new Error(error.message || "Document archive status could not be updated.");
  return data as ServiceAgreementDocument;
}

function sanitizedFilename(filename: string, mimeType: AgreementDocumentMimeType): string {
  const extension: Record<AgreementDocumentMimeType, string> = {
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  const withoutExtension = filename.replace(/\.[^.]+$/, "").normalize("NFKD").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "document";
  return `${withoutExtension}.${extension[mimeType]}`;
}

function assertUuid(value: string, message: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error(message);
}
