import { getSupabaseClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/services/auth";
import { hasPermission } from "@/lib/auth/permissions";
import { operationalPhotoExtension, prepareOperationalPhoto, validateOperationalPhoto } from "@/lib/services/photoStorage";
import { OPERATIONAL_PHOTO_BUCKET } from "@/types/photo";
import { validatePorterIssue, type PorterIssue, type PorterIssueInput, type PorterPhoto, type PorterPhotoWithUrl } from "@/types/porterReporting";

async function authorize(management = false) {
  if (!hasPermission(await getCurrentProfile(), management ? "porterVisits.manage" : "porterVisits.view")) throw new Error("Porter Visit access denied.");
}
export async function uploadPorterPhoto(input: { visitId: string; areaId: string | null; issueId: string | null; caption: string | null; file: File }) {
  await authorize();
  validateOperationalPhoto(input.file);
  if (!input.file.size) throw new Error("Choose a non-empty image.");
  const file = await prepareOperationalPhoto(input.file);
  validateOperationalPhoto(file);
  const path = `porter-visits/${input.visitId}/${crypto.randomUUID()}.${operationalPhotoExtension(file)}`;
  const db = getSupabaseClient();
  const storage = db.storage.from(OPERATIONAL_PHOTO_BUCKET);
  const { error } = await storage.upload(path, file, { contentType: file.type, upsert: false, cacheControl: "3600" });
  if (error) throw new Error(`Photo upload failed: ${error.message}`);
  try {
    const registered = await db.rpc("add_porter_visit_photo", {
      p_visit_id: input.visitId, p_visit_area_id: input.areaId, p_issue_id: input.issueId,
      p_storage_path: path, p_file_name: input.file.name, p_caption: input.caption,
    });
    if (registered.error) throw new Error(registered.error.message);
    return registered.data;
  } catch (error) {
    // Storage policy only permits cleanup of unregistered uploader-owned objects.
    // If an ambiguous response follows a committed registration, deletion is denied.
    const cleanup = await storage.remove([path]).catch(() => ({ error: true }));
    throw new Error(`Photo could not be attached: ${error instanceof Error ? error.message : "Registration failed."}${cleanup.error ? " Uploaded object retained; refresh before retrying." : ""}`);
  }
}
export async function signPorterPhotos(photos: PorterPhoto[]): Promise<PorterPhotoWithUrl[]> {
  await authorize();
  if (!photos.length) return [];
  const { data, error } = await getSupabaseClient().storage.from(OPERATIONAL_PHOTO_BUCKET).createSignedUrls(photos.map(photo => photo.storage_path), 15 * 60);
  if (error) throw new Error(`Photo previews could not be loaded: ${error.message}`);
  return photos.map((photo, index) => ({ ...photo, signedUrl: data[index]?.signedUrl ?? null }));
}
export async function savePorterIssue(visitId: string, input: PorterIssueInput, existing?: PorterIssue) {
  await authorize(); validatePorterIssue(input);
  const { data, error } = await getSupabaseClient().rpc("save_porter_visit_issue", {
    p_visit_id: visitId, p_issue_id: existing?.id ?? null, p_expected_updated_at: existing?.updated_at ?? null,
    p_action: existing ? "edit" : "report", p_data: input,
  });
  if (error) throw new Error(`Issue could not be saved: ${error.message}`);
  return data;
}
export async function resolvePorterIssue(issue: PorterIssue, action: "acknowledge" | "resolve", resolutionNotes: string) {
  await authorize(true);
  const { data, error } = await getSupabaseClient().rpc("save_porter_visit_issue", {
    p_visit_id: issue.visit_id, p_issue_id: issue.id, p_expected_updated_at: issue.updated_at,
    p_action: action, p_data: { resolution_notes: resolutionNotes.trim() || null },
  });
  if (error) throw new Error(`Issue status could not be saved: ${error.message}`);
  return data;
}
