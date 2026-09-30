import type { ProviderCandidate } from "./providerFoundation.ts";

export const COMPANY_EMAIL_PATTERNS={
  "first.last":(first:string,last:string)=>`${first}.${last}`,
  firstlast:(first:string,last:string)=>`${first}${last}`,
  first:(first:string)=>first,
  first_initial_last:(first:string,last:string)=>`${first[0]}${last}`,
  first_last:(first:string,last:string)=>`${first}_${last}`,
  "last.first":(first:string,last:string)=>`${last}.${first}`
} as const;
export type CompanyEmailPatternId=keyof typeof COMPANY_EMAIL_PATTERNS;

const GENERIC_MAILBOXES=new Set(["info","contact","hello","office","sales","support","leasing","admin","help","service","customerservice","team","billing","careers","jobs","marketing"]);
const STRUCTURAL_EVIDENCE=new Set(["json-ld-person","team-card","directory-row","semantic-person-container"]);

interface PersonParts{first:string;last:string}
interface PersonObservation{id:string;name:string;emails:ProviderCandidate[]}
export interface CompanyPatternAnalysis{
  status:"usable"|"insufficient"|"conflicting";
  patternId?:CompanyEmailPatternId;
  evidenceObservationIds:string[];
  evidenceCount:number;
  observedPatternIds:CompanyEmailPatternId[];
  confidence:number;
}
export interface PersonPatternCandidateDraft{
  email:string;
  targetName:string;
  targetPersonObservationId:string;
  patternId:CompanyEmailPatternId;
  evidenceObservationIds:string[];
  evidenceCount:number;
  confidence:number;
}

const metadata=(candidate:ProviderCandidate)=>candidate.evidence.providerMetadata??{};
const observationId=(candidate:ProviderCandidate)=>typeof metadata(candidate).personObservationId==="string"?metadata(candidate).personObservationId as string:null;
const isStrongPublishedPersonEvidence=(candidate:ProviderCandidate)=>candidate.sourceType==="Official Website"&&candidate.evidence.verificationStatus==="published"&&Boolean(observationId(candidate))&&STRUCTURAL_EVIDENCE.has(String(metadata(candidate).structuralEvidence??candidate.evidence.sourceKind));
const normalizedDomain=(value:string)=>value.trim().toLowerCase().replace(/^www\./,"").replace(/\.$/,"");
function parsePublishedName(value:string):PersonParts|null{
  const parts=value.trim().replace(/\s+/g," ").split(" ");
  if(parts.length<2||parts.length>3||parts.some(part=>!/^[A-Za-z]{2,}$/.test(part)))return null;
  if(/^(mr|mrs|ms|miss|dr|prof|sir)$/i.test(parts[0])||/^(jr|sr|ii|iii|iv)$/i.test(parts.at(-1)!))return null;
  return{first:parts[0].toLowerCase(),last:parts.at(-1)!.toLowerCase()};
}
function emailParts(value:string){const match=value.trim().toLowerCase().match(/^([a-z0-9._+-]+)@([a-z0-9.-]+)$/);return match?{local:match[1],domain:normalizedDomain(match[2])}:null}
function matchingPatterns(name:string,email:string,verifiedDomain:string){
  const person=parsePublishedName(name),parts=emailParts(email);
  if(!person||!parts||parts.domain!==normalizedDomain(verifiedDomain)||GENERIC_MAILBOXES.has(parts.local))return[];
  return(Object.entries(COMPANY_EMAIL_PATTERNS) as Array<[CompanyEmailPatternId,(first:string,last:string)=>string]>).filter(([,build])=>build(person.first,person.last)===parts.local).map(([id])=>id);
}
function observations(candidates:readonly ProviderCandidate[]){
  const grouped=new Map<string,PersonObservation>();
  for(const candidate of candidates){
    if(!isStrongPublishedPersonEvidence(candidate))continue;
    const id=observationId(candidate)!;let item=grouped.get(id);
    if(!item){item={id,name:"",emails:[]};grouped.set(id,item)}
    if(candidate.fieldName==="contact_name")item.name=candidate.value.trim().replace(/\s+/g," ");
    if(candidate.fieldName==="business_email")item.emails.push(candidate);
  }
  return[...grouped.values()].filter(item=>item.name&&parsePublishedName(item.name));
}

export function analyzeCompanyEmailPattern(candidates:readonly ProviderCandidate[],verifiedDomain:string):CompanyPatternAnalysis{
  const independent=observations(candidates).map(person=>({observationId:person.id,matches:[...new Set(person.emails.flatMap(email=>matchingPatterns(person.name,email.value,verifiedDomain)))]})).filter(item=>item.matches.length);
  if(!independent.length)return{status:"insufficient",evidenceObservationIds:[],evidenceCount:0,observedPatternIds:[],confidence:0};
  const common=independent.slice(1).reduce((set,item)=>new Set([...set].filter(id=>item.matches.includes(id))),new Set(independent[0].matches));
  const observed=[...new Set(independent.flatMap(item=>item.matches))].sort() as CompanyEmailPatternId[];
  if(common.size===0)return{status:"conflicting",evidenceObservationIds:independent.map(x=>x.observationId),evidenceCount:independent.length,observedPatternIds:observed,confidence:0};
  if(common.size>1||independent.length===1&&independent[0].matches.length!==1)return{status:"insufficient",evidenceObservationIds:independent.map(x=>x.observationId),evidenceCount:independent.length,observedPatternIds:observed,confidence:0};
  const patternId=[...common][0];
  return{status:"usable",patternId,evidenceObservationIds:independent.map(x=>x.observationId),evidenceCount:independent.length,observedPatternIds:observed,confidence:Math.min(90,independent.length>=2?80+(independent.length-2)*5:65)};
}

export function generatePersonPatternCandidates(candidates:readonly ProviderCandidate[],verifiedDomain:string){
  const analysis=analyzeCompanyEmailPattern(candidates,verifiedDomain);if(analysis.status!=="usable"||!analysis.patternId)return{analysis,candidates:[] as PersonPatternCandidateDraft[]};
  const domain=normalizedDomain(verifiedDomain),publishedEmails=new Set(candidates.filter(x=>x.fieldName==="business_email"&&x.sourceType==="Official Website"&&x.evidence.verificationStatus==="published").map(x=>x.normalizedValue.toLowerCase()));
  const existingGenerated=new Set(candidates.filter(x=>x.fieldName==="business_email"&&x.sourceType==="Generated Candidate").map(x=>`${observationId(x)??""}|${x.normalizedValue.toLowerCase()}`));
  const generated:PersonPatternCandidateDraft[]=[];
  for(const person of observations(candidates)){
    if(person.emails.length)continue;
    const parts=parsePublishedName(person.name);if(!parts)continue;
    const email=`${COMPANY_EMAIL_PATTERNS[analysis.patternId](parts.first,parts.last)}@${domain}`;
    const key=`${person.id}|${email}`;
    if(publishedEmails.has(email)||existingGenerated.has(key)||generated.some(item=>item.targetPersonObservationId===person.id&&item.email===email))continue;
    generated.push({email,targetName:person.name,targetPersonObservationId:person.id,patternId:analysis.patternId,evidenceObservationIds:analysis.evidenceObservationIds,evidenceCount:analysis.evidenceCount,confidence:analysis.confidence});
    if(generated.length>=10)break;
  }
  return{analysis,candidates:generated};
}

export function hasPersonPatternOpportunity(candidates:readonly ProviderCandidate[],verifiedDomain?:string){
  if(!verifiedDomain)return false;const people=observations(candidates);
  return people.some(person=>person.emails.length===0)&&people.some(person=>person.emails.some(email=>matchingPatterns(person.name,email.value,verifiedDomain).length>0));
}
