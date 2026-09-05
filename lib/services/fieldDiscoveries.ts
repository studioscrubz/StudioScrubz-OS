import { getSupabaseClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/services/auth";
import { operationalPhotoExtension, prepareOperationalPhoto, validateOperationalPhoto } from "@/lib/services/photoStorage";
import { OPERATIONAL_PHOTO_BUCKET } from "@/types/photo";
import type { CreateFieldDiscoveryInput, FieldDiscoveryMedia, FieldDiscoveryMediaWithUrl, FieldDiscoveryStatus, OperationalFieldDiscovery } from "@/types/fieldDiscovery";

export type VisibleFieldDiscovery = OperationalFieldDiscovery & { estimated_extra_amount?: number | null };

export async function getFieldDiscoveriesForJob(jobId: string): Promise<VisibleFieldDiscovery[]> {
  const profile = await getCurrentProfile();
  const query = profile?.role === "Master Admin"
    ? getSupabaseClient().from("field_discoveries").select("*").eq("job_id", jobId).order("created_at", { ascending: false })
    : getSupabaseClient().from("field_discoveries_operational").select("*").eq("job_id", jobId).order("created_at", { ascending: false });
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as VisibleFieldDiscovery[];
}

export async function createFieldDiscovery(input: CreateFieldDiscoveryInput): Promise<string> {
  const { data, error } = await getSupabaseClient().rpc("create_field_discovery", {
    p_job_id: input.jobId,
    p_area: input.area,
    p_description: input.description,
    p_estimated_extra_minutes: input.estimatedExtraMinutes,
    p_estimated_extra_amount: input.estimatedExtraAmount,
  });
  if (error) throw error;
  return data;
}

export async function updateFieldDiscoveryStatus(id: string, status: Exclude<FieldDiscoveryStatus, "Converted to Change Request">): Promise<void> {
  const { error } = await getSupabaseClient().rpc("update_field_discovery_status", { p_field_discovery_id: id, p_status: status });
  if (error) throw error;
}

export async function uploadFieldDiscoveryMedia(discoveryId: string, files: File[]): Promise<FieldDiscoveryMediaWithUrl[]> {
  const client = getSupabaseClient();
  const { data: discovery, error: discoveryError } = await client.from("field_discoveries_operational").select("job_id").eq("id", discoveryId).single();
  if (discoveryError) throw discoveryError;
  for (const selected of files) {
    validateOperationalPhoto(selected);
    const file = await prepareOperationalPhoto(selected);
    const path = `jobs/${discovery.job_id}/discoveries/${discoveryId}/${crypto.randomUUID()}.${operationalPhotoExtension(file)}`;
    const { error: uploadError } = await client.storage.from(OPERATIONAL_PHOTO_BUCKET).upload(path, file, { contentType: file.type, upsert: false, cacheControl: "3600" });
    if (uploadError) throw uploadError;
    const { error: recordError } = await client.rpc("add_field_discovery_media", { p_field_discovery_id: discoveryId, p_storage_path: path, p_media_type: file.type });
    if (recordError) throw new Error(`The photo was uploaded but could not be attached to the discovery: ${recordError.message}`);
  }
  return getFieldDiscoveryMedia(discoveryId);
}

export async function getFieldDiscoveryMedia(discoveryId: string): Promise<FieldDiscoveryMediaWithUrl[]> {
  const client = getSupabaseClient();
  const { data, error } = await client.from("field_discovery_media").select("*").eq("field_discovery_id", discoveryId).order("created_at");
  if (error) throw error;
  const media = (data ?? []) as FieldDiscoveryMedia[];
  if (!media.length) return [];
  const { data: signed, error: signedError } = await client.storage.from(OPERATIONAL_PHOTO_BUCKET).createSignedUrls(media.map((item) => item.storage_path), 15 * 60);
  if (signedError) throw signedError;
  return media.map((item, index) => ({ ...item, signedUrl: signed[index]?.signedUrl ?? null }));
}

export function canCreateFieldDiscovery(role: string | null): boolean {
  return ["Master Admin", "Administrator", "Manager", "Crew Lead", "Scrub Technician"].includes(role ?? "");
}

export function canReviewFieldDiscovery(role: string | null): boolean {
  return ["Master Admin", "Administrator", "Manager"].includes(role ?? "");
}
