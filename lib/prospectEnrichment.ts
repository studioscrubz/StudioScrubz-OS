import dns from "node:dns/promises";
import net from "node:net";
import type { EnrichmentFieldName } from "@/types/prospectEnrichment";

export const ENRICHMENT_MAX_ITEMS=10, ENRICHMENT_MAX_PAGES=4, ENRICHMENT_MAX_BYTES=1_000_000;
export const SITE_CONTACT_MAX_TOTAL_PAGES=7, SITE_CONTACT_MAX_ADDITIONAL_PAGES=SITE_CONTACT_MAX_TOTAL_PAGES-1;
export const ENRICHMENT_PROVIDER_VERSION="official-site-v2";
export const ENRICHMENT_USER_AGENT="StudioScrubz Prospect Enrichment/1.1 (contact: support@studioscrubz.com)";
export interface Candidate{fieldName:EnrichmentFieldName;value:string;normalizedValue:string;sourceUrl:string;sourcePageType:string;confidence:number;retrievedAt:string;sourceType?:"OpenStreetMap"|"Official Website"|"Generated Candidate";personObservation?:{id:string;kind:"json-ld-person"|"team-card"|"directory-row"|"semantic-person-container"}}
export type EntityRelationshipType="direct_property"|"direct_business"|"property_manager"|"owner"|"developer"|"related_corporate"|"unknown_related";
export interface WebsiteDiscoveryInput{businessName:string;address?:string;city?:string;state?:string;zip?:string;locationQuery?:string;category?:string}
export interface WebsiteDiscoveryResult{url:string;landingUrl?:string;confidence:number;signals:string[];relationshipType?:EntityRelationshipType;contactUseAllowed?:boolean;relatedWebsiteCandidates?:string[]}
export interface WebsiteResolverDiagnostics extends Record<string,unknown>{searchOutcome:"results"|"empty"|"challenge"|"http_failure"|"parser_failure"|"timeout"|"network_failure";httpStatus?:number;parsedResultCount:number;candidateOrigins:string[];blockedHostCount:number;verificationAttemptCount:number;rejectionReasonCodes:string[];acceptedOrigin?:string;acceptedDomain?:string}
export type WebsiteDiscoveryOutcome={status:"resolved";result:WebsiteDiscoveryResult;diagnostics:WebsiteResolverDiagnostics}|{status:"not_found";diagnostics:WebsiteResolverDiagnostics}|{status:"failed";errorCode:string;retryable:boolean;httpStatus?:number;diagnostics:WebsiteResolverDiagnostics};

const blockedV4=(ip:string)=>{const p=ip.split(".").map(Number);return p[0]===0||p[0]===10||p[0]===127||p[0]>=224||p[0]===169&&p[1]===254||p[0]===172&&p[1]>=16&&p[1]<=31||p[0]===192&&p[1]===168||p[0]===192&&p[1]===0&&p[2]===0||p[0]===198&&[18,19,51].includes(p[1])||p[0]===203&&p[1]===0&&p[2]===113};
const blockedIp=(ip:string)=>net.isIPv4(ip)?blockedV4(ip):net.isIPv6(ip)?(/^(::|::1|fc|fd|fe8|fe9|fea|feb|ff)/i.test(ip)||ip.toLowerCase().startsWith("2001:db8:")):true;
export function sameSite(a:string,b:string){const clean=(v:string)=>v.toLowerCase().replace(/^www\./,"").replace(/\.$/,"");return clean(a)===clean(b)}
export async function validatePublicHttps(input:string,expectedHost?:string){let url:URL;try{url=new URL(input)}catch{throw new Error("Invalid website URL.")}if(url.protocol!=="https:"||url.username||url.password||url.port)throw new Error("Website must use public HTTPS.");const host=url.hostname.toLowerCase().replace(/\.$/,"");if(host==="localhost"||host.endsWith(".localhost")||host==="169.254.169.254")throw new Error("Website destination is blocked.");if(expectedHost&&!sameSite(host,expectedHost))throw new Error("Secondary enrichment page left the official site.");const addresses=await dns.lookup(host,{all:true,verbatim:true});if(!addresses.length||addresses.some(a=>blockedIp(a.address)))throw new Error("Website destination is not public.");url.hostname=host;return url;}

async function fetchBounded(url:URL,expectedHost?:string){let current=await validatePublicHttps(url.toString(),expectedHost);for(let redirects=0;redirects<=2;redirects++){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7000);try{const response=await fetch(current,{headers:{"User-Agent":ENRICHMENT_USER_AGENT,"Accept":"text/html,application/xhtml+xml"},redirect:"manual",signal:controller.signal,cache:"no-store"});if(response.status>=300&&response.status<400){const location=response.headers.get("location");if(!location||redirects===2)throw new Error("Website redirect limit reached.");current=await validatePublicHttps(new URL(location,current).toString(),expectedHost??current.hostname);continue}if(!response.ok)throw new Error(`Website returned ${response.status}.`);const type=(response.headers.get("content-type")||"").toLowerCase();if(!type.includes("text/html")&&!type.includes("application/xhtml+xml"))throw new Error("Website content type is unsupported.");const reader=response.body?.getReader();if(!reader)return"";let size=0,out="";const decoder=new TextDecoder();while(true){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>ENRICHMENT_MAX_BYTES){await reader.cancel();throw new Error("Website response is too large.")}out+=decoder.decode(value,{stream:true})}return out+decoder.decode()}finally{clearTimeout(timer)}}throw new Error("Website redirect failed.")}

function strip(value:string){return value.replace(/<[^>]+>/g," ").replace(/&amp;/g,"&").replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g," ").trim()}
function words(value:string){return new Set(value.toLowerCase().replace(/[^a-z0-9]+/g," ").split(/\s+/).filter(x=>x.length>2&&!["the","and","inc","llc","company","corp"].includes(x)))}
function overlap(a:string,b:string){const aa=words(a),bb=words(b);if(!aa.size)return 0;let hit=0;for(const x of aa)if(bb.has(x))hit++;return hit/aa.size}
function identityText(value:string){return value.toLowerCase().replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim()}
function compactIdentity(value:string){return identityText(value).replace(/\s/g,"")}
function exactIdentity(haystack:string,needle:string){const cleanNeedle=identityText(needle);return cleanNeedle.length>=3&&` ${identityText(haystack)} `.includes(` ${cleanNeedle} `)}
function exactAddress(haystack:string,address?:string){const clean=identityText(address||"");return clean.length>=5&&identityText(haystack).includes(clean)}
function relationshipLinks(html:string,base:URL,input:WebsiteDiscoveryInput){const found:string[]=[];const business=compactIdentity(input.businessName);for(const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){try{const target=new URL(match[1],base),label=compactIdentity(strip(match[2]));if(target.protocol!=="https:"||sameSite(target.hostname,base.hostname))continue;const host=target.hostname.replace(/^www\./,"").split(".")[0].replace(/[-_]/g,"");if((business&&host.includes(business))||(business&&label.includes(business))){const value=target.toString();if(!found.includes(value)&&found.length<3)found.push(value)}}catch{}}return found}
export function classifyEntityRelationship(input:WebsiteDiscoveryInput,landingUrl:string,text:string,relatedWebsiteCandidates:readonly string[]=[]):{type:EntityRelationshipType;contactUseAllowed:boolean}{const host=new URL(landingUrl).hostname.replace(/^www\./,"").split(".")[0].replace(/[-_]/g,"");const business=compactIdentity(input.businessName),directDomain=business.length>=4&&host.includes(business),property=/property management|multifamily/i.test(input.category||"");if(directDomain)return{type:property?"direct_property":"direct_business",contactUseAllowed:true};const exactName=exactIdentity(text,input.businessName),address=exactAddress(text,input.address);if(!exactName)return{type:"unknown_related",contactUseAllowed:false};if(/\b(managed by|property manager|property management|management company)\b/i.test(text))return{type:"property_manager",contactUseAllowed:true};if(/\b(owned by|property owner|ownership)\b/i.test(text))return{type:"owner",contactUseAllowed:false};if(/\b(developed by|developer|development|portfolio)\b/i.test(text)||relatedWebsiteCandidates.length)return{type:"developer",contactUseAllowed:false};if(address)return{type:property?"direct_property":"direct_business",contactUseAllowed:true};return{type:"related_corporate",contactUseAllowed:false}}
function add(list:Candidate[],fieldName:EnrichmentFieldName,value:string|undefined,sourceUrl:string,page:string,confidence:number,sourceType:"Official Website"|"Generated Candidate"="Official Website"){const v=strip(value||"");if(!v)return;const normalized=fieldName==="business_email"?v.toLowerCase():fieldName==="business_phone"?v.replace(/\D/g,""):fieldName==="website"?v.toLowerCase():v.toLowerCase();if(!normalized)return;if(!list.some(x=>x.fieldName===fieldName&&x.normalizedValue===normalized))list.push({fieldName,value:v,normalizedValue:normalized,sourceUrl,sourcePageType:page,confidence,retrievedAt:new Date().toISOString(),sourceType})}
const GENERIC_EMAIL_LOCAL=/^(info|contact|hello|office|leasing)$/i;
const PERSON_CONTAINER_SIGNAL=/\b(team[-_ ]?member|staff[-_ ]?member|person|profile|employee|leadership|management|directory[-_ ]?(?:row|entry)|member[-_ ]?card|bio)\b/i;
const NON_PERSON_NAME=/^(contact us|about us|our team|our staff|leadership|management|directory|people|locations?|offices?|learn more|read more|home)$/i;
function plausiblePersonName(value:string){const clean=strip(value);const parts=clean.split(/\s+/);return clean.length<=100&&parts.length>=2&&parts.length<=6&&!NON_PERSON_NAME.test(clean)&&!/@|\d|\b(inc|llc|ltd|company|corporation|properties|management group)\b/i.test(clean)&&parts.every(part=>/^[\p{L}][\p{L}'’.-]*$/u.test(part))}
function plausibleTitle(value:string,name:string){const clean=strip(value);return clean.length>=2&&clean.length<=120&&clean.toLowerCase()!==name.toLowerCase()&&!/@|\d{3}|^(contact|email|phone|learn more|read more)$/i.test(clean)}
function observationId(url:string,kind:string,name:string,email?:string,phone?:string){let hash=2166136261;for(const char of `${url}|${kind}|${name}|${email||""}|${phone||""}`){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619)}return `person-${(hash>>>0).toString(16).padStart(8,"0")}`}
function addPersonCandidate(list:Candidate[],fieldName:EnrichmentFieldName,value:string|undefined,url:string,page:string,confidence:number,personObservation:Candidate["personObservation"]){const v=strip(value||"");if(!v)return;const normalized=fieldName==="business_email"?v.toLowerCase():fieldName==="business_phone"?v.replace(/\D/g,""):v.toLowerCase().replace(/\s+/g," ");if(normalized)list.push({fieldName,value:v,normalizedValue:normalized,sourceUrl:url,sourcePageType:page,confidence,retrievedAt:new Date().toISOString(),sourceType:"Official Website",personObservation})}
function emitPersonObservation(list:Candidate[],input:{name?:string;title?:string;email?:string;phone?:string;explicitEmail?:boolean},url:string,page:string,kind:NonNullable<Candidate["personObservation"]>["kind"],confidence:number){
  const name=strip(input.name||"");if(!plausiblePersonName(name))return;
  const title=strip(input.title||"");const email=strip(input.email||"");const phone=strip(input.phone||"");
  if(!title&&!email&&!phone)return;
  const usableEmail=email&&(!GENERIC_EMAIL_LOCAL.test(email.split("@")[0])||input.explicitEmail)?email:undefined;
  const observation={id:observationId(url,kind,name,usableEmail,phone),kind};
  addPersonCandidate(list,"contact_name",name,url,page,confidence,observation);
  if(title&&plausibleTitle(title,name))addPersonCandidate(list,"contact_title",title,url,page,confidence,observation);
  if(usableEmail)addPersonCandidate(list,"business_email",usableEmail,url,page,confidence,observation);
  if(phone)addPersonCandidate(list,"business_phone",phone,url,page,confidence,observation);
}
function attributeValue(attrs:string,name:string){return attrs.match(new RegExp(`\\b${name}=["']([^"']+)["']`,`i`))?.[1]}
function elementTextBySignal(body:string,signal:RegExp){for(const m of body.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>([\s\S]*?)<\/\1>/gi))if(signal.test(`${attributeValue(m[2],"class")||""} ${attributeValue(m[2],"itemprop")||""}`))return strip(m[3]);return""}
function firstHeading(body:string){return strip(body.match(/<h[2-5]\b[^>]*>([\s\S]*?)<\/h[2-5]>/i)?.[1]||"")}
function firstParagraph(body:string){return strip(body.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1]||"")}
function linkedValue(body:string,scheme:"mailto"|"tel"){const raw=body.match(new RegExp(`href=["']${scheme}:([^"'?]+)[^"']*["']`,`i`))?.[1];try{return raw?decodeURIComponent(raw):""}catch{return raw||""}}
export function extractPublishedPersonContacts(html:string,url:string,page:string){
  const candidates:Candidate[]=[];
  const container=/<(article|li|div|section|tr)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  for(const match of html.matchAll(container)){
    const tag=match[1].toLowerCase(),attrs=match[2],body=match[3];
    const semantic=PERSON_CONTAINER_SIGNAL.test(`${attributeValue(attrs,"class")||""} ${attributeValue(attrs,"id")||""} ${attributeValue(attrs,"itemtype")||""}`);
    const directoryRow=tag==="tr"&&/^(Directory|People|Team|Staff|Leadership|Management)$/i.test(page);
    if(!semantic&&!directoryRow)continue;
    const name=elementTextBySignal(body,/\b(name|person-name|employee-name|member-name)\b/i)||firstHeading(body)||(directoryRow?strip(body.match(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/i)?.[1]||""):"");
    const title=elementTextBySignal(body,/\b(jobtitle|job-title|title|role|position)\b/i)||(semantic?firstParagraph(body):strip([...body.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)][1]?.[1]||""));
    const email=linkedValue(body,"mailto"),phone=linkedValue(body,"tel");
    const explicitEmail=/itemprop=["']email["']/i.test(body)||/data-(?:person-)?contact/i.test(body);
    emitPersonObservation(candidates,{name,title,email,phone,explicitEmail},url,page,directoryRow?"directory-row":semantic&&/itemtype=["'][^"']*Person/i.test(attrs)?"semantic-person-container":"team-card",86);
  }
  return candidates;
}
function extractJsonLd(html:string,url:string,page:string,list:Candidate[]){for(const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{const raw=JSON.parse(m[1]);const walk=(x:any)=>{if(Array.isArray(x))return x.forEach(walk);if(!x||typeof x!=="object")return;const type=Array.isArray(x["@type"])?x["@type"].join(" "):String(x["@type"]||"");if(/Person/i.test(type))emitPersonObservation(list,{name:x.name,title:x.jobTitle,email:x.email,phone:x.telephone,explicitEmail:true},url,page,"json-ld-person",92);if(/Organization|LocalBusiness|Restaurant|ContactPoint/i.test(type)){add(list,"business_phone",x.telephone,url,page,90);add(list,"business_email",x.email,url,page,90);if(typeof x.url==="string")add(list,"website",x.url,url,page,90);if(x.address&&typeof x.address==="object"){add(list,"address",[x.address.streetAddress].filter(Boolean).join(" "),url,page,92);add(list,"city",x.address.addressLocality,url,page,92);add(list,"state",x.address.addressRegion,url,page,92);add(list,"zip",x.address.postalCode,url,page,92)}}Object.values(x).forEach(walk)};walk(raw)}catch{}}}
function extractPage(html:string,url:string,page:string,list:Candidate[]){extractJsonLd(html,url,page,list);list.push(...extractPublishedPersonContacts(html,url,page));for(const m of html.matchAll(/href=["']mailto:([^"'?]+)[^"']*["']/gi))add(list,"business_email",decodeURIComponent(m[1]),url,page,85);for(const m of html.matchAll(/href=["']tel:([^"']+)["']/gi))add(list,"business_phone",decodeURIComponent(m[1]),url,page,85);const visible=strip(html.replace(/<script\b[\s\S]*?<\/script>/gi," ").replace(/<style\b[\s\S]*?<\/style>/gi," "));for(const m of visible.matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi))add(list,"business_email",m[0],url,page,72);for(const m of visible.matchAll(/(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3}[\s.-])\s*\d{3}[\s.-]\d{4}\b/g))add(list,"business_phone",m[0],url,page,70)}
export function extractPublishedPageCandidates(html:string,url:string,page:string){const candidates:Candidate[]=[];extractPage(html,url,page,candidates);return candidates}
function pageLinks(html:string,base:URL){const links:{url:string;page:string}[]=[];for(const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)){try{const label=strip(m[2]).toLowerCase(),u=new URL(m[1],base);const patterns:Array<[RegExp,string]>=[[/contact/i,"Contact"],[/about/i,"About"],[/team/i,"Team"],[/staff/i,"Staff"],[/management/i,"Management"],[/locations?/i,"Locations"]];const hit=patterns.find(([r])=>r.test(label)||r.test(u.pathname));if(hit&&sameSite(u.hostname,base.hostname)&&u.protocol==="https:")links.push({url:u.toString(),page:hit[1]})}catch{}}return links.filter((x,i,a)=>a.findIndex(y=>y.url===x.url)===i).slice(0,3)}

export interface RankedSiteContactLink{url:string;pageType:string;score:number}
const SITE_CONTACT_PAGE_RULES:Array<{pattern:RegExp;pageType:string;score:number}>=[
  {pattern:/\bcontact\b/i,pageType:"Contact",score:100},{pattern:/\bdirector(?:y|ies)\b/i,pageType:"Directory",score:95},
  {pattern:/\bleadership\b/i,pageType:"Leadership",score:92},{pattern:/\bteam\b/i,pageType:"Team",score:90},
  {pattern:/\bstaff\b/i,pageType:"Staff",score:88},{pattern:/\bpeople\b/i,pageType:"People",score:86},
  {pattern:/\bmanagement\b/i,pageType:"Management",score:84},{pattern:/\blocations?\b/i,pageType:"Locations",score:80},
  {pattern:/\boffices?\b/i,pageType:"Offices",score:78},{pattern:/\babout\b/i,pageType:"About",score:70}
];

export function rankOfficialSiteContactLinks(html:string,base:URL){
  const ranked:RankedSiteContactLink[]=[];
  for(const match of html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    try{
      const url=new URL(match[1],base);url.hash="";url.search="";
      if(url.protocol!=="https:"||url.hostname.toLowerCase()!==base.hostname.toLowerCase())continue;
      const label=strip(match[2]),signal=`${label} ${decodeURIComponent(url.pathname).replace(/[-_\/]+/g," ")}`;
      const rule=SITE_CONTACT_PAGE_RULES.find(item=>item.pattern.test(signal));
      if(rule)ranked.push({url:url.toString(),pageType:rule.pageType,score:rule.score+(rule.pattern.test(label)?5:0)});
    }catch{}
  }
  return ranked.filter((item,index,all)=>all.findIndex(other=>other.url===item.url)===index)
    .sort((a,b)=>b.score-a.score||a.url.localeCompare(b.url)).slice(0,SITE_CONTACT_MAX_ADDITIONAL_PAGES);
}
export async function robotsAllows(base:URL){try{const robots=await fetchBounded(new URL("/robots.txt",base),base.hostname);const section=robots.split(/user-agent:/i).find(x=>/^\s*\*/.test(x));if(!section)return true;return !section.split(/\r?\n/).some(line=>/^\s*disallow\s*:\s*\/\s*$/i.test(line))}catch{return true}}

const SEARCH_ENDPOINT="https://html.duckduckgo.com/html/";
const SEARCH_BLOCKED_HOSTS=["facebook.com","instagram.com","linkedin.com","yelp.com","yellowpages.com","mapquest.com","tripadvisor.com","opentable.com","doordash.com","ubereats.com","grubhub.com","wikipedia.org","bbb.org","chamberofcommerce.com","trulia.com","zillow.com"];
export function isBlockedWebsiteSearchHost(host:string){const h=host.toLowerCase().replace(/^www\./,"");return SEARCH_BLOCKED_HOSTS.some(x=>h===x||h.endsWith("."+x))}
function decodeSearchUrl(raw:string){try{const u=new URL(raw,"https://duckduckgo.com");const target=u.searchParams.get("uddg");return target?decodeURIComponent(target):u.toString()}catch{return""}}
export function buildOfficialWebsiteSearchQuery(input:WebsiteDiscoveryInput){const specific=[input.address,input.city,input.state,input.zip].map(value=>value?.trim()).filter(Boolean),hasSpecificLocation=Boolean(input.address?.trim()||input.city?.trim()||input.zip?.trim());return[`"${input.businessName}"`,...(hasSpecificLocation?specific:[input.locationQuery?.trim()].filter(Boolean)),"official website"].join(" ")}
export async function searchOfficialWebsite(input:WebsiteDiscoveryInput,searchFetch:typeof fetch=fetch){
  const q=buildOfficialWebsiteSearchQuery(input),baseDiagnostics={parsedResultCount:0,candidateOrigins:[] as string[],blockedHostCount:0,verificationAttemptCount:0,rejectionReasonCodes:[] as string[]};
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),7000);
  try{
    let response:Response;
    try{response=await searchFetch(SEARCH_ENDPOINT,{
      method:"POST",
      headers:{
        "User-Agent":ENRICHMENT_USER_AGENT,
        "Content-Type":"application/x-www-form-urlencoded",
        "Accept":"text/html"
      },
      body:new URLSearchParams({q}).toString(),
      signal:controller.signal,
      cache:"no-store"
    });}catch(cause){const timeout=cause instanceof Error&&cause.name==="AbortError";return{status:"failed" as const,errorCode:timeout?"search_timeout":"search_network_failure",retryable:true,diagnostics:{...baseDiagnostics,searchOutcome:timeout?"timeout" as const:"network_failure" as const}}}
    if(response.status===202)return{status:"failed" as const,errorCode:"search_challenge",retryable:true,httpStatus:202,diagnostics:{...baseDiagnostics,searchOutcome:"challenge" as const,httpStatus:202}};
    if(!response.ok)return{status:"failed" as const,errorCode:"search_http_failure",retryable:response.status===429||response.status>=500,httpStatus:response.status,diagnostics:{...baseDiagnostics,searchOutcome:"http_failure" as const,httpStatus:response.status}};
    const html=await response.text();
    if(/captcha|anomaly|challenge|bots use this service/i.test(html))return{status:"failed" as const,errorCode:"search_challenge",retryable:true,httpStatus:response.status,diagnostics:{...baseDiagnostics,searchOutcome:"challenge" as const,httpStatus:response.status}};
    const urls:string[]=[];let blockedHostCount=0;
    const resultLink=/<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["']/gi;
    for(const m of html.matchAll(resultLink)){
      const decoded=decodeSearchUrl(m[1]);
      try{
        const u=new URL(decoded);
        if(isBlockedWebsiteSearchHost(u.hostname)){blockedHostCount+=1;continue}
        if(u.protocol==="https:"&&!urls.includes(u.origin))urls.push(u.origin);
      }catch{}
      if(urls.length>=5)break;
    }
    const diagnostics={...baseDiagnostics,searchOutcome:"results" as const,httpStatus:response.status,parsedResultCount:urls.length,candidateOrigins:urls.slice(0,5),blockedHostCount};
    if(urls.length)return{status:"results" as const,urls,diagnostics};
    if(/result--no-result|no results (?:found|for)|unfortunately,? no results/i.test(html))return{status:"empty" as const,urls:[],diagnostics:{...diagnostics,searchOutcome:"empty" as const}};
    return{status:"failed" as const,errorCode:"search_parser_unexpected",retryable:false,httpStatus:response.status,diagnostics:{...diagnostics,searchOutcome:"parser_failure" as const,rejectionReasonCodes:["unexpected_search_structure"]}};
  }finally{
    clearTimeout(timer);
  }
}

export async function verifyOfficialWebsite(url:string,input:WebsiteDiscoveryInput):Promise<{result:WebsiteDiscoveryResult|null;rejectionReason?:string}>{try{const landing=await validatePublicHttps(url);const html=await fetchBounded(landing);const text=strip(html).slice(0,200000),relatedWebsiteCandidates=relationshipLinks(html,landing,input);let score=0;const signals:string[]=[];const meaningful=[...words(input.businessName)],exactName=exactIdentity(text,input.businessName),nameScore=overlap(input.businessName,text);if(exactName){score+=55;signals.push("exact business name")}else if(meaningful.length>=2&&nameScore>=0.8){score+=55;signals.push("business name")}else if(meaningful.length>=2&&nameScore>=0.5){score+=35;signals.push("partial business name")}const hostName=landing.hostname.replace(/^www\./,"").split(".")[0].replace(/[-_]/g," "),strongDomain=compactIdentity(input.businessName).length>=4&&compactIdentity(hostName).includes(compactIdentity(input.businessName));if(strongDomain||meaningful.length>=2&&overlap(input.businessName,hostName)>=0.5){score+=20;signals.push("domain name")}if(input.city&&text.toLowerCase().includes(input.city.toLowerCase())){score+=15;signals.push("city")}if(input.zip&&text.includes(input.zip)){score+=20;signals.push("ZIP")}if(exactAddress(text,input.address)||input.address&&overlap(input.address,text)>=0.8){score+=20;signals.push("address")}if(score<70)return{result:null,rejectionReason:"identity_score_below_threshold"};const relationship=classifyEntityRelationship(input,landing.toString(),text,relatedWebsiteCandidates);return{result:{url:landing.origin,landingUrl:landing.toString(),confidence:Math.min(95,score),signals,relationshipType:relationship.type,contactUseAllowed:relationship.contactUseAllowed,relatedWebsiteCandidates}}}catch{return{result:null,rejectionReason:"candidate_security_or_fetch_rejected"}}}

export async function discoverOfficialWebsite(input:WebsiteDiscoveryInput,dependencies:{searchFetch?:typeof fetch;verifyCandidate?:(url:string,input:WebsiteDiscoveryInput)=>ReturnType<typeof verifyOfficialWebsite>}={}):Promise<WebsiteDiscoveryOutcome>{const searched=await searchOfficialWebsite(input,dependencies.searchFetch);if(searched.status==="failed")return searched;if(searched.status==="empty")return{status:"not_found",diagnostics:searched.diagnostics};const verified:WebsiteDiscoveryResult[]=[];const rejectionReasonCodes:string[]=[];const verifyCandidate=dependencies.verifyCandidate??verifyOfficialWebsite;for(const url of searched.urls.slice(0,3)){const checked=await verifyCandidate(url,input);if(checked.result)verified.push(checked.result);else if(checked.rejectionReason&&!rejectionReasonCodes.includes(checked.rejectionReason)&&rejectionReasonCodes.length<5)rejectionReasonCodes.push(checked.rejectionReason)}verified.sort((a,b)=>b.confidence-a.confidence);const result=verified[0],diagnostics={...searched.diagnostics,verificationAttemptCount:Math.min(3,searched.urls.length),rejectionReasonCodes,...(result?{acceptedOrigin:result.url,acceptedDomain:new URL(result.url).hostname.replace(/^www\./,"")}:{})};return result?{status:"resolved",result,diagnostics}:{status:"not_found",diagnostics}}


export function generateBusinessEmailCandidates(domain:string,existing:Candidate[]){
  const clean=domain.toLowerCase().replace(/^www\./,"").replace(/\.$/,"");
  if(!clean||clean.includes("/")||clean.includes("@"))return[];
  const published=new Set(existing.filter(x=>x.fieldName==="business_email").map(x=>x.normalizedValue.toLowerCase()));
  const generated:Candidate[]=[];
  const mailboxes:[string,number][]=[["info",55],["contact",50],["hello",45]];
  for(const [local,confidence] of mailboxes){
    const email=`${local}@${clean}`;
    if(!published.has(email)){
      add(generated,"business_email",email,`https://${clean}/`,"Generated Email Pattern",confidence,"Generated Candidate");
    }
  }
  return generated;
}

export async function extractOfficialWebsiteContacts(input:string){const base=await validatePublicHttps(input);if(!(await robotsAllows(base)))throw new Error("Website robots policy blocks automated access.");const candidates:Candidate[]=[];const home=await fetchBounded(base);add(candidates,"website",base.origin,base.toString(),"Homepage",95);extractPage(home,base.toString(),"Homepage",candidates);for(const link of pageLinks(home,base)){try{const url=await validatePublicHttps(link.url,base.hostname),html=await fetchBounded(url,base.hostname);extractPage(html,url.toString(),link.page,candidates);if(link.page==="Contact")add(candidates,"contact_page_url",url.toString(),url.toString(),"Contact",95)}catch{}}return{canonicalUrl:base.origin,canonicalDomain:base.hostname.replace(/^www\./,""),candidates}}
export async function discoverOfficialSiteContacts(input:string,verifiedDomain:string){
  const base=await validatePublicHttps(input);
  if(!sameSite(base.hostname,verifiedDomain))throw new Error("Official website does not match the verified domain.");
  if(!(await robotsAllows(base)))throw new Error("Website robots policy blocks automated access.");
  const candidates:Candidate[]=[];
  const home=await fetchBounded(base,base.hostname);
  const homeCandidates:Candidate[]=[];extractPage(home,base.toString(),"Homepage",homeCandidates);
  candidates.push(...homeCandidates.filter(item=>["business_email","business_phone","contact_name","contact_title"].includes(item.fieldName)));
  for(const link of rankOfficialSiteContactLinks(home,base)){
    try{
      const url=await validatePublicHttps(link.url,base.hostname),html=await fetchBounded(url,base.hostname),pageCandidates:Candidate[]=[];
      extractPage(html,url.toString(),link.pageType,pageCandidates);
      candidates.push(...pageCandidates.filter(item=>["business_email","business_phone","contact_name","contact_title"].includes(item.fieldName)));
      if(link.pageType==="Contact")add(candidates,"contact_page_url",url.toString(),url.toString(),"Contact",95);
    }catch{}
  }
  return{canonicalUrl:base.origin,canonicalDomain:base.hostname.replace(/^www\./,""),candidates};
}
export async function enrichOfficialWebsite(input:string){const found=await extractOfficialWebsiteContacts(input),candidates=[...found.candidates],canonicalDomain=found.canonicalDomain;if(!candidates.some(x=>x.fieldName==="business_email"&&x.sourceType!=="Generated Candidate"))candidates.push(...generateBusinessEmailCandidates(canonicalDomain,candidates));return{...found,candidates}}
