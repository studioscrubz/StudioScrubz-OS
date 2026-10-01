export type EnrichmentStatus="Pending"|"In Progress"|"Complete"|"Partially Enriched"|"No Additional Data Found"|"Failed";
export type EnrichmentDecision="Pending"|"Accepted"|"Rejected";
export type EnrichmentFieldName="website"|"business_email"|"business_phone"|"address"|"city"|"state"|"zip"|"contact_page_url"|"contact_name"|"contact_title";
export type EnrichmentSourceType="Official Website"|"OpenStreetMap"|"Generated Candidate";
export type EnrichmentVerificationStatus="published"|"verified"|"valid"|"catch_all"|"risky"|"unverified"|"invalid"|"unknown";
export interface EnrichmentCandidate{id:string;fieldName:EnrichmentFieldName;value:string;normalizedValue:string|null;sourceType:EnrichmentSourceType;sourceUrl:string;sourcePageType:string;confidence:number;retrievedAt:string;decision:EnrichmentDecision;providerKey?:string;verificationStatus?:EnrichmentVerificationStatus;identityConfidence?:number;evidenceIds?:string[];evidenceCount?:number;published?:boolean;generated?:boolean;technicalVerificationStatus?:EnrichmentVerificationStatus}
export interface EnrichmentReviewItem{itemId:string;resultId:string;status:EnrichmentStatus;error:string|null;completedAt:string|null;candidates:EnrichmentCandidate[]}
export interface EnrichmentResponse{runId:string;items:EnrichmentReviewItem[]}
