import dns from "node:dns/promises";
import net from "node:net";
import type { EnrichmentFieldName } from "@/types/prospectEnrichment";

export const ENRICHMENT_MAX_ITEMS=10, ENRICHMENT_MAX_PAGES=4, ENRICHMENT_MAX_BYTES=1_000_000;
export const SITE_CONTACT_MAX_TOTAL_PAGES=7, SITE_CONTACT_MAX_ADDITIONAL_PAGES=SITE_CONTACT_MAX_TOTAL_PAGES-1;
export const ENRICHMENT_PROVIDER_VERSION="official-site-v2";
export const ENRICHMENT_USER_AGENT="StudioScrubz Prospect Enrichment/1.1 (contact: support@studioscrubz.com)";
export interface Candidate{fieldName:EnrichmentFieldName;value:string;normalizedValue:string;sourceUrl:string;sourcePageType:string;confidence:number;retrievedAt:string;sourceType?:"OpenStreetMap"|"Official Website"|"Generated Candidate"}
export interface WebsiteDiscoveryInput{businessName:string;address?:string;city?:string;state?:string;zip?:string;locationQuery?:string}
export interface WebsiteDiscoveryResult{url:string;confidence:number;signals:string[]}

const blockedV4=(ip:string)=>{const p=ip.split(".").map(Number);return p[0]===0||p[0]===10||p[0]===127||p[0]>=224||p[0]===169&&p[1]===254||p[0]===172&&p[1]>=16&&p[1]<=31||p[0]===192&&p[1]===168||p[0]===192&&p[1]===0&&p[2]===0||p[0]===198&&[18,19,51].includes(p[1])||p[0]===203&&p[1]===0&&p[2]===113};
const blockedIp=(ip:string)=>net.isIPv4(ip)?blockedV4(ip):net.isIPv6(ip)?(/^(::|::1|fc|fd|fe8|fe9|fea|feb|ff)/i.test(ip)||ip.toLowerCase().startsWith("2001:db8:")):true;
export function sameSite(a:string,b:string){const clean=(v:string)=>v.toLowerCase().replace(/^www\./,"").replace(/\.$/,"");return clean(a)===clean(b)}
export async function validatePublicHttps(input:string,expectedHost?:string){let url:URL;try{url=new URL(input)}catch{throw new Error("Invalid website URL.")}if(url.protocol!=="https:"||url.username||url.password||url.port)throw new Error("Website must use public HTTPS.");const host=url.hostname.toLowerCase().replace(/\.$/,"");if(host==="localhost"||host.endsWith(".localhost")||host==="169.254.169.254")throw new Error("Website destination is blocked.");if(expectedHost&&!sameSite(host,expectedHost))throw new Error("Secondary enrichment page left the official site.");const addresses=await dns.lookup(host,{all:true,verbatim:true});if(!addresses.length||addresses.some(a=>blockedIp(a.address)))throw new Error("Website destination is not public.");url.hostname=host;return url;}

async function fetchBounded(url:URL,expectedHost?:string){let current=await validatePublicHttps(url.toString(),expectedHost);for(let redirects=0;redirects<=2;redirects++){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7000);try{const response=await fetch(current,{headers:{"User-Agent":ENRICHMENT_USER_AGENT,"Accept":"text/html,application/xhtml+xml"},redirect:"manual",signal:controller.signal,cache:"no-store"});if(response.status>=300&&response.status<400){const location=response.headers.get("location");if(!location||redirects===2)throw new Error("Website redirect limit reached.");current=await validatePublicHttps(new URL(location,current).toString(),expectedHost??current.hostname);continue}if(!response.ok)throw new Error(`Website returned ${response.status}.`);const type=(response.headers.get("content-type")||"").toLowerCase();if(!type.includes("text/html")&&!type.includes("application/xhtml+xml"))throw new Error("Website content type is unsupported.");const reader=response.body?.getReader();if(!reader)return"";let size=0,out="";const decoder=new TextDecoder();while(true){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>ENRICHMENT_MAX_BYTES){await reader.cancel();throw new Error("Website response is too large.")}out+=decoder.decode(value,{stream:true})}return out+decoder.decode()}finally{clearTimeout(timer)}}throw new Error("Website redirect failed.")}

function strip(value:string){return value.replace(/<[^>]+>/g," ").replace(/&amp;/g,"&").replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g," ").trim()}
function words(value:string){return new Set(value.toLowerCase().replace(/[^a-z0-9]+/g," ").split(/\s+/).filter(x=>x.length>2&&!["the","and","inc","llc","company","corp"].includes(x)))}
function overlap(a:string,b:string){const aa=words(a),bb=words(b);if(!aa.size)return 0;let hit=0;for(const x of aa)if(bb.has(x))hit++;return hit/aa.size}
function add(list:Candidate[],fieldName:EnrichmentFieldName,value:string|undefined,sourceUrl:string,page:string,confidence:number,sourceType:"Official Website"|"Generated Candidate"="Official Website"){const v=strip(value||"");if(!v)return;const normalized=fieldName==="business_email"?v.toLowerCase():fieldName==="business_phone"?v.replace(/\D/g,""):fieldName==="website"?v.toLowerCase():v.toLowerCase();if(!normalized)return;if(!list.some(x=>x.fieldName===fieldName&&x.normalizedValue===normalized))list.push({fieldName,value:v,normalizedValue:normalized,sourceUrl,sourcePageType:page,confidence,retrievedAt:new Date().toISOString(),sourceType})}
function extractJsonLd(html:string,url:string,page:string,list:Candidate[]){for(const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{const raw=JSON.parse(m[1]);const walk=(x:any)=>{if(Array.isArray(x))return x.forEach(walk);if(!x||typeof x!=="object")return;const type=Array.isArray(x["@type"])?x["@type"].join(" "):String(x["@type"]||"");if(/Organization|LocalBusiness|Restaurant|Person|ContactPoint/i.test(type)){add(list,"business_phone",x.telephone,url,page,90);add(list,"business_email",x.email,url,page,90);if(typeof x.url==="string")add(list,"website",x.url,url,page,90);if(x.address&&typeof x.address==="object"){add(list,"address",[x.address.streetAddress].filter(Boolean).join(" "),url,page,92);add(list,"city",x.address.addressLocality,url,page,92);add(list,"state",x.address.addressRegion,url,page,92);add(list,"zip",x.address.postalCode,url,page,92)}if(/Person/i.test(type)){add(list,"contact_name",x.name,url,page,75);add(list,"contact_title",x.jobTitle,url,page,75)}}Object.values(x).forEach(walk)};walk(raw)}catch{}}}
function extractPage(html:string,url:string,page:string,list:Candidate[]){extractJsonLd(html,url,page,list);for(const m of html.matchAll(/href=["']mailto:([^"'?]+)[^"']*["']/gi))add(list,"business_email",decodeURIComponent(m[1]),url,page,85);for(const m of html.matchAll(/href=["']tel:([^"']+)["']/gi))add(list,"business_phone",decodeURIComponent(m[1]),url,page,85);const visible=strip(html.replace(/<script\b[\s\S]*?<\/script>/gi," ").replace(/<style\b[\s\S]*?<\/style>/gi," "));for(const m of visible.matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi))add(list,"business_email",m[0],url,page,72);for(const m of visible.matchAll(/(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3}[\s.-])\s*\d{3}[\s.-]\d{4}\b/g))add(list,"business_phone",m[0],url,page,70)}
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
const SEARCH_BLOCKED_HOSTS=["facebook.com","instagram.com","linkedin.com","yelp.com","yellowpages.com","mapquest.com","tripadvisor.com","opentable.com","doordash.com","ubereats.com","grubhub.com","wikipedia.org","bbb.org","chamberofcommerce.com"];
function searchHostBlocked(host:string){const h=host.toLowerCase().replace(/^www\./,"");return SEARCH_BLOCKED_HOSTS.some(x=>h===x||h.endsWith("."+x))}
function decodeSearchUrl(raw:string){try{const u=new URL(raw,"https://duckduckgo.com");const target=u.searchParams.get("uddg");return target?decodeURIComponent(target):u.toString()}catch{return""}}
async function searchOfficialWebsite(input:WebsiteDiscoveryInput){
  const q=[`"${input.businessName}"`,input.address,input.city,input.state,input.zip,input.locationQuery,"official website"].filter(Boolean).join(" ");
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),7000);
  try{
    const response=await fetch(SEARCH_ENDPOINT,{
      method:"POST",
      headers:{
        "User-Agent":ENRICHMENT_USER_AGENT,
        "Content-Type":"application/x-www-form-urlencoded",
        "Accept":"text/html"
      },
      body:new URLSearchParams({q}).toString(),
      signal:controller.signal,
      cache:"no-store"
    });
    if(!response.ok)throw new Error(`Website search returned ${response.status}.`);
    const html=await response.text();
    const urls:string[]=[];
    const resultLink=/<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["']/gi;
    for(const m of html.matchAll(resultLink)){
      const decoded=decodeSearchUrl(m[1]);
      try{
        const u=new URL(decoded);
        if(u.protocol==="https:"&&!searchHostBlocked(u.hostname)&&!urls.includes(u.origin))urls.push(u.origin);
      }catch{}
      if(urls.length>=5)break;
    }
    return urls;
  }finally{
    clearTimeout(timer);
  }
}

async function verifyOfficialWebsite(url:string,input:WebsiteDiscoveryInput):Promise<WebsiteDiscoveryResult|null>{try{const base=await validatePublicHttps(url);const html=await fetchBounded(base);const text=strip(html).slice(0,200000);let score=0;const signals:string[]=[];const nameScore=overlap(input.businessName,text);if(nameScore>=0.8){score+=55;signals.push("business name")}else if(nameScore>=0.5){score+=35;signals.push("partial business name")}const hostName=base.hostname.replace(/^www\./,"").split(".")[0].replace(/[-_]/g," ");if(overlap(input.businessName,hostName)>=0.5){score+=20;signals.push("domain name")}if(input.city&&text.toLowerCase().includes(input.city.toLowerCase())){score+=15;signals.push("city")}if(input.zip&&text.includes(input.zip)){score+=20;signals.push("ZIP")}if(input.address&&overlap(input.address,text)>=0.5){score+=20;signals.push("address")}if(score<70)return null;return{url:base.origin,confidence:Math.min(95,score),signals}}catch{return null}}

export async function discoverOfficialWebsite(input:WebsiteDiscoveryInput){const candidates=await searchOfficialWebsite(input);const verified:WebsiteDiscoveryResult[]=[];for(const url of candidates.slice(0,3)){const match=await verifyOfficialWebsite(url,input);if(match)verified.push(match)}verified.sort((a,b)=>b.confidence-a.confidence);return verified[0]??null}


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
  candidates.push(...homeCandidates.filter(item=>item.fieldName==="business_email"||item.fieldName==="business_phone"));
  for(const link of rankOfficialSiteContactLinks(home,base)){
    try{
      const url=await validatePublicHttps(link.url,base.hostname),html=await fetchBounded(url,base.hostname),pageCandidates:Candidate[]=[];
      extractPage(html,url.toString(),link.pageType,pageCandidates);
      candidates.push(...pageCandidates.filter(item=>item.fieldName==="business_email"||item.fieldName==="business_phone"));
      if(link.pageType==="Contact")add(candidates,"contact_page_url",url.toString(),url.toString(),"Contact",95);
    }catch{}
  }
  return{canonicalUrl:base.origin,canonicalDomain:base.hostname.replace(/^www\./,""),candidates};
}
export async function enrichOfficialWebsite(input:string){const found=await extractOfficialWebsiteContacts(input),candidates=[...found.candidates],canonicalDomain=found.canonicalDomain;if(!candidates.some(x=>x.fieldName==="business_email"&&x.sourceType!=="Generated Candidate"))candidates.push(...generateBusinessEmailCandidates(canonicalDomain,candidates));return{...found,candidates}}
