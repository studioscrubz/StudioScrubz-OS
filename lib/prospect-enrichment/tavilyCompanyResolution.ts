import "server-only";
import { buildOfficialWebsiteSearchQuery,isBlockedWebsiteSearchHost,verifyOfficialWebsite,verifyOfficialWebsiteCandidates,type WebsiteDiscoveryInput,type WebsiteDiscoveryResult } from "../prospectEnrichment";

const TAVILY_SEARCH_ENDPOINT="https://api.tavily.com/search";
export const TAVILY_COMPANY_RESOLUTION_VERSION="1";
export const TAVILY_MAX_RESULTS=5;

interface TavilyResult{url?:unknown;title?:unknown;content?:unknown}
interface TavilyResponse{results?:unknown;request_id?:unknown;usage?:unknown}
export interface TavilyWebsiteCandidate{url:string;origin:string;title:string;snippet:string;rankScore:number}
export interface TavilyResolverDiagnostics extends Record<string,unknown>{
  searchOutcome:"results"|"empty"|"configuration_failure"|"authentication_failure"|"rate_limit"|"upstream_failure"|"malformed_response"|"timeout"|"network_failure";
  httpStatus?:number;
  parsedResultCount:number;
  candidateOrigins:string[];
  blockedHostCount:number;
  verificationAttemptCount:number;
  rejectionReasonCodes:string[];
  acceptedOrigin?:string;
  acceptedDomain?:string;
}
export type TavilyResolutionOutcome=
  |{status:"resolved";result:WebsiteDiscoveryResult;diagnostics:TavilyResolverDiagnostics;providerRequestId?:string;creditsUsed?:number}
  |{status:"not_found";diagnostics:TavilyResolverDiagnostics;providerRequestId?:string;creditsUsed?:number}
  |{status:"failed";errorCode:string;retryable:boolean;httpStatus?:number;diagnostics:TavilyResolverDiagnostics;providerRequestId?:string;creditsUsed?:number};

function boundedRequestId(value:unknown){return typeof value==="string"&&value.length>0?value.slice(0,500):undefined}
function boundedCredits(value:unknown){if(!value||typeof value!=="object")return undefined;const credits=(value as{credits?:unknown}).credits;return typeof credits==="number"&&Number.isFinite(credits)&&credits>=0?credits:undefined}
const boundedText=(value:unknown,limit:number)=>typeof value==="string"?value.replace(/\s+/g," ").trim().slice(0,limit):"";
const identity=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]+/g,"");
export function rankTavilyCandidate(candidate:Omit<TavilyWebsiteCandidate,"rankScore">,input:WebsiteDiscoveryInput){const business=identity(input.businessName),host=identity(new URL(candidate.origin).hostname.replace(/^www\./,"").split(".")[0]),support=identity(`${candidate.title} ${candidate.snippet}`);let score=0;if(business.length>=4&&host.includes(business))score+=100;if(business.length>=4&&support.includes(business))score+=40;if(input.address&&support.includes(identity(input.address)))score+=25;if(input.zip&&support.includes(identity(input.zip)))score+=10;return score}

export async function searchTavilyCompanyCandidates(input:WebsiteDiscoveryInput,dependencies:{searchFetch?:typeof fetch;apiKey?:string}={}):Promise<Exclude<TavilyResolutionOutcome,{status:"resolved"}>&{candidates?:TavilyWebsiteCandidate[];urls?:string[]}>{
  const apiKey=dependencies.apiKey??process.env.TAVILY_API_KEY;
  const baseDiagnostics={parsedResultCount:0,candidateOrigins:[] as string[],blockedHostCount:0,verificationAttemptCount:0,rejectionReasonCodes:[] as string[]};
  if(!apiKey?.trim())return{status:"failed",errorCode:"tavily_configuration_unavailable",retryable:false,diagnostics:{...baseDiagnostics,searchOutcome:"configuration_failure"}};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7000);
  try{
    let response:Response;
    try{
      response=await(dependencies.searchFetch??fetch)(TAVILY_SEARCH_ENDPOINT,{method:"POST",headers:{"Authorization":`Bearer ${apiKey}`,"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({query:buildOfficialWebsiteSearchQuery(input),topic:"general",search_depth:"basic",max_results:TAVILY_MAX_RESULTS,include_answer:false,include_raw_content:false,include_images:false,include_usage:true,auto_parameters:false}),signal:controller.signal,cache:"no-store"});
    }catch(cause){const timeout=cause instanceof Error&&cause.name==="AbortError";return{status:"failed",errorCode:timeout?"tavily_timeout":"tavily_network_failure",retryable:true,diagnostics:{...baseDiagnostics,searchOutcome:timeout?"timeout":"network_failure"}}}
    if(response.status===401||response.status===403)return{status:"failed",errorCode:"tavily_authentication_failed",retryable:false,httpStatus:response.status,diagnostics:{...baseDiagnostics,searchOutcome:"authentication_failure",httpStatus:response.status}};
    if(response.status===429||response.status===432||response.status===433)return{status:"failed",errorCode:"tavily_rate_limited",retryable:response.status===429,httpStatus:response.status,diagnostics:{...baseDiagnostics,searchOutcome:"rate_limit",httpStatus:response.status}};
    if(!response.ok)return{status:"failed",errorCode:"tavily_upstream_failure",retryable:response.status>=500,httpStatus:response.status,diagnostics:{...baseDiagnostics,searchOutcome:"upstream_failure",httpStatus:response.status}};
    let payload:TavilyResponse;
    try{payload=await response.json() as TavilyResponse}catch{return{status:"failed",errorCode:"tavily_malformed_response",retryable:false,httpStatus:response.status,diagnostics:{...baseDiagnostics,searchOutcome:"malformed_response",httpStatus:response.status}}}
    const providerRequestId=boundedRequestId(payload.request_id),creditsUsed=boundedCredits(payload.usage);
    if(!Array.isArray(payload.results))return{status:"failed",errorCode:"tavily_malformed_response",retryable:false,httpStatus:response.status,providerRequestId,creditsUsed,diagnostics:{...baseDiagnostics,searchOutcome:"malformed_response",httpStatus:response.status}};
    const candidates:TavilyWebsiteCandidate[]=[];let blockedHostCount=0;
    for(const raw of payload.results.slice(0,TAVILY_MAX_RESULTS) as TavilyResult[]){
      if(typeof raw?.url!=="string")continue;
      try{const url=new URL(raw.url);if(isBlockedWebsiteSearchHost(url.hostname)){blockedHostCount+=1;continue}if(url.protocol!=="https:")continue;url.hash="";const base={url:url.toString(),origin:url.origin,title:boundedText(raw.title,200),snippet:boundedText(raw.content,500)};if(!candidates.some(candidate=>candidate.url===base.url))candidates.push({...base,rankScore:rankTavilyCandidate(base,input)})}catch{}
    }
    candidates.sort((a,b)=>b.rankScore-a.rankScore||a.url.localeCompare(b.url));const urls=candidates.map(candidate=>candidate.url);
    const diagnostics={...baseDiagnostics,searchOutcome:(candidates.length?"results":"empty") as"results"|"empty",httpStatus:response.status,parsedResultCount:candidates.length,candidateOrigins:candidates.map(candidate=>candidate.origin).slice(0,TAVILY_MAX_RESULTS),blockedHostCount};
    return candidates.length?{status:"not_found",candidates,urls,diagnostics,providerRequestId,creditsUsed}:{status:"not_found",diagnostics,providerRequestId,creditsUsed};
  }finally{clearTimeout(timer)}
}

export async function resolveCompanyWithTavily(input:WebsiteDiscoveryInput,dependencies:{searchFetch?:typeof fetch;apiKey?:string;verifyCandidate?:(url:string,input:WebsiteDiscoveryInput)=>ReturnType<typeof verifyOfficialWebsite>}={}):Promise<TavilyResolutionOutcome>{
  const searched=await searchTavilyCompanyCandidates(input,dependencies);
  if(searched.status==="failed")return searched;
  const candidates=searched.candidates??[];
  if(!candidates.length)return searched;
  const verified=await verifyOfficialWebsiteCandidates(candidates.map(candidate=>candidate.url),input,{verifyCandidate:dependencies.verifyCandidate??verifyOfficialWebsite,maxAttempts:3});
  const result=verified.result;
  const diagnostics={...searched.diagnostics,verificationAttemptCount:verified.attempts,rejectionReasonCodes:verified.rejectionReasonCodes,relationshipClassifications:[...verified.accepted,...verified.related].slice(0,5).map(item=>({origin:item.url,relationshipType:item.relationshipType??"unknown_related",contactUseAllowed:item.contactUseAllowed!==false})),...(result?{acceptedOrigin:result.url,acceptedDomain:new URL(result.url).hostname.replace(/^www\./,"")}:{})};
  return result?{status:"resolved",result,diagnostics,providerRequestId:searched.providerRequestId,creditsUsed:searched.creditsUsed}:{status:"not_found",diagnostics,providerRequestId:searched.providerRequestId,creditsUsed:searched.creditsUsed};
}
