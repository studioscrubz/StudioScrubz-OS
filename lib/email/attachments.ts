import "server-only";
import { createHash } from "node:crypto";
import { EMAIL_ATTACHMENT_TYPES, MAX_EMAIL_FILES, MAX_EMAIL_FILE_BYTES, MAX_EMAIL_TOTAL_BYTES, type EmailAttachmentInput, type EmailAttachmentManifest } from "@/lib/email/attachmentLimits";

export class AttachmentError extends Error { constructor(message: string) { super(message); } }
export function parseEmailAttachments(input: unknown): { files: EmailAttachmentInput[]; manifest: EmailAttachmentManifest[] } {
  if (input === undefined || input === null) return { files: [], manifest: [] };
  if (!Array.isArray(input) || input.length > MAX_EMAIL_FILES) throw new AttachmentError("Select up to 3 attachments.");
  let total = 0;
  const files: EmailAttachmentInput[] = [];
  const manifest: EmailAttachmentManifest[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new AttachmentError("Invalid attachment.");
    const item = raw as Record<string, unknown>;
    const filename = item.filename;
    const contentType = item.contentType;
    const content = item.content;
    if (typeof filename !== "string" || !filename || filename.length > 150 ||
        /[/\\\x00-\x1f\x7f]/.test(filename) || filename === "." || filename === "..") throw new AttachmentError("Attachment filename is invalid.");
    const extension = filename.split(".").pop()?.toLowerCase() ?? "";
    const expectedType = EMAIL_ATTACHMENT_TYPES[extension];
    if (!expectedType || typeof contentType !== "string" || contentType.toLowerCase() !== expectedType) throw new AttachmentError("Only PDF, images, Word, Excel, TXT, and CSV attachments are supported.");
    if (typeof content !== "string" || !content || content.length > Math.ceil(MAX_EMAIL_FILE_BYTES / 3) * 4 + 8 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)) throw new AttachmentError("Attachment data is invalid or too large.");
    const bytes = Buffer.from(content, "base64");
    if (!bytes.length || bytes.length > MAX_EMAIL_FILE_BYTES || bytes.toString("base64") !== content) throw new AttachmentError("Attachment is empty or too large.");
    total += bytes.length;
    if (total > MAX_EMAIL_TOTAL_BYTES) throw new AttachmentError("Combined attachments must be 2 MB or less.");
    if (extension === "pdf" && bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new AttachmentError("The PDF attachment is invalid.");
    if ((extension === "jpg" || extension === "jpeg") && !(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) throw new AttachmentError("The JPEG attachment is invalid.");
    if (extension === "png" && !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new AttachmentError("The PNG attachment is invalid.");
    if (extension === "webp" && !(bytes.subarray(0,4).toString("ascii") === "RIFF" && bytes.subarray(8,12).toString("ascii") === "WEBP")) throw new AttachmentError("The WebP attachment is invalid.");
    if ((extension === "docx" || extension === "xlsx") && !(bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)) throw new AttachmentError("The Office attachment is invalid.");
    files.push({ filename, content, contentType: expectedType });
    manifest.push({ filename, contentType: expectedType, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  return { files, manifest };
}
export function sameAttachmentManifest(a: unknown, b: EmailAttachmentManifest[]): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b);
}
