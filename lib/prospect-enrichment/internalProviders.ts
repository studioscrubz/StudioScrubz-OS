import "server-only";
import { discoverOfficialWebsite, extractOfficialWebsiteContacts, generateBusinessEmailCandidates } from "@/lib/prospectEnrichment";
import type { BusinessContactEnricher,CompanyDomainResolver,EmailFinder,EnrichmentSubject,ProviderCandidate,ProviderContext,ProviderEvidence,ProviderResult } from "@/lib/prospect-enrichment/providerFoundation";

const now=()=>new Date().toISOString();
function evidence(providerKey:string,version:string,sourceType:ProviderEvidence["sourceType"],sourceUrl:string,sourcePageType:string,verificationStatus:ProviderEvidence["verificationStatus"]):ProviderEvidence{return{providerKey,providerVersion:version,sourceKind:sourcePageType,sourceType,sourceUrl,sourcePageType,verificationStatus,discoveredAt:now()}}
function candidate(providerKey:string,version:string,fieldName:ProviderCandidate["fieldName"],value:string,normalizedValue:string,sourceType:ProviderCandidate["sourceType"],sourceUrl:string,sourcePageType:string,confidence:number,verificationStatus:ProviderEvidence["verificationStatus"]):ProviderCandidate{return{fieldName,value,normalizedValue,sourceType,sourceUrl,sourcePageType,confidence,retrievedAt:now(),evidence:evidence(providerKey,version,sourceType,sourceUrl,sourcePageType,verificationStatus)}}

export const osmMetadataProvider:BusinessContactEnricher={
  providerKey:"osm-metadata",version:"1",capabilities:["business_contact_enrichment","business_email_find","business_phone_find"],priority:10,costClass:"free",enabled:true,requiresVerifiedDomain:false,requiresWebsite:false,supportsCache:false,stopPolicy:"baseline",
  async enrichBusiness(subject){
    const source=subject.sourceUrl??"https://www.openstreetmap.org/copyright";
    const fields:Array<[ProviderCandidate["fieldName"],string|undefined]>=[["website",subject.website],["business_email",subject.email],["business_phone",subject.phone],["address",subject.address],["city",subject.city],["state",subject.state],["zip",subject.zip]];
    return{status:"complete",candidates:fields.filter((entry):entry is [ProviderCandidate["fieldName"],string]=>Boolean(entry[1]?.trim())).map(([field,value])=>candidate("osm-metadata","1",field,value,value,"OpenStreetMap",source,"OSM",70,"published"))};
  }
};

export const officialWebsiteResolverProvider:CompanyDomainResolver={
  providerKey:"official-website-resolver",version:"1",capabilities:["company_resolution","domain_resolution"],priority:20,costClass:"free",enabled:true,requiresVerifiedDomain:false,requiresWebsite:false,supportsCache:false,stopPolicy:"when-needed",
  async resolveCompany(subject){
    const found=await discoverOfficialWebsite({businessName:subject.businessName,address:subject.address,city:subject.city,state:subject.state,zip:subject.zip,locationQuery:subject.locationQuery});
    if(!found)return{status:"not_found",candidates:[]};
    const url=new URL(found.url),domain=url.hostname.replace(/^www\./,"");
    return{status:"complete",resolvedCompany:{website:url.origin,domain},candidates:[candidate("official-website-resolver","1","website",url.origin,url.origin,"Official Website",url.origin,"Homepage",found.confidence,"verified")]};
  }
};

export const officialWebsiteContactProvider:BusinessContactEnricher={
  providerKey:"official-website-contacts",version:"2",capabilities:["business_contact_enrichment","business_email_find","business_phone_find"],priority:30,costClass:"free",enabled:true,requiresVerifiedDomain:false,requiresWebsite:true,supportsCache:true,stopPolicy:"when-needed",
  async enrichBusiness(subject){
    if(!subject.website)return{status:"not_found",candidates:[]};
    const found=await extractOfficialWebsiteContacts(subject.website);
    return{status:found.candidates.length?"complete":"not_found",resolvedCompany:{website:found.canonicalUrl,domain:found.canonicalDomain},candidates:found.candidates.map(item=>({...item,sourceType:item.sourceType??"Official Website",evidence:evidence("official-website-contacts","2",item.sourceType??"Official Website",item.sourceUrl,item.sourcePageType,"published")}))};
  }
};

export const generatedRoleEmailProvider:EmailFinder={
  providerKey:"generated-role-email",version:"1",capabilities:["business_email_find"],priority:1000,costClass:"free",enabled:true,requiresVerifiedDomain:true,requiresWebsite:false,supportsCache:false,stopPolicy:"last-resort",
  async findEmails(subject){
    if(!subject.verifiedDomain)return{status:"not_found",candidates:[]};
    const generated=generateBusinessEmailCandidates(subject.verifiedDomain,[]);
    return{status:generated.length?"complete":"not_found",candidates:generated.map(item=>({...item,sourceType:"Generated Candidate",evidence:evidence("generated-role-email","1","Generated Candidate",item.sourceUrl,item.sourcePageType,"unverified")}))};
  }
};

export const internalEnrichmentProviders=[osmMetadataProvider,officialWebsiteResolverProvider,officialWebsiteContactProvider,generatedRoleEmailProvider] as const;
export const internalProviderContext=(requestId:string,allowPaidCall=false):ProviderContext=>({requestId,allowPaidCall});
export const noProviderResult:ProviderResult={status:"not_found",candidates:[]};
