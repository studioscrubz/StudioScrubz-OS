export const MAX_EMAIL_FILES = 3;
export const MAX_EMAIL_FILE_BYTES = 2_000_000;
export const MAX_EMAIL_TOTAL_BYTES = 2_000_000;
export const EMAIL_ATTACHMENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  txt: "text/plain",
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
export type EmailAttachmentInput = { filename: string; content: string; contentType: string };
export type EmailAttachmentManifest = { filename: string; contentType: string; bytes: number; sha256: string };
