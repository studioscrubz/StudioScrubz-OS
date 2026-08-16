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
  const { data, error } = await getSupabaseClient().rpc("get_operational_photos", { p_record_type: recordType, p_record_id: recordId });
  if (error) throw error;
  return normalizePhotos(data);
}

export async function createPhotoSignedUrls(photos: OperationalPhoto[]): Promise<OperationalPhotoWithUrl[]> {
  if (!photos.length) return [];
  const { data, error } = await getSupabaseClient().storage.from(OPERATIONAL_PHOTO_BUCKET).createSignedUrls(photos.map((photo) => photo.storagePath), SIGNED_URL_SECONDS);
  if (error) throw error;
  return photos.map((photo, index) => ({ ...photo, signedUrl: data[index]?.signedUrl ?? null }));
}

export async function uploadOperationalPhoto(input: { recordType: OperationalPhotoRecordType; recordId: string; category: OperationalPhotoCategory; caption: string | null; source: "camera" | "library"; file: File; currentPhotos: OperationalPhoto[] }): Promise<OperationalPhoto[]> {
  if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("An internet connection is required to upload photos.");
  validateOperationalPhoto(input.file);
  const file = await compressPhoto(input.file);
  const user = await authenticatedUserId();
  const id = crypto.randomUUID();
  const extension = safeExtension(file);
  const categoryFolder = input.recordType === "jobs" ? jobFolder(input.category) : null;
  const storagePath = [input.recordType, input.recordId, categoryFolder, `${id}.${extension}`].filter(Boolean).join("/");
  const photo: OperationalPhoto = { id, storagePath, category: input.category, originalFilename: input.file.name, mimeType: file.type, sizeBytes: file.size, uploadedAt: new Date().toISOString(), uploadedBy: user, caption: input.caption?.trim() || null, source: input.source };
  const storage = getSupabaseClient().storage.from(OPERATIONAL_PHOTO_BUCKET);
  const { error: uploadError } = await storage.upload(storagePath, file, { contentType: file.type, upsert: false, cacheControl: "3600" });
  if (uploadError) throw uploadError;
  const next = [...input.currentPhotos, photo];
  try { await saveMetadata(input.recordType, input.recordId, next); }
  catch (error) { await storage.remove([storagePath]); throw error; }
  return next;
}

export async function updateOperationalPhotoCaption(recordType: OperationalPhotoRecordType, recordId: string, currentPhotos: OperationalPhoto[], photoId: string, caption: string): Promise<OperationalPhoto[]> {
  const next = currentPhotos.map((photo) => photo.id === photoId ? { ...photo, caption: caption.trim() || null } : photo);
  await saveMetadata(recordType, recordId, next);
  return next;
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

async function saveMetadata(recordType: OperationalPhotoRecordType, recordId: string, photos: OperationalPhoto[]) {
  const { error } = await getSupabaseClient().rpc("set_operational_photos", { p_record_type: recordType, p_record_id: recordId, p_photos: photos });
  if (error) throw error;
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

function safeExtension(file: File) { return file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : file.type === "image/heic" ? "heic" : "heif"; }
function jobFolder(category: OperationalPhotoCategory) { return category === "Before" ? "before" : category === "After" ? "after" : category === "Damage / Issue" ? "damage" : "other"; }

async function compressPhoto(file: File): Promise<File> {
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
  return value.filter((item): item is OperationalPhoto => Boolean(item && typeof item === "object" && typeof (item as OperationalPhoto).id === "string" && typeof (item as OperationalPhoto).storagePath === "string")).map((photo) => ({ ...photo, source: photo.source === "camera" ? "camera" : "library" }));
}
