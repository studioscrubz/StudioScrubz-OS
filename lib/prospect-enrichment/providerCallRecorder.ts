import "server-only";
import { createHash } from "node:crypto";
import { sanitizeProviderMetadata,type ProviderDescriptor,type ProviderResult,type ProviderUsage } from "@/lib/prospect-enrichment/providerFoundation";

export function providerRequestFingerprint(provider:Pick<ProviderDescriptor,"providerKey"|"version">,operation:string,input:unknown,policyVersion="provider-policy-v1"){
  return createHash("sha256").update(JSON.stringify({providerKey:provider.providerKey,providerVersion:provider.version,operation,policyVersion,input})).digest("hex");
}

export interface BeginProviderCallInput{enrichmentItemId:string;provider:ProviderDescriptor;operation:string;requestFingerprint:string;cacheHit?:boolean}
export interface CompleteProviderCallInput{providerCallId:string;status:"Completed"|"No Data"|"Failed";cacheHit?:boolean;providerRequestId?:string;usage?:ProviderUsage;httpStatus?:number;errorCode?:string;responseMetadata?:Record<string,unknown>}
export interface ProviderCallRecorder{begin(input:BeginProviderCallInput):Promise<string>;complete(input:CompleteProviderCallInput):Promise<void>}

interface RpcClient{rpc(name:string,args:Record<string,unknown>):Promise<{data:unknown;error:{message:string}|null}>}

export class SupabaseProviderCallRecorder implements ProviderCallRecorder{
  constructor(private readonly db:RpcClient){}
  async begin(input:BeginProviderCallInput){
    const{data,error}=await this.db.rpc("begin_prospect_enrichment_provider_call",{p_item_id:input.enrichmentItemId,p_provider_key:input.provider.providerKey,p_provider_version:input.provider.version,p_operation:input.operation,p_request_fingerprint:input.requestFingerprint,p_cache_hit:input.cacheHit??false});
    if(error)throw new Error(error.message);
    if(typeof data!=="string")throw new Error("Provider call could not be recorded.");
    return data;
  }
  async complete(input:CompleteProviderCallInput){
    const usage=input.usage??{};
    const{error}=await this.db.rpc("complete_prospect_enrichment_provider_call",{p_provider_call_id:input.providerCallId,p_status:input.status,p_cache_hit:input.cacheHit??false,p_provider_request_id:input.providerRequestId??null,p_credits_used:usage.creditsUsed??0,p_cost_minor_units:usage.costMinorUnits??0,p_cost_currency:usage.costCurrency??null,p_http_status:input.httpStatus??null,p_error_code:input.errorCode??null,p_response_metadata:sanitizeProviderMetadata(input.responseMetadata)});
    if(error)throw new Error(error.message);
  }
}

export function providerCallCompletion(result:ProviderResult){return{status:(result.status==="failed"?"Failed":result.status==="not_found"?"No Data":"Completed") as CompleteProviderCallInput["status"],usage:result.usage,providerRequestId:result.providerRequestId,httpStatus:result.httpStatus,errorCode:result.errorCode,responseMetadata:{...sanitizeProviderMetadata(result.responseMetadata),candidateCount:result.candidates.length,retryable:result.retryable??false}}}
