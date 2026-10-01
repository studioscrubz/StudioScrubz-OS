import type {EnrichmentCandidate,EnrichmentDecision,EnrichmentReviewItem,EnrichmentVerificationStatus} from "@/types/prospectEnrichment";

const verificationRank:Record<EnrichmentVerificationStatus,number>={verified:7,valid:6,published:5,catch_all:4,risky:3,unknown:2,unverified:1,invalid:0};
const sourceRank={"Official Website":3,"OpenStreetMap":2,"Generated Candidate":1} as const;

export function groupEnrichmentCandidates(candidates:readonly EnrichmentCandidate[]):EnrichmentCandidate[]{
  const groups=new Map<string,EnrichmentCandidate[]>();
  for(const candidate of candidates){const key=`${candidate.fieldName}|${candidate.normalizedValue??candidate.value.trim().toLowerCase()}`,group=groups.get(key)??[];group.push(candidate);groups.set(key,group)}
  return[...groups.values()].map(group=>{
    const ordered=[...group].sort((a,b)=>(sourceRank[b.sourceType]-sourceRank[a.sourceType])||(verificationRank[b.verificationStatus??"unknown"]-verificationRank[a.verificationStatus??"unknown"])||b.confidence-a.confidence||a.id.localeCompare(b.id));
    const primary=ordered[0],statuses=[...new Set(group.map(item=>item.verificationStatus).filter((value):value is EnrichmentVerificationStatus=>Boolean(value)))];
    const decisions=[...new Set(group.map(item=>item.decision))];const decision:EnrichmentDecision=decisions.length===1?decisions[0]:"Pending";
    const identityConfidence=Math.max(...group.map(item=>item.identityConfidence??(item.providerKey==="tavily-company-resolution"?item.confidence:0)));
    const substantiveConfidence=group.filter(item=>item.providerKey!=="email-domain-verification").map(item=>item.confidence);
    return{...primary,id:primary.id,evidenceIds:group.map(item=>item.id).sort(),evidenceCount:group.length,decision,confidence:substantiveConfidence.length?Math.max(...substantiveConfidence):primary.confidence,identityConfidence:identityConfidence||undefined,published:group.some(item=>item.verificationStatus==="published"),generated:group.some(item=>item.sourceType==="Generated Candidate"),technicalVerificationStatus:statuses.sort((a,b)=>verificationRank[b]-verificationRank[a]).find(status=>["valid","risky","invalid","catch_all"].includes(status)),verificationStatus:primary.verificationStatus};
  }).sort((a,b)=>a.fieldName.localeCompare(b.fieldName)||b.confidence-a.confidence||a.value.localeCompare(b.value));
}

export function groupEnrichmentReview(items:readonly EnrichmentReviewItem[]):EnrichmentReviewItem[]{return items.map(item=>({...item,candidates:groupEnrichmentCandidates(item.candidates)}))}
