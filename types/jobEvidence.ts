export const JOB_EVIDENCE_TYPES=["Before","During","After","Completion","Issue","Other"] as const;
export type JobEvidenceType=typeof JOB_EVIDENCE_TYPES[number];
export type JobEvidence={id:string;job_id:string;scope_snapshot_id:string|null;change_request_id:string|null;field_discovery_id:string|null;evidence_type:JobEvidenceType;area:string|null;description:string|null;captured_by:string|null;captured_at:string;created_at:string};
export type JobEvidenceMedia={id:string;job_evidence_id:string;storage_path:string;media_type:string|null;created_at:string};
export type JobEvidenceMediaWithUrl=JobEvidenceMedia&{signedUrl:string|null};
