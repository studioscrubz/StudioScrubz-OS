export const FIELD_DISCOVERY_STATUSES = ["Open", "Reviewed", "Converted to Change Request", "Dismissed"] as const;
export type FieldDiscoveryStatus = (typeof FIELD_DISCOVERY_STATUSES)[number];
export type FieldDiscovery = { id:string; job_id:string; scope_snapshot_id:string|null; discovered_by:string|null; area:string|null; description:string; estimated_extra_minutes:number|null; estimated_extra_amount:number|null; status:FieldDiscoveryStatus; created_at:string; updated_at:string };
export type OperationalFieldDiscovery = Omit<FieldDiscovery, "estimated_extra_amount">;
export type FieldDiscoveryMedia = { id:string; field_discovery_id:string; storage_path:string; media_type:string|null; created_at:string };
export type FieldDiscoveryMediaWithUrl = FieldDiscoveryMedia & { signedUrl:string|null };
export type CreateFieldDiscoveryInput = { jobId:string; area:string|null; description:string; estimatedExtraMinutes:number|null; estimatedExtraAmount:number|null };
