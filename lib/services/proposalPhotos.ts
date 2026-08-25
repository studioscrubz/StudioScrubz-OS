import { getSupabaseClient } from "@/lib/supabase/client";
import { operationalPhotoExtension, prepareOperationalPhoto, validateOperationalPhoto } from "@/lib/services/photoStorage";
import { OPERATIONAL_PHOTO_BUCKET } from "@/types/photo";
import type { ProposalPricingPhoto, ProposalPricingPhotoRemoval, ProposalPricingPhotoWithUrl } from "@/types/proposal";

const SIGNED_URL_SECONDS = 15 * 60;

export async function getProposalPricingPhotos(proposalId: string): Promise<ProposalPricingPhoto[]> {
  const { data, error } = await getSupabaseClient().rpc("get_proposal_pricing_photos", { p_proposal_id: proposalId });
  if (error) throw new Error(error.message || "Proposal pricing photos could not be loaded.");
  return normalizeProposalPricingPhotos(data);
}

export async function createProposalPhotoSignedUrls(photos: ProposalPricingPhoto[]): Promise<ProposalPricingPhotoWithUrl[]> {
  const paths = [...new Set(photos.map((photo) => photo.storagePath).filter((path): path is string => Boolean(path)))];
  if (!paths.length) return photos.map((photo) => ({ ...photo, signedUrl: null }));
  const { data, error } = await getSupabaseClient().storage.from(OPERATIONAL_PHOTO_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
  if (error) throw new Error(error.message || "Proposal photo previews could not be loaded.");
  const urls = new Map(paths.map((path, index) => [path, data[index]?.signedUrl ?? null]));
  return photos.map((photo) => ({ ...photo, signedUrl: photo.storagePath ? urls.get(photo.storagePath) ?? null : null }));
}

export async function uploadProposalPricingPhoto(input: { proposalId: string; file: File; caption: string; source: "camera" | "library" }): Promise<ProposalPricingPhoto> {
  if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("An internet connection is required to upload photos.");
  validateOperationalPhoto(input.file);
  const file = await prepareOperationalPhoto(input.file);
  const id = crypto.randomUUID();
  const path = `proposals/${input.proposalId}/${id}.${operationalPhotoExtension(file)}`;
  const storage = getSupabaseClient().storage.from(OPERATIONAL_PHOTO_BUCKET);
  const { error: uploadError } = await storage.upload(path, file, { contentType: file.type, upsert: false, cacheControl: "3600" });
  if (uploadError) throw new Error(uploadError.message || "Proposal photo upload failed.");
  const { data, error } = await getSupabaseClient().rpc("add_proposal_owned_photo", {
    p_proposal_id: input.proposalId,
    p_photo_id: id,
    p_storage_path: path,
    p_original_filename: input.file.name,
    p_caption: input.caption,
    p_source: input.source,
  });
  if (error) {
    const { error: cleanupError } = await storage.remove([path]);
    if (cleanupError) console.error("Proposal upload cleanup failed", cleanupError);
    throw new Error(error.message || "Proposal photo could not be registered.");
  }
  const photo = normalizeProposalPricingPhotos([data])[0];
  if (!photo) throw new Error("Proposal photo registration returned invalid metadata.");
  return photo;
}

export async function setProposalPricingPhotoCaption(proposalId: string, photoId: string, caption: string): Promise<ProposalPricingPhoto[]> {
  const { data, error } = await getSupabaseClient().rpc("set_proposal_pricing_photo_caption", { p_proposal_id: proposalId, p_photo_id: photoId, p_caption: caption });
  if (error) throw new Error(error.message || "Proposal photo caption could not be saved.");
  return normalizeProposalPricingPhotos(data);
}

export async function removeProposalPricingPhoto(proposalId: string, photoId: string): Promise<ProposalPricingPhotoRemoval> {
  const { data, error } = await getSupabaseClient().rpc("remove_proposal_pricing_photo", { p_proposal_id: proposalId, p_photo_id: photoId });
  if (error) throw new Error(error.message || "Proposal photo could not be removed.");
  const result = data as unknown as Partial<ProposalPricingPhotoRemoval>;
  const photos = normalizeProposalPricingPhotos(result.photos);
  const removedPhoto = normalizeProposalPricingPhotos([result.removedPhoto])[0];
  if (!removedPhoto) throw new Error("Proposal photo removal returned invalid metadata.");
  if (result.deleteStorageObject && removedPhoto.storagePath) {
    const { error: storageError } = await getSupabaseClient().storage.from(OPERATIONAL_PHOTO_BUCKET).remove([removedPhoto.storagePath]);
    if (storageError) throw new Error(`The Proposal reference was removed, but its uploaded file could not be deleted: ${storageError.message}`);
  }
  return { photos, removedPhoto, deleteStorageObject: result.deleteStorageObject === true };
}

function normalizeProposalPricingPhotos(value: unknown): ProposalPricingPhoto[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== "string" || !item.id.trim()) return [];
    return [{
      id: item.id,
      storagePath: typeof item.storagePath === "string" ? item.storagePath : null,
      ...(typeof item.fileName === "string" ? { fileName: item.fileName } : {}),
      ...(typeof item.category === "string" ? { category: item.category } : {}),
      ...(typeof item.originalFilename === "string" ? { originalFilename: item.originalFilename } : {}),
      ...(typeof item.mimeType === "string" ? { mimeType: item.mimeType } : {}),
      ...(typeof item.sizeBytes === "number" ? { sizeBytes: item.sizeBytes } : {}),
      ...(typeof item.uploadedAt === "string" ? { uploadedAt: item.uploadedAt } : {}),
      ...(typeof item.uploadedBy === "string" ? { uploadedBy: item.uploadedBy } : {}),
      ...(typeof item.caption === "string" || item.caption === null ? { caption: item.caption as string | null } : {}),
      ...(item.source === "camera" || item.source === "library" ? { source: item.source } : {}),
      ...(item.ownership === "walkthrough-reference" || item.ownership === "proposal" ? { ownership: item.ownership } : {}),
    }];
  });
}
