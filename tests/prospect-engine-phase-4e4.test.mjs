import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const verification=await import("../lib/prospect-enrichment/emailDomainVerification.ts");
const foundation=await import("../lib/prospect-enrichment/providerFoundation.ts");
const providerSource=readFileSync("lib/prospect-enrichment/internalProviders.ts","utf8");
const verifierSource=readFileSync("lib/prospect-enrichment/emailDomainVerification.ts","utf8");
const orchestratorSource=readFileSync("lib/prospect-enrichment/orchestrator.ts","utf8");
const plannerSource=readFileSync("lib/prospect-enrichment/waterfallPlanner.ts","utf8");
const routeSource=readFileSync("app/api/prospects/enrich/route.ts","utf8");
const e1Source=readFileSync("lib/prospectEnrichment.ts","utf8");
const e2Tests=readFileSync("tests/prospect-engine-phase-4e2.test.mjs","utf8");
const e3Source=readFileSync("lib/prospect-enrichment/companyEmailPattern.ts","utf8");

const dnsError=code=>Object.assign(new Error(code),{code});
function resolver({mx=[],mxError,a=[],aaaa=[],aError,aaaaError}={}){
  const calls={mx:0,a:0,aaaa:0};
  return{calls,resolveMx:async()=>{calls.mx++;if(mxError)throw dnsError(mxError);return mx},resolve4:async()=>{calls.a++;if(aError)throw dnsError(aError);return a},resolve6:async()=>{calls.aaaa++;if(aaaaError)throw dnsError(aaaaError);return aaaa}};
}
const service=input=>new verification.EmailDomainVerificationService(input,()=>1_000,20);
function emailCandidate(sourceType="Official Website",status=sourceType==="Generated Candidate"?"unverified":"published",providerKey="site-contact-discovery"){
  return{fieldName:"business_email",value:"Person@Example.com",normalizedValue:"person@example.com",sourceType,sourceUrl:"https://example.com/team",sourcePageType:"Team",confidence:90,retrievedAt:"2026-09-30T00:00:00.000Z",evidence:{providerKey,providerVersion:"1",sourceKind:"Team",sourceType,sourceUrl:"https://example.com/team",sourcePageType:"Team",verificationStatus:status,discoveredAt:"2026-09-30T00:00:00.000Z"}};
}

test("valid syntax",()=>assert.deepEqual(verification.validateEmailSyntax("Jane.Smith@example.com").valid,true));
test("malformed syntax",()=>assert.equal(verification.validateEmailSyntax("jane@@example.com").valid,false));
test("whitespace and control characters are rejected",()=>{assert.equal(verification.validateEmailSyntax("jane smith@example.com").valid,false);assert.equal(verification.validateEmailSyntax("jane\n@example.com").valid,false)});
test("domain normalization lowercases strips trailing dot and handles IDN",()=>assert.equal(verification.normalizeEmailDomain("BÜCHER.Example."),"xn--bcher-kva.example"));

test("usable MX produces Valid technical result",async()=>{
  const result=await service(resolver({mx:[{exchange:"mail.example.com",priority:10}]})).verifyEmail("person@example.com");assert.equal(result.verificationStatus,"valid");assert.equal(result.mxPresent,true);
});
test("null MX produces Invalid",async()=>{
  const result=await service(resolver({mx:[{exchange:".",priority:0}]})).verifyEmail("person@example.com");assert.equal(result.verificationStatus,"invalid");assert.equal(result.nullMx,true);
});
test("unresolved domain produces Invalid",async()=>assert.equal((await service(resolver({mxError:"ENOTFOUND"})).verifyEmail("person@example.com")).verificationStatus,"invalid"));
test("no MX with address fallback produces Risky",async()=>{
  const result=await service(resolver({mxError:"ENODATA",a:["192.0.2.1"],aaaaError:"ENODATA"})).verifyEmail("person@example.com");assert.equal(result.verificationStatus,"risky");assert.equal(result.fallbackMailHostSignal,true);
});
test("temporary DNS failure does not become Invalid",async()=>{
  const result=await service(resolver({mxError:"EAI_AGAIN"})).verifyEmail("person@example.com");assert.equal(result.verificationStatus,"unknown");assert.equal(result.dnsOutcome,"temporary_failure");
});

test("role address classification is separate",()=>{assert.equal(verification.classifyRoleAddress("info"),true);assert.equal(verification.classifyRoleAddress("jane.smith"),false)});
test("role address can still be technically valid",async()=>{
  const result=await service(resolver({mx:[{exchange:"mail.example.com",priority:10}]})).verifyEmail("info@example.com");assert.equal(result.roleAddress,true);assert.equal(result.verificationStatus,"valid");
});
test("generated candidate remains Generated Candidate",()=>assert.match(providerSource,/\.\.\.source[\s\S]*sourceType:source\.sourceType/));
test("published candidate remains Official Website and Published provenance",()=>assert.match(providerSource,/if\(!current\|\|current\.sourceType==="Generated Candidate"&&item\.sourceType!=="Generated Candidate"\)sourceByEmail\.set/));
test("verification creates separate evidence instead of overwriting source",()=>assert.match(providerSource,/providerKey:"email-domain-verification"[\s\S]*sourceType:source\.sourceType/));

test("multiple emails on one domain reuse the DNS result",async()=>{
  const fake=resolver({mx:[{exchange:"mail.example.com",priority:10}]}),instance=service(fake);await instance.verifyEmail("one@example.com");const second=await instance.verifyEmail("two@example.com");assert.equal(fake.calls.mx,1);assert.equal(second.cacheHit,true);
});
test("DNS records are bounded",async()=>{
  const mx=Array.from({length:25},(_,index)=>({exchange:`mx${index}.example.com`,priority:index}));const result=await service(resolver({mx})).verifyEmail("person@example.com");assert.equal(result.mxCount,verification.EMAIL_DNS_MAX_RECORDS);
});
test("timeout is classified as temporary",async()=>{
  const never=new Promise(()=>{}),fake={resolveMx:()=>never,resolve4:()=>never,resolve6:()=>never};const result=await new verification.EmailDomainVerificationService(fake,()=>0,5).verifyEmail("person@example.com");assert.equal(result.verificationStatus,"unknown");assert.equal(result.dnsOutcome,"temporary_failure");
});
test("provider calls remain zero cost",()=>assert.match(providerSource,/email-domain-verification[\s\S]*usage:\{creditsUsed:0,costMinorUnits:0\}/));
test("persisted DNS metadata is bounded and sanitized",()=>{
  for(const key of ["syntaxValid","domainResolved","mxPresent","mxCount","nullMx","fallbackMailHostSignal","roleAddress","dnsOutcome"])assert.match(providerSource,new RegExp(key));
  assert.doesNotMatch(providerSource,/mxRecords|addresses:/);
});
test("no SMTP probing exists",()=>assert.doesNotMatch(verifierSource,/smtp|rcpt|nodemailer|net\.connect|createConnection/i));
test("no external verification provider exists",()=>assert.doesNotMatch(`${verifierSource}\n${providerSource}`,/Hunter|Apollo|A-Leads|ZeroBounce|NeverBounce|Kickbox/i));
test("no API key is introduced",()=>assert.doesNotMatch(`${verifierSource}\n${providerSource}`,/api[_-]?key|authorization|bearer/i));

test("provider registry includes priority-900 email verification",()=>{
  assert.match(providerSource,/providerKey:"email-domain-verification",version:"1",capabilities:\["email_verification"\],priority:900/);
  assert.match(providerSource,/companyEmailPatternProvider,emailDomainVerificationProvider,generatedRoleEmailProvider/);
});
test("verification need stops after technical evidence exists",()=>{
  const original=emailCandidate(),before=foundation.planEnrichmentNeeds({discoveryResultId:"r",businessName:"B"},[original]);
  const checked={...original,evidence:{...original.evidence,providerKey:"email-domain-verification",verificationStatus:"valid"}};
  const after=foundation.planEnrichmentNeeds({discoveryResultId:"r",businessName:"B"},[original,checked]);assert.equal(before.emailVerification,true);assert.equal(after.emailVerification,false);
});
test("duplicate verification is prevented by needs and fingerprint identity",()=>{
  assert.match(orchestratorSource,/emailDomains=operation==="email_verification"/);assert.match(plannerSource,/attemptedFingerprints\.has/);
});
test("API route remains provider-neutral",()=>assert.doesNotMatch(routeSource,/email-domain-verification|resolveMx|email_verification/));
test("existing 4E.1 bounded site discovery remains intact",()=>assert.match(e1Source,/SITE_CONTACT_MAX_TOTAL_PAGES=7/));
test("existing 4E.2 person association remains intact",()=>assert.match(e2Tests,/two person cards remain separate/));
test("existing 4E.3 pattern engine remains intact",()=>assert.match(e3Source,/first_initial_last/));

test("cache is bounded and provider-version policy keyed",()=>{
  assert.equal(verification.EMAIL_DNS_CACHE_MAX_ENTRIES,128);assert.match(verifierSource,/EMAIL_DOMAIN_VERIFICATION_PROVIDER_KEY\}\|\$\{EMAIL_DOMAIN_VERIFICATION_VERSION\}\|domain_verification\|\$\{domain\}\|\$\{EMAIL_DOMAIN_VERIFICATION_POLICY\}/);
});
