import "server-only";
import { ENRICHMENT_PROVIDER_VERSION } from "@/lib/prospectEnrichment";
import { internalEnrichmentProviders,internalProviderContext,osmMetadataProvider } from "@/lib/prospect-enrichment/internalProviders";
import { normalizeDedupeAndRank,planEnrichmentNeeds,ProviderRegistry,type CompanyDomainResolver,type BusinessContactEnricher,type EmailFinder,type EnrichmentSubject,type ProviderCandidate } from "@/lib/prospect-enrichment/providerFoundation";

export interface EnrichmentOrchestratorInput extends EnrichmentSubject{cacheKey:string|null}
export interface CachedEnrichment{status:"Complete"|"Partially Enriched"|"No Additional Data Found"|"Failed";results:ProviderCandidate[];providerVersion?:string}
export interface EnrichmentOrchestratorDependencies{getCached(cacheKey:string):Promise<CachedEnrichment|null>}
export interface EnrichmentExecutionResult{status:"Complete"|"Partially Enriched"|"No Additional Data Found"|"Failed";candidates:ProviderCandidate[];canonicalUrl:string|null;canonicalDomain:string|null;cacheKey:string|null;error?:string}

export class EnrichmentOrchestrator{
  readonly registry:ProviderRegistry;
  constructor(registry=new ProviderRegistry(internalEnrichmentProviders)){this.registry=registry;this.registry.assertFreeOnly()}

  async enrich(input:EnrichmentOrchestratorInput,dependencies:EnrichmentOrchestratorDependencies):Promise<EnrichmentExecutionResult>{
    const context=internalProviderContext(crypto.randomUUID());
    const subject:EnrichmentSubject={...input};
    try{
      const baseline=await osmMetadataProvider.enrichBusiness(input,context);
      // OSM values remain original discovery truth; they inform stopping rules but are never staged as enrichment candidates.
      let candidates:ProviderCandidate[]=[];
      let needs=planEnrichmentNeeds(subject,baseline.candidates);

      if(needs.companyResolution){
        const resolver=this.registry.forCapability("company_resolution")[0] as CompanyDomainResolver|undefined;
        const resolved=resolver?await resolver.resolveCompany(subject,context):null;
        if(!resolved?.resolvedCompany)return{status:"No Additional Data Found",candidates:[],canonicalUrl:null,canonicalDomain:null,cacheKey:null};
        subject.website=resolved.resolvedCompany.website;subject.verifiedDomain=resolved.resolvedCompany.domain;candidates.push(...resolved.candidates);
      }

      if(input.cacheKey){
        const cached=await dependencies.getCached(input.cacheKey);
        if(cached?.providerVersion===ENRICHMENT_PROVIDER_VERSION)return{status:cached.status,candidates:normalizeDedupeAndRank(cached.results),canonicalUrl:subject.website??null,canonicalDomain:subject.verifiedDomain??null,cacheKey:input.cacheKey};
      }

      needs=planEnrichmentNeeds(subject,[...baseline.candidates,...candidates]);
      if(needs.websiteContacts&&subject.website){
        const contacts=this.registry.forCapability("business_contact_enrichment").find(provider=>provider.providerKey==="official-website-contacts") as BusinessContactEnricher|undefined;
        if(contacts){const found=await contacts.enrichBusiness(subject,context);candidates.push(...found.candidates);if(found.resolvedCompany){subject.website=found.resolvedCompany.website;subject.verifiedDomain=found.resolvedCompany.domain}}
      }

      needs=planEnrichmentNeeds(subject,[...baseline.candidates,...candidates]);
      if(needs.businessEmail&&subject.verifiedDomain){
        const finder=this.registry.forCapability("email_finding").find(provider=>provider.providerKey==="generated-role-email") as EmailFinder|undefined;
        if(finder)candidates.push(...(await finder.findEmails(subject,context)).candidates);
      }

      const normalized=normalizeDedupeAndRank(candidates);
      return{status:normalized.length?"Complete":"No Additional Data Found",candidates:normalized,canonicalUrl:subject.website??null,canonicalDomain:subject.verifiedDomain??null,cacheKey:input.cacheKey};
    }catch(cause){
      return{status:"Failed",candidates:[],canonicalUrl:subject.website??null,canonicalDomain:subject.verifiedDomain??null,cacheKey:input.cacheKey,error:cause instanceof Error?cause.message:"Enrichment failed."};
    }
  }
}

export const enrichmentOrchestrator=new EnrichmentOrchestrator();
