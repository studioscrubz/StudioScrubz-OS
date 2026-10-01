import "server-only";
import { verifyOfficialWebsite,verifyOfficialWebsiteCandidates,type WebsiteDiscoveryInput,type WebsiteDiscoveryResult } from "@/lib/prospectEnrichment";
import type { CompanyDomainResolver,EnrichmentSubject,ProviderCandidate } from "@/lib/prospect-enrichment/providerFoundation";

export const OSM_WEBSITE_VERIFICATION_VERSION="1";

type VerificationDependencies={verifyCandidate?:(url:string,input:WebsiteDiscoveryInput)=>ReturnType<typeof verifyOfficialWebsite>};

function websiteInput(subject:EnrichmentSubject):WebsiteDiscoveryInput{return{
  businessName:subject.businessName,address:subject.address,city:subject.city,state:subject.state,
  zip:subject.zip,locationQuery:subject.locationQuery,category:subject.category
}}

function relationshipCandidate(subject:EnrichmentSubject,result:WebsiteDiscoveryResult,contactUseAllowed:boolean):ProviderCandidate{
  const timestamp=new Date().toISOString(),sourceUrl=subject.sourceUrl??subject.websiteCandidate??result.landingUrl??result.url;
  return{
    fieldName:"website",value:result.url,normalizedValue:result.url,sourceType:"OpenStreetMap",sourceUrl,
    sourcePageType:"OSM",confidence:result.confidence,retrievedAt:timestamp,
    evidence:{
      providerKey:"osm-website-verification",providerVersion:OSM_WEBSITE_VERIFICATION_VERSION,
      sourceKind:contactUseAllowed?"OSM Website Verification":"OSM Website Relationship",
      sourceType:"OpenStreetMap",sourceUrl,sourcePageType:"OSM",
      verificationStatus:contactUseAllowed?"verified":"unknown",discoveredAt:timestamp,
      ...(contactUseAllowed?{verifiedAt:timestamp}:{}),
      providerMetadata:{
        candidateSource:"OpenStreetMap",originalCandidateUrl:subject.websiteCandidate,
        originalCandidateDomain:subject.websiteCandidateDomain,landingUrl:result.landingUrl??result.url,
        relationshipType:result.relationshipType??"unknown_related",contactUseAllowed,
        identityConfidence:result.confidence,identitySignals:result.signals.slice(0,10)
      }
    },usage:{creditsUsed:0,costMinorUnits:0}
  };
}

export function createOsmWebsiteVerificationProvider(dependencies:VerificationDependencies={}):CompanyDomainResolver{return{
  providerKey:"osm-website-verification",version:OSM_WEBSITE_VERIFICATION_VERSION,
  capabilities:["company_resolution","domain_resolution"],priority:15,costClass:"free",enabled:true,
  requiresVerifiedDomain:false,requiresWebsite:false,supportsCache:false,stopPolicy:"when-needed",
  async resolveCompany(subject){
    if(!subject.websiteCandidate)return{status:"not_found",candidates:[],usage:{creditsUsed:0,costMinorUnits:0},responseMetadata:{candidateSource:"OpenStreetMap",candidatePresent:false}};
    const verified=await verifyOfficialWebsiteCandidates([subject.websiteCandidate],websiteInput(subject),{verifyCandidate:dependencies.verifyCandidate??verifyOfficialWebsite,maxAttempts:3});
    const observations=[...verified.accepted,...verified.related].slice(0,5);
    const responseMetadata={candidateSource:"OpenStreetMap",candidatePresent:true,verificationAttemptCount:verified.attempts,rejectionReasonCodes:verified.rejectionReasonCodes.slice(0,5),relationshipTypes:observations.map(item=>item.relationshipType??"unknown_related"),relationshipOrigins:observations.map(item=>item.url),contactUseAllowed:observations.map(item=>item.contactUseAllowed!==false)};
    const candidates=[...verified.accepted.map(item=>relationshipCandidate(subject,item,true)),...verified.related.map(item=>relationshipCandidate(subject,item,false))];
    if(!verified.result)return{status:"not_found",candidates,usage:{creditsUsed:0,costMinorUnits:0},responseMetadata};
    const domain=new URL(verified.result.url).hostname.replace(/^www\./,"");
    return{status:"complete",resolvedCompany:{website:verified.result.url,domain},candidates,usage:{creditsUsed:0,costMinorUnits:0},responseMetadata:{...responseMetadata,acceptedOrigin:verified.result.url,acceptedDomain:domain}};
  }
}}

export const osmWebsiteVerificationProvider=createOsmWebsiteVerificationProvider();
