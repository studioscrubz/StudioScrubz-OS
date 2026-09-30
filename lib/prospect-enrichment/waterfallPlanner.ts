import type { EnrichmentNeeds,EnrichmentProvider,EnrichmentSubject,ProviderCapability,ProviderRegistry } from "./providerFoundation.ts";

export interface ProviderExecutionPolicy{
  mode:"free-only"|"allow-paid";
  maxCreditsPerItem:number;
  maxCostMinorUnitsPerItem:number;
  maxProviderCallsPerItem:number;
  collectCorroboratingEvidence:boolean;
  policyVersion:string;
}

export const DEFAULT_PROVIDER_EXECUTION_POLICY:ProviderExecutionPolicy={
  mode:"free-only",maxCreditsPerItem:0,maxCostMinorUnitsPerItem:0,maxProviderCallsPerItem:8,
  collectCorroboratingEvidence:false,policyVersion:"waterfall-v1"
};

export interface WaterfallState{
  subject:EnrichmentSubject;
  needs:EnrichmentNeeds;
  attemptedFingerprints:ReadonlySet<string>;
  executedBaselineProviders:ReadonlySet<string>;
  providerCalls:number;
  creditsUsed:number;
  costMinorUnits:number;
}

export interface ProviderPlan{provider:EnrichmentProvider;capability:ProviderCapability;operation:string}

const fieldCapabilities=(needs:EnrichmentNeeds):ProviderCapability[]=>{
  const capabilities:ProviderCapability[]=[];
  if(needs.companyResolution)capabilities.push("company_resolution","domain_resolution");
  if(needs.websiteContacts)capabilities.push("business_contact_enrichment");
  if(needs.businessEmail)capabilities.push("business_email_find");
  if(needs.businessPhone)capabilities.push("business_phone_find");
  if(needs.emailVerification)capabilities.push("email_verification");
  if(needs.phoneVerification)capabilities.push("phone_verification");
  return capabilities;
};

function operationFor(provider:EnrichmentProvider,capability:ProviderCapability){
  if((capability==="company_resolution"||capability==="domain_resolution")&&"resolveCompany" in provider)return"company_resolution";
  if(capability==="business_contact_enrichment"&&"enrichBusiness" in provider)return"business_contact_enrichment";
  if(capability==="business_email_find"&&"findEmails" in provider)return"email_finding";
  if(capability==="business_phone_find"&&"findPhones" in provider)return"phone_finding";
  if(capability==="email_verification"&&"verifyEmail" in provider)return"email_verification";
  return capability;
}

export class WaterfallPlanner{
  readonly registry:ProviderRegistry;
  readonly policy:ProviderExecutionPolicy;
  constructor(registry:ProviderRegistry,policy:ProviderExecutionPolicy=DEFAULT_PROVIDER_EXECUTION_POLICY){this.registry=registry;this.policy=policy}

  next(state:WaterfallState,fingerprintFor:(provider:EnrichmentProvider,operation:string)=>string):ProviderPlan|null{
    if(state.providerCalls>=this.policy.maxProviderCallsPerItem)return null;
    const needed=new Set(fieldCapabilities(state.needs));
    if(this.policy.collectCorroboratingEvidence){needed.add("business_email_find");needed.add("business_phone_find");if(state.subject.website)needed.add("business_contact_enrichment")}
    for(const provider of this.registry.providers){
      if(!provider.enabled)continue;
      if(provider.stopPolicy==="baseline"&&state.executedBaselineProviders.has(provider.providerKey))continue;
      if(this.policy.mode==="free-only"&&provider.costClass==="paid")continue;
      if(provider.requiresVerifiedDomain&&!state.subject.verifiedDomain)continue;
      if(provider.requiresWebsite&&!state.subject.website)continue;
      if(state.creditsUsed+(provider.estimatedCredits??0)>this.policy.maxCreditsPerItem)continue;
      if(state.costMinorUnits+(provider.estimatedCostMinorUnits??0)>this.policy.maxCostMinorUnitsPerItem)continue;
      const capability=provider.capabilities.find(value=>provider.stopPolicy==="baseline"||needed.has(value));
      if(!capability)continue;
      if(provider.stopPolicy==="last-resort"&&!state.needs.businessEmail)continue;
      const operation=operationFor(provider,capability);
      if(state.attemptedFingerprints.has(fingerprintFor(provider,operation)))continue;
      return{provider,capability,operation};
    }
    return null;
  }
}
