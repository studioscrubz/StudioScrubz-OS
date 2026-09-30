import "server-only";
import { ENRICHMENT_PROVIDER_VERSION } from "@/lib/prospectEnrichment";
import { internalEnrichmentProviders,internalProviderContext } from "@/lib/prospect-enrichment/internalProviders";
import { normalizeDedupeAndRank,planEnrichmentNeeds,ProviderRegistry,type EnrichmentProvider,type EnrichmentSubject,type ProviderCandidate,type ProviderResult } from "@/lib/prospect-enrichment/providerFoundation";
import { providerCallCompletion,providerRequestFingerprint,type ProviderCallRecorder } from "@/lib/prospect-enrichment/providerCallRecorder";
import { DEFAULT_PROVIDER_EXECUTION_POLICY,WaterfallPlanner,type ProviderExecutionPolicy,type ProviderPlan } from "@/lib/prospect-enrichment/waterfallPlanner";

export interface EnrichmentOrchestratorInput extends EnrichmentSubject{enrichmentItemId:string;cacheKey:string|null}
export interface CachedEnrichment{status:"Complete"|"Partially Enriched"|"No Additional Data Found"|"Failed";results:ProviderCandidate[];providerVersion?:string}
export interface EnrichmentOrchestratorDependencies{getCached(cacheKey:string):Promise<CachedEnrichment|null>;providerCalls?:ProviderCallRecorder}
export interface EnrichmentExecutionResult{status:"Complete"|"Partially Enriched"|"No Additional Data Found"|"Failed";candidates:ProviderCandidate[];canonicalUrl:string|null;canonicalDomain:string|null;cacheKey:string|null;error?:string}

async function executeProvider(plan:ProviderPlan,subject:EnrichmentSubject,context:ReturnType<typeof internalProviderContext>):Promise<ProviderResult>{
  const provider=plan.provider;
  if(plan.operation==="company_resolution"&&"resolveCompany" in provider)return provider.resolveCompany(subject,context);
  if(plan.operation==="business_contact_enrichment"&&"enrichBusiness" in provider)return provider.enrichBusiness(subject,context);
  if(plan.operation==="email_finding"&&"findEmails" in provider)return provider.findEmails(subject,context);
  if(plan.operation==="phone_finding"&&"findPhones" in provider)return provider.findPhones(subject,context);
  if(plan.operation==="email_verification"&&"verifyEmail" in provider&&subject.email)return provider.verifyEmail(subject.email,subject,context);
  return{status:"not_found",candidates:[]};
}

export class EnrichmentOrchestrator{
  readonly registry:ProviderRegistry;
  readonly planner:WaterfallPlanner;
  constructor(registry=new ProviderRegistry(internalEnrichmentProviders),policy:ProviderExecutionPolicy=DEFAULT_PROVIDER_EXECUTION_POLICY){
    this.registry=registry;this.planner=new WaterfallPlanner(registry,policy);
    if(policy.mode==="free-only")this.registry.assertFreeOnly();
  }

  private fingerprint(provider:EnrichmentProvider,operation:string,subject:EnrichmentSubject){
    return providerRequestFingerprint(provider,operation,{discoveryResultId:subject.discoveryResultId,website:subject.website??null,verifiedDomain:subject.verifiedDomain??null,email:subject.email??null,phone:subject.phone??null},this.planner.policy.policyVersion);
  }

  private async invoke(input:EnrichmentOrchestratorInput,dependencies:EnrichmentOrchestratorDependencies,plan:ProviderPlan,subject:EnrichmentSubject,context:ReturnType<typeof internalProviderContext>,fingerprint:string){
    const recorder=dependencies.providerCalls;
    const callId=recorder?await recorder.begin({enrichmentItemId:input.enrichmentItemId,provider:plan.provider,operation:plan.operation,requestFingerprint:fingerprint}):undefined;
    let result:ProviderResult;
    try{result=await executeProvider(plan,subject,context)}catch{result={status:"failed",candidates:[],errorCode:"provider_execution_failed"}}
    if(callId)await recorder!.complete({providerCallId:callId,...providerCallCompletion(result)});
    return{...result,candidates:result.candidates.map(candidate=>({...candidate,usage:result.usage??{creditsUsed:0,costMinorUnits:0},evidence:{...candidate.evidence,providerCallId:callId??candidate.evidence.providerCallId}}))};
  }

  async enrich(input:EnrichmentOrchestratorInput,dependencies:EnrichmentOrchestratorDependencies):Promise<EnrichmentExecutionResult>{
    const context=internalProviderContext(crypto.randomUUID(),this.planner.policy.mode==="allow-paid");
    const subject:EnrichmentSubject={...input};
    const baseline:ProviderCandidate[]=[];
    let candidates:ProviderCandidate[]=[];
    const attemptedFingerprints=new Set<string>();
    const executedBaselineProviders=new Set<string>();
    let providerCalls=0,creditsUsed=0,costMinorUnits=0;
    let cacheChecked=false;
    try{
      while(providerCalls<this.planner.policy.maxProviderCallsPerItem){
        const needs=planEnrichmentNeeds(subject,[...baseline,...candidates]);
        const plan=this.planner.next({subject,needs,attemptedFingerprints,executedBaselineProviders,providerCalls,creditsUsed,costMinorUnits},(provider,operation)=>this.fingerprint(provider,operation,subject));
        if(!plan)break;

        if(plan.provider.supportsCache&&!cacheChecked&&input.cacheKey){
          cacheChecked=true;
          const cached=await dependencies.getCached(input.cacheKey);
          if(cached?.providerVersion===ENRICHMENT_PROVIDER_VERSION&&cached.results.every(candidate=>candidate.evidence?.providerKey&&candidate.evidence?.providerVersion)){
            const cacheProvider={providerKey:"enrichment-cache",version:ENRICHMENT_PROVIDER_VERSION,capabilities:[],priority:0,costClass:"free",enabled:true,requiresVerifiedDomain:false,requiresWebsite:false,supportsCache:true,stopPolicy:"when-needed"} as const;
            const fingerprint=providerRequestFingerprint(cacheProvider,"cache_lookup",{cacheKey:input.cacheKey},this.planner.policy.policyVersion);
            const callId=dependencies.providerCalls?await dependencies.providerCalls.begin({enrichmentItemId:input.enrichmentItemId,provider:cacheProvider,operation:"cache_lookup",requestFingerprint:fingerprint,cacheHit:true}):undefined;
            if(callId)await dependencies.providerCalls!.complete({providerCallId:callId,status:cached.status==="Failed"?"Failed":cached.status==="No Additional Data Found"?"No Data":"Completed",cacheHit:true,responseMetadata:{candidateCount:cached.results.length}});
            const cachedCandidates=cached.results.map(candidate=>({...candidate,usage:{creditsUsed:0,costMinorUnits:0},evidence:{...candidate.evidence,providerCallId:callId??undefined}}));
            const cachedNormalized=normalizeDedupeAndRank(cachedCandidates),cachedNeeds=planEnrichmentNeeds(subject,[...baseline,...candidates,...cachedNormalized]);
            if(cached.status!=="Failed"&&!cachedNeeds.businessEmail&&!cachedNeeds.businessPhone)return{status:cached.status,candidates:cachedNormalized,canonicalUrl:subject.website??null,canonicalDomain:subject.verifiedDomain??null,cacheKey:input.cacheKey};
            candidates.push(...cachedNormalized);
            attemptedFingerprints.add(this.fingerprint(plan.provider,plan.operation,subject));
            continue;
          }
        }

        const fingerprint=this.fingerprint(plan.provider,plan.operation,subject);
        attemptedFingerprints.add(fingerprint);providerCalls+=1;
        if(plan.provider.stopPolicy==="baseline")executedBaselineProviders.add(plan.provider.providerKey);
        const result=await this.invoke(input,dependencies,plan,subject,context,fingerprint);
        creditsUsed+=result.usage?.creditsUsed??0;costMinorUnits+=result.usage?.costMinorUnits??0;
        if(result.resolvedCompany){subject.website=result.resolvedCompany.website;subject.verifiedDomain=result.resolvedCompany.domain}
        if(plan.provider.stopPolicy==="baseline")baseline.push(...result.candidates);else candidates.push(...result.candidates);
        // Provider-level failures are recorded and the next eligible adapter may continue.
      }
      const normalized=normalizeDedupeAndRank(candidates);
      return{status:normalized.length?"Complete":"No Additional Data Found",candidates:normalized,canonicalUrl:subject.website??null,canonicalDomain:subject.verifiedDomain??null,cacheKey:input.cacheKey};
    }catch(cause){
      return{status:"Failed",candidates:[],canonicalUrl:subject.website??null,canonicalDomain:subject.verifiedDomain??null,cacheKey:input.cacheKey,error:cause instanceof Error?cause.message:"Enrichment failed."};
    }
  }
}

export const enrichmentOrchestrator=new EnrichmentOrchestrator();
