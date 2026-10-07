type RpcError = { message: string };
type PermanentDeleteRpcResult = { data: unknown; error: RpcError | null };

export type PermanentDeleteRpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<PermanentDeleteRpcResult>;
};

export function invokePermanentAssessmentDeleteRpc(client: PermanentDeleteRpcClient, assessmentId: string) {
  return client.rpc("master_admin_permanently_delete_assessment", { p_assessment_id: assessmentId });
}

export function assessmentPhotoPaths(value: unknown, assessmentId: string): string[] {
  if (!Array.isArray(value)) return [];
  const prefix = `walkthroughs/${assessmentId}/`;
  const paths = value.flatMap((photo) => {
    if (typeof photo === "string") return photo.startsWith(prefix) ? [photo] : [];
    if (!photo || typeof photo !== "object") return [];
    const row = photo as Record<string, unknown>;
    const path = [row.storagePath, row.storage_path, row.path].find((candidate): candidate is string => typeof candidate === "string");
    return path?.startsWith(prefix) ? [path] : [];
  });
  return [...new Set(paths)];
}
