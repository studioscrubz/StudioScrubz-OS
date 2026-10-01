export type EnrichmentFieldName="website"|"business_email"|"business_phone"|"address"|"city"|"state"|"zip"|"contact_page_url"|"contact_name"|"contact_title";
export type ProviderCapability="company_resolution"|"domain_resolution"|"business_contact_enrichment"|"business_email_find"|"person_email_pattern"|"business_phone_find"|"email_verification"|"phone_verification";
export type ProviderSourceType="OpenStreetMap"|"Official Website"|"Generated Candidate";
export type VerificationStatus="published"|"verified"|"valid"|"catch_all"|"risky"|"unverified"|"invalid"|"unknown";
export type ProviderCostClass="free"|"paid";
const BLOCKED_METADATA_KEY=/(authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|secret|password|cookie|raw[-_]?response|html)/i;
const MAX_METADATA_KEYS=30;
const MAX_METADATA_STRING_LENGTH=500;

export function sanitizeProviderMetadata(value:unknown,depth=0):Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value)||depth>2)return{};
  const clean:Record<string,unknown>={};
  for(const[key,raw]of Object.entries(value as Record<string,unknown>).slice(0,MAX_METADATA_KEYS)){
    if(BLOCKED_METADATA_KEY.test(key))continue;
    if(typeof raw==="string")clean[key]=raw.slice(0,MAX_METADATA_STRING_LENGTH);
    else if(typeof raw==="number"&&Number.isFinite(raw))clean[key]=raw;
    else if(typeof raw==="boolean"||raw===null)clean[key]=raw;
    else if(raw&&typeof raw==="object"&&!Array.isArray(raw))clean[key]=sanitizeProviderMetadata(raw,depth+1);
    else if(Array.isArray(raw))clean[key]=raw.slice(0,20).filter(item=>typeof item==="string"||typeof item==="number"||typeof item==="boolean").map(item=>typeof item==="string"?item.slice(0,MAX_METADATA_STRING_LENGTH):item);
  }
  return clean;
}

export interface EnrichmentSubject{
  discoveryResultId:string;
  businessName:string;
  website?:string;
  verifiedDomain?:string;
  email?:string;
  phone?:string;
  address?:string;
  city?:string;
  state?:string;
  zip?:string;
  sourceUrl?:string;
  locationQuery?:string;
}

export interface ProviderEvidence{
  providerKey:string;
  providerVersion:string;
  providerCallId?:string;
  sourceKind:string;
  sourceType:ProviderSourceType;
  sourceUrl:string;
  sourcePageType:string;
  verificationStatus:VerificationStatus;
  discoveredAt:string;
  verifiedAt?:string;
  providerRecordId?:string;
  providerMetadata?:Record<string,unknown>;
}

export interface ProviderUsage{creditsUsed?:number;costMinorUnits?:number;costCurrency?:string}

// The top-level fields deliberately match the existing staging RPC payload.
export interface ProviderCandidate{
  fieldName:EnrichmentFieldName;
  value:string;
  normalizedValue:string;
  sourceType:ProviderSourceType;
  sourceUrl:string;
  sourcePageType:string;
  confidence:number;
  retrievedAt:string;
  evidence:ProviderEvidence;
  usage?:ProviderUsage;
}

export interface ProviderResult{
  status:"complete"|"partial"|"not_found"|"failed";
  candidates:ProviderCandidate[];
  usage?:ProviderUsage;
  resolvedCompany?:{website:string;domain:string};
  retryable?:boolean;
  errorCode?:string;
  providerRequestId?:string;
  httpStatus?:number;
  responseMetadata?:Record<string,unknown>;
}

export interface ProviderContext{signal?:AbortSignal;requestId:string;allowPaidCall:boolean;evidenceCandidates?:readonly ProviderCandidate[]}
export type ProviderStopPolicy="baseline"|"when-needed"|"last-resort";
export interface ProviderDescriptor{
  providerKey:string;
  version:string;
  capabilities:readonly ProviderCapability[];
  priority:number;
  costClass:ProviderCostClass;
  enabled:boolean;
  requiresVerifiedDomain:boolean;
  requiresWebsite:boolean;
  supportsCache:boolean;
  stopPolicy:ProviderStopPolicy;
  estimatedCredits?:number;
  estimatedCostMinorUnits?:number;
}
export interface CompanyDomainResolver extends ProviderDescriptor{resolveCompany(subject:EnrichmentSubject,context:ProviderContext):Promise<ProviderResult>}
export interface BusinessContactEnricher extends ProviderDescriptor{enrichBusiness(subject:EnrichmentSubject,context:ProviderContext):Promise<ProviderResult>}
export interface EmailFinder extends ProviderDescriptor{findEmails(subject:EnrichmentSubject,context:ProviderContext):Promise<ProviderResult>}
export interface EmailVerifier extends ProviderDescriptor{verifyEmails(candidates:readonly ProviderCandidate[],subject:EnrichmentSubject,context:ProviderContext):Promise<ProviderResult>}
export interface PhoneFinder extends ProviderDescriptor{findPhones(subject:EnrichmentSubject,context:ProviderContext):Promise<ProviderResult>}
export type EnrichmentProvider=CompanyDomainResolver|BusinessContactEnricher|EmailFinder|EmailVerifier|PhoneFinder;

export class ProviderRegistry{
  readonly providers:readonly EnrichmentProvider[];
  constructor(providers:readonly EnrichmentProvider[]){
    const keys=new Set<string>();
    for(const provider of providers){if(keys.has(provider.providerKey))throw new Error(`Duplicate enrichment provider: ${provider.providerKey}`);keys.add(provider.providerKey)}
    this.providers=[...providers].sort((a,b)=>a.priority-b.priority||a.providerKey.localeCompare(b.providerKey));
  }
  forCapability(capability:ProviderCapability){return this.providers.filter(provider=>provider.capabilities.includes(capability))}
  assertFreeOnly(){if(this.providers.some(provider=>provider.enabled&&provider.costClass!=="free"))throw new Error("Free-only enrichment registry cannot enable paid providers.")}
}

export interface EnrichmentNeeds{
  companyResolution:boolean;
  websiteContacts:boolean;
  businessEmail:boolean;
  personEmailPattern:boolean;
  businessPhone:boolean;
  address:boolean;
  city:boolean;
  state:boolean;
  zip:boolean;
  emailVerification:boolean;
  phoneVerification:boolean;
}

const present=(value:unknown)=>typeof value==="string"&&value.trim().length>0;
function hasPersonPatternEvidence(candidates:readonly ProviderCandidate[]){
  const groups=new Map<string,Set<EnrichmentFieldName>>();
  for(const candidate of candidates){
    if(candidate.sourceType!=="Official Website"||candidate.evidence.verificationStatus!=="published")continue;
    const id=candidate.evidence.providerMetadata?.personObservationId;if(typeof id!=="string")continue;
    const fields=groups.get(id)??new Set<EnrichmentFieldName>();fields.add(candidate.fieldName);groups.set(id,fields);
  }
  const people=[...groups.values()].filter(fields=>fields.has("contact_name"));
  return people.some(fields=>fields.has("business_email"))&&people.some(fields=>!fields.has("business_email"));
}
export function planEnrichmentNeeds(subject:EnrichmentSubject,candidates:readonly ProviderCandidate[]=[]):EnrichmentNeeds{
  const found=(field:EnrichmentFieldName)=>candidates.some(candidate=>candidate.fieldName===field&&candidate.evidence.verificationStatus!=="invalid");
  const missing=(value:unknown,field:EnrichmentFieldName)=>!present(value)&&!found(field);
  const needs={
    companyResolution:missing(subject.website,"website")&&!present(subject.verifiedDomain),
    businessEmail:missing(subject.email,"business_email"),personEmailPattern:false,
    businessPhone:missing(subject.phone,"business_phone"),
    address:missing(subject.address,"address"),
    city:missing(subject.city,"city"),
    state:missing(subject.state,"state"),
    zip:missing(subject.zip,"zip"),emailVerification:false,phoneVerification:false,
    websiteContacts:false
  };
  needs.websiteContacts=needs.businessEmail||needs.businessPhone||needs.address||needs.city||needs.state||needs.zip;
  needs.personEmailPattern=Boolean(subject.verifiedDomain)&&hasPersonPatternEvidence(candidates);
  const emailValues=[...new Set(candidates.filter(candidate=>candidate.fieldName==="business_email"&&candidate.evidence.providerKey!=="email-domain-verification").map(candidate=>candidate.normalizedValue.toLowerCase()))];
  const technicallyChecked=new Set(candidates.filter(candidate=>candidate.fieldName==="business_email"&&candidate.evidence.providerKey==="email-domain-verification").map(candidate=>candidate.normalizedValue.toLowerCase()));
  needs.emailVerification=emailValues.some(email=>!technicallyChecked.has(email));
  return needs;
}

function normalizedValue(field:EnrichmentFieldName,value:string){
  const clean=value.trim();
  if(field==="business_email")return clean.toLowerCase();
  if(field==="business_phone")return clean.replace(/\D/g,"");
  if(field==="website")try{return new URL(clean).origin.toLowerCase()}catch{return clean.toLowerCase()}
  return clean.toLowerCase().replace(/\s+/g," ");
}

const sourceRank:Record<ProviderSourceType,number>={"Official Website":300,"OpenStreetMap":200,"Generated Candidate":100};
const verificationRank:Record<VerificationStatus,number>={verified:70,valid:65,published:60,catch_all:40,risky:20,unknown:10,unverified:0,invalid:-1000};
export function candidateRank(candidate:ProviderCandidate){return sourceRank[candidate.sourceType]+verificationRank[candidate.evidence.verificationStatus]+Math.max(0,Math.min(100,candidate.confidence))}

export function normalizeCandidate(candidate:ProviderCandidate):ProviderCandidate|null{
  const value=candidate.value.trim();
  if(!value)return null;
  const normalized=normalizedValue(candidate.fieldName,candidate.normalizedValue||value);
  if(!normalized)return null;
  return{...candidate,value,normalizedValue:normalized,confidence:Math.max(0,Math.min(100,Math.round(candidate.confidence))),evidence:{...candidate.evidence,providerMetadata:sanitizeProviderMetadata(candidate.evidence.providerMetadata)}};
}

export function normalizeDedupeAndRank(candidates:readonly ProviderCandidate[]){
  const byFieldValue=new Map<string,ProviderCandidate>();
  for(const raw of candidates){
    const candidate=normalizeCandidate(raw);if(!candidate)continue;
    // Deduplicate repeated extraction from the same evidence, but retain independent corroboration.
    const key=`${candidate.fieldName}|${candidate.normalizedValue}|${candidate.evidence.providerKey}|${candidate.evidence.providerVersion}|${candidate.evidence.sourceUrl}|${candidate.evidence.sourceKind}`;
    const current=byFieldValue.get(key);
    if(!current||candidateRank(candidate)>candidateRank(current))byFieldValue.set(key,candidate);
  }
  return[...byFieldValue.values()].sort((a,b)=>candidateRank(b)-candidateRank(a)||a.fieldName.localeCompare(b.fieldName)||a.normalizedValue.localeCompare(b.normalizedValue));
}
