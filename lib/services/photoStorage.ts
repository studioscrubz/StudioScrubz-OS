import { getSupabaseClient } from "@/lib/supabase/client";
import {
  MAX_OPERATIONAL_PHOTO_BYTES,
  OPERATIONAL_PHOTO_BUCKET,
  OPERATIONAL_PHOTO_MIME_TYPES,
  type OperationalPhoto,
  type OperationalPhotoCategory,
  type OperationalPhotoRecordType,
  type OperationalPhotoWithUrl,
} from "@/types/photo";

const SIGNED_URL_SECONDS = 15 * 60;

export async function getOperationalPhotos(recordType: OperationalPhotoRecordType, recordId: string): Promise<OperationalPhoto[]> {
  assertSavedRecordId(recordId);
  const { data, error } = await getSupabaseClient().rpc("get_operational_photos", { p_record_type: recordType, p_record_id: recordId });
  if (error) { console.error("Operational photo metadata load failed", { recordType, recordId, message: error.message, code: error.code }); throw new Error(error.message || "Photos could not be loaded."); }
  return normalizePhotos(data);
}

export async function createPhotoSignedUrls(photos: OperationalPhoto[]): Promise<OperationalPhotoWithUrl[]> {
  if (!photos.length) return [];
  const { data, error } = await getSupabaseClient().storage.from(OPERATIONAL_PHOTO_BUCKET).createSignedUrls(photos.map((photo) => photo.storagePath), SIGNED_URL_SECONDS);
  if (error) { console.error("Operational photo signed URL generation failed", { bucket: OPERATIONAL_PHOTO_BUCKET, photoCount: photos.length, message: error.message }); throw new Error(error.message || "Photo previews could not be loaded."); }
  return photos.map((photo, index) => ({ ...photo, signedUrl: data[index]?.signedUrl ?? null }));
}

export async function uploadOperationalPhoto(input: { recordType: OperationalPhotoRecordType; recordId: string; category: OperationalPhotoCategory; caption: string | null; source: "camera" | "library"; customerVisible: boolean; file: File }): Promise<OperationalPhoto[]> {
  if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("An internet connection is required to upload photos.");
  assertSavedRecordId(input.recordId);
  validateOperationalPhoto(input.file);
  const file = await prepareOperationalPhoto(input.file);
  const user = await authenticatedUserId();
  const id = crypto.randomUUID();
  const extension = operationalPhotoExtension(file);
  const categoryFolder = input.recordType === "jobs" ? jobFolder(input.category) : null;
  const storagePath = [input.recordType, input.recordId, categoryFolder, `${id}.${extension}`].filter(Boolean).join("/");
  const photo: OperationalPhoto = { id, storagePath, category: input.category, originalFilename: input.file.name, mimeType: file.type, sizeBytes: file.size, uploadedAt: new Date().toISOString(), uploadedBy: user, caption: input.caption?.trim() || null, source: input.source, customerVisible: input.customerVisible };
  const storage = getSupabaseClient().storage.from(OPERATIONAL_PHOTO_BUCKET);
  const { error: uploadError } = await storage.upload(storagePath, file, { contentType: file.type, upsert: false, cacheControl: "3600" });
  if (uploadError) { console.error("Operational photo Storage upload failed", { bucket: OPERATIONAL_PHOTO_BUCKET, recordType: input.recordType, recordId: input.recordId, category: input.category, storagePath, message: uploadError.message }); throw new Error(uploadError.message || "Photo upload failed."); }
  let metadataPersisted = false;
  try {
    const current = await getOperationalPhotos(input.recordType, input.recordId);
    const next = [...current.filter((item) => item.id !== photo.id && item.storagePath !== photo.storagePath), photo];
    const persisted = await saveMetadata(input.recordType, input.recordId, next);
    if (!persisted.some((item) => item.id === photo.id && item.storagePath === photo.storagePath)) {
      throw new Error("Photo metadata registration did not persist the uploaded photo.");
    }
    metadataPersisted = true;
    const confirmed = await getOperationalPhotos(input.recordType, input.recordId);
    if (!confirmed.some((item) => item.id === photo.id && item.storagePath === photo.storagePath)) {
      throw new Error("Photo metadata registration could not be confirmed on the saved Walkthrough.");
    }
    return confirmed;
  } catch (error) {
    if (metadataPersisted) {
      throw new Error(`${message(error, "Photo metadata confirmation failed.")} The metadata RPC succeeded, so the uploaded object was preserved; refresh the Walkthrough before retrying.`);
    }
    const { error: cleanupError } = await storage.remove([storagePath]);
    if (cleanupError) {
      console.error("Operational photo cleanup after metadata failure failed", { bucket: OPERATIONAL_PHOTO_BUCKET, recordType: input.recordType, recordId: input.recordId, storagePath, message: cleanupError.message });
      throw new Error(`${message(error, "Photo metadata could not be saved.")} The uploaded object also could not be cleaned up: ${cleanupError.message}`);
    }
    throw error;
  }
}

export async function updateOperationalPhotoCaption(recordType: OperationalPhotoRecordType, recordId: string, currentPhotos: OperationalPhoto[], photoId: string, caption: string): Promise<OperationalPhoto[]> {
  const next = currentPhotos.map((photo) => photo.id === photoId ? { ...photo, caption: caption.trim() || null } : photo);
  await saveMetadata(recordType, recordId, next);
  return next;
}

export async function updateOperationalPhotoVisibility(recordType: OperationalPhotoRecordType, recordId: string, currentPhotos: OperationalPhoto[], photoId: string, customerVisible: boolean): Promise<OperationalPhoto[]> {
  const next = currentPhotos.map((photo) => photo.id === photoId ? { ...photo, customerVisible } : photo);
  return saveMetadata(recordType, recordId, next);
}

export async function deleteOperationalPhoto(recordType: OperationalPhotoRecordType, recordId: string, currentPhotos: OperationalPhoto[], photo: OperationalPhoto): Promise<OperationalPhoto[]> {
  const next = currentPhotos.filter((item) => item.id !== photo.id);
  await saveMetadata(recordType, recordId, next);
  const { error } = await getSupabaseClient().storage.from(OPERATIONAL_PHOTO_BUCKET).remove([photo.storagePath]);
  if (error) {
    try { await saveMetadata(recordType, recordId, currentPhotos); } catch (restoreError) { console.error("Photo metadata recovery failed", restoreError); }
    throw error;
  }
  return next;
}

async function saveMetadata(recordType: OperationalPhotoRecordType, recordId: string, photos: OperationalPhoto[]): Promise<OperationalPhoto[]> {
  const { data, error } = await getSupabaseClient().rpc("set_operational_photos", { p_record_type: recordType, p_record_id: recordId, p_photos: photos });
  if (error) { console.error("Operational photo metadata RPC failed", { recordType, recordId, photoCount: photos.length, message: error.message, code: error.code }); throw new Error(error.message || "Photo metadata could not be saved."); }
  return normalizePhotos(data);
}

export function validateOperationalPhoto(file: File) {
  if (!(OPERATIONAL_PHOTO_MIME_TYPES as readonly string[]).includes(file.type)) throw new Error("Unsupported file type. Choose a JPEG, PNG, WebP, HEIC, or HEIF photo.");
  if (file.size > MAX_OPERATIONAL_PHOTO_BYTES) throw new Error("Photo is too large. The maximum size is 10 MB.");
}

async function authenticatedUserId() {
  const { data, error } = await getSupabaseClient().auth.getUser();
  if (error || !data.user) throw new Error("You must be signed in to upload photos.");
  return data.user.id;
}

export function operationalPhotoExtension(file: File) { return file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : file.type === "image/heic" ? "heic" : "heif"; }
function assertSavedRecordId(recordId: string) { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(recordId)) throw new Error("Save this record before uploading photos."); }
function jobFolder(category: OperationalPhotoCategory) { return category === "Before" ? "before" : category === "After" ? "after" : category === "Damage / Issue" ? "damage" : "other"; }

export function defaultOperationalPhotoCustomerVisibility(recordType: OperationalPhotoRecordType, category: OperationalPhotoCategory) {
  if (recordType === "walkthroughs") return true;
  return category !== "Other";
}

export async function prepareOperationalPhoto(file: File): Promise<File> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size < 1_500_000) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
  if (scale === 1) { bitmap.close(); return file; }
  const canvas = document.createElement("canvas"); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  const mime = file.type === "image/png" ? "image/png" : file.type;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, mime === "image/png" ? undefined : 0.86));
  if (!blob || blob.size >= file.size) return file;
  return new File([blob], file.name, { type: mime, lastModified: file.lastModified });
}

function normalizePhotos(value: unknown): OperationalPhoto[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is OperationalPhoto => Boolean(item && typeof item === "object" && typeof (item as OperationalPhoto).id === "string" && typeof (item as OperationalPhoto).storagePath === "string")).map((photo) => ({ ...photo, source: photo.source === "camera" ? "camera" : "library", customerVisible: photo.customerVisible === true }));
}

function message(error: unknown, fallback: string) { return error instanceof Error && error.message ? error.message : fallback; }
