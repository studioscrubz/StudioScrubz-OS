import dns from "node:dns/promises";
import { domainToASCII } from "node:url";
import type { VerificationStatus } from "./providerFoundation.ts";

export const EMAIL_DOMAIN_VERIFICATION_PROVIDER_KEY="email-domain-verification";
export const EMAIL_DOMAIN_VERIFICATION_VERSION="1";
export const EMAIL_DOMAIN_VERIFICATION_POLICY="dns-policy-v1";
export const EMAIL_DNS_CACHE_TTL_MS=60*60*1000;
export const EMAIL_DNS_TRANSIENT_CACHE_TTL_MS=5*60*1000;
export const EMAIL_DNS_CACHE_MAX_ENTRIES=128;
export const EMAIL_DNS_MAX_RECORDS=10;
export const EMAIL_DNS_TIMEOUT_MS=4000;

const ROLE_LOCAL_PARTS=new Set(["info","contact","hello","office","sales","support","leasing","admin","billing","accounts","customerservice","service","help"]);
const TEMPORARY_DNS_CODES=new Set(["ETIMEOUT","EAI_AGAIN","SERVFAIL","REFUSED","ECONNREFUSED","ECONNRESET"]);
const NO_DATA_CODES=new Set(["ENODATA","NODATA"]);
const NOT_FOUND_CODES=new Set(["ENOTFOUND","NXDOMAIN"]);

export interface EmailDnsResolver{
  resolveMx(domain:string):Promise<Array<{exchange:string;priority:number}>>;
  resolve4(domain:string):Promise<string[]>;
  resolve6(domain:string):Promise<string[]>;
}
export interface DomainVerificationResult{
  normalizedDomain:string;
  verificationStatus:Extract<VerificationStatus,"valid"|"risky"|"invalid"|"unknown">;
  domainResolved:boolean;
  mxPresent:boolean;
  mxCount:number;
  nullMx:boolean;
  fallbackMailHostSignal:boolean;
  dnsOutcome:"usable_mx"|"null_mx"|"address_fallback"|"unresolved"|"temporary_failure";
}
export interface EmailValidationResult extends DomainVerificationResult{
  syntaxValid:boolean;
  normalizedEmail:string|null;
  roleAddress:boolean;
  disposableClassification:"unknown";
  cacheHit:boolean;
}

const defaultResolver:EmailDnsResolver={resolveMx:domain=>dns.resolveMx(domain),resolve4:domain=>dns.resolve4(domain),resolve6:domain=>dns.resolve6(domain)};
function errorCode(error:unknown){return typeof error==="object"&&error!==null&&"code" in error?String((error as {code:unknown}).code).toUpperCase():"UNKNOWN"}
async function withTimeout<T>(work:Promise<T>,timeoutMs:number){let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([work,new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error("DNS lookup timed out."),{code:"ETIMEOUT"})),timeoutMs)})])}finally{if(timer)clearTimeout(timer)}}
export function normalizeEmailDomain(value:string){const trimmed=value.trim().toLowerCase().replace(/\.+$/,"");const ascii=domainToASCII(trimmed);return ascii.toLowerCase()}
export function classifyRoleAddress(localPart:string){return ROLE_LOCAL_PARTS.has(localPart.trim().toLowerCase())}
function validDomainSyntax(domain:string){return Boolean(domain)&&domain.length<=253&&domain.includes(".")&&!domain.split(".").some(label=>!label||label.length>63||label.startsWith("-")||label.endsWith("-")||!/^[a-z0-9-]+$/.test(label))}
export function validateEmailSyntax(value:string){
  if(value.length>254||/[\s\u0000-\u001f\u007f]/.test(value)||(value.match(/@/g)||[]).length!==1)return{valid:false as const,normalizedEmail:null,localPart:null,normalizedDomain:null};
  const[local,rawDomain]=value.split("@");const domain=normalizeEmailDomain(rawDomain||"");
  if(!local||local.length>64||local.startsWith(".")||local.endsWith(".")||local.includes("..")||!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local))return{valid:false as const,normalizedEmail:null,localPart:null,normalizedDomain:null};
  if(!validDomainSyntax(domain))return{valid:false as const,normalizedEmail:null,localPart:null,normalizedDomain:null};
  return{valid:true as const,normalizedEmail:`${local.toLowerCase()}@${domain}`,localPart:local.toLowerCase(),normalizedDomain:domain};
}

export class EmailDomainVerificationService{
  private readonly cache=new Map<string,{expiresAt:number;result:DomainVerificationResult}>();
  private readonly resolver:EmailDnsResolver;
  private readonly now:()=>number;
  private readonly timeoutMs:number;
  constructor(resolver:EmailDnsResolver=defaultResolver,now=()=>Date.now(),timeoutMs=EMAIL_DNS_TIMEOUT_MS){this.resolver=resolver;this.now=now;this.timeoutMs=timeoutMs}
  get cacheSize(){return this.cache.size}
  clearCache(){this.cache.clear()}
  private cacheKey(domain:string){return `${EMAIL_DOMAIN_VERIFICATION_PROVIDER_KEY}|${EMAIL_DOMAIN_VERIFICATION_VERSION}|domain_verification|${domain}|${EMAIL_DOMAIN_VERIFICATION_POLICY}`}
  private remember(key:string,result:DomainVerificationResult){if(this.cache.size>=EMAIL_DNS_CACHE_MAX_ENTRIES)this.cache.delete(this.cache.keys().next().value!);this.cache.set(key,{expiresAt:this.now()+(result.verificationStatus==="unknown"?EMAIL_DNS_TRANSIENT_CACHE_TTL_MS:EMAIL_DNS_CACHE_TTL_MS),result})}
  async verifyDomain(input:string){
    const normalizedDomain=normalizeEmailDomain(input),key=this.cacheKey(normalizedDomain),cached=this.cache.get(key);
    if(cached&&cached.expiresAt>this.now())return{result:cached.result,cacheHit:true};if(cached)this.cache.delete(key);
    let result:DomainVerificationResult;
    try{
      const records=(await withTimeout(this.resolver.resolveMx(normalizedDomain),this.timeoutMs)).slice(0,EMAIL_DNS_MAX_RECORDS);
      const nullMx=records.some(record=>record.priority===0&&record.exchange.replace(/\.$/,"")==="");
      const usable=records.filter(record=>record.exchange&&record.exchange!=="."&&validDomainSyntax(normalizeEmailDomain(record.exchange)));
      result=nullMx?{normalizedDomain,verificationStatus:"invalid",domainResolved:true,mxPresent:false,mxCount:0,nullMx:true,fallbackMailHostSignal:false,dnsOutcome:"null_mx"}:usable.length?{normalizedDomain,verificationStatus:"valid",domainResolved:true,mxPresent:true,mxCount:Math.min(usable.length,EMAIL_DNS_MAX_RECORDS),nullMx:false,fallbackMailHostSignal:false,dnsOutcome:"usable_mx"}:await this.resolveFallback(normalizedDomain,false);
    }catch(error){
      const code=errorCode(error);
      result=NO_DATA_CODES.has(code)?await this.resolveFallback(normalizedDomain,false):NOT_FOUND_CODES.has(code)?{normalizedDomain,verificationStatus:"invalid",domainResolved:false,mxPresent:false,mxCount:0,nullMx:false,fallbackMailHostSignal:false,dnsOutcome:"unresolved"}:{normalizedDomain,verificationStatus:"unknown",domainResolved:false,mxPresent:false,mxCount:0,nullMx:false,fallbackMailHostSignal:false,dnsOutcome:"temporary_failure"};
    }
    this.remember(key,result);return{result,cacheHit:false};
  }
  private async resolveFallback(normalizedDomain:string,mxPresent:boolean):Promise<DomainVerificationResult>{
    const lookups=await Promise.allSettled([withTimeout(this.resolver.resolve4(normalizedDomain),this.timeoutMs),withTimeout(this.resolver.resolve6(normalizedDomain),this.timeoutMs)]);
    const addresses=lookups.flatMap(item=>item.status==="fulfilled"?item.value.slice(0,EMAIL_DNS_MAX_RECORDS):[]).slice(0,EMAIL_DNS_MAX_RECORDS);
    if(addresses.length)return{normalizedDomain,verificationStatus:"risky",domainResolved:true,mxPresent,mxCount:0,nullMx:false,fallbackMailHostSignal:true,dnsOutcome:"address_fallback"};
    const codes=lookups.filter((item):item is PromiseRejectedResult=>item.status==="rejected").map(item=>errorCode(item.reason));
    const temporary=codes.some(code=>TEMPORARY_DNS_CODES.has(code)||!NO_DATA_CODES.has(code)&&!NOT_FOUND_CODES.has(code));
    return{normalizedDomain,verificationStatus:temporary?"unknown":"invalid",domainResolved:false,mxPresent,mxCount:0,nullMx:false,fallbackMailHostSignal:false,dnsOutcome:temporary?"temporary_failure":"unresolved"};
  }
  async verifyEmail(value:string):Promise<EmailValidationResult>{
    const syntax=validateEmailSyntax(value);
    if(!syntax.valid)return{syntaxValid:false,normalizedEmail:null,normalizedDomain:"",roleAddress:false,disposableClassification:"unknown",cacheHit:false,verificationStatus:"invalid",domainResolved:false,mxPresent:false,mxCount:0,nullMx:false,fallbackMailHostSignal:false,dnsOutcome:"unresolved"};
    const domain=await this.verifyDomain(syntax.normalizedDomain);
    return{...domain.result,syntaxValid:true,normalizedEmail:syntax.normalizedEmail,roleAddress:classifyRoleAddress(syntax.localPart),disposableClassification:"unknown",cacheHit:domain.cacheHit};
  }
}

export const emailDomainVerificationService=new EmailDomainVerificationService();
