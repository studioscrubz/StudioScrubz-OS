export type ProspectVerificationStatus = "Unverified" | "Pending" | "Verified" | "Invalid";
export type ProspectStatus = "New" | "Researching" | "Qualified" | "Contact Later" | "Disqualified";

export interface Prospect {
  id: string;
  company_name: string;
  contact_name: string | null;
  industry: string | null;
  company_type: string | null;
  website: string | null;
  domain_normalized: string | null;
  business_email: string | null;
  email_normalized: string | null;
  business_phone: string | null;
  phone_normalized: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  territory: string | null;
  services: string[];
  recurring_potential: boolean;
  estimated_value: number | null;
  source_type: string;
  source_url: string | null;
  discovered_at: string;
  verified_at: string | null;
  verification_status: ProspectVerificationStatus;
  score: number;
  score_explanation: string;
  assigned_user_id: string | null;
  status: ProspectStatus;
  next_action: string | null;
  next_follow_up_at: string | null;
  notes: string | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  name_address_normalized: string | null;
  merged_into_prospect_id: string | null;
  merged_at: string | null;
  merged_by: string | null;
}

export type ProspectInput = Pick<Prospect,
  "company_name" | "contact_name" | "industry" | "company_type" | "website" | "business_email" |
  "business_phone" | "address" | "city" | "state" | "zip" | "territory" |
  "services" | "recurring_potential" | "estimated_value" | "source_type" |
  "source_url" | "discovered_at" | "verified_at" | "verification_status" |
  "assigned_user_id" | "status" | "next_action" | "next_follow_up_at" | "notes"
>;

export interface ProspectEvent {
  id: string;
  prospect_id: string;
  event_type: "Created" | "Assignment Changed" | "Status Changed" | "Verification Changed" | "Notes Changed";
  actor_user_id: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface ProspectSuppression {
  id: string;
  email_normalized: string | null;
  phone_normalized: string | null;
  domain_normalized: string | null;
  reason: string;
  created_by: string;
  created_at: string;
}

export interface ProspectAssignee { id: string; display_name: string }

export type ProspectDuplicateClass = "New" | "Exact duplicate" | "Possible duplicate" | "Invalid";
export type ProspectImportDecision = "Skip" | "Import Separately" | "Merge";
export type ProspectCsvField = "company_name" | "contact_name" | "business_email" | "business_phone" | "website" | "address" | "city" | "state" | "zip" | "industry" | "notes" | "source";
export type ProspectCsvValues = Partial<Record<ProspectCsvField,string>>;
export interface ProspectImportPreviewRow { rowNumber:number; fingerprint:string; values:ProspectCsvValues; classification:ProspectDuplicateClass; decision:ProspectImportDecision|""; matchedProspectId:string|null; error:string|null }
export interface ProspectImportResult { imported:number; skipped:number; failed:number; processed:number }
