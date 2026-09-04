import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

function source(path){return readFileSync(resolve(path),"utf8")}
function load(path){const output=ts.transpileModule(source(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,loadedModule={exports:{}};new Function("exports","module","require",output)(loadedModule.exports,loadedModule,()=>({}));return loadedModule.exports}

const workflow=load("lib/walkthroughWorkflow.ts");
const legacy={status:"Completed",walkthrough_date:"2026-09-10",walkthrough_time:"10:00",measurements:{},photos:[]};
assert.equal(workflow.assessmentMethod(legacy),"In-Person Walkthrough");
assert.doesNotThrow(()=>workflow.assertWalkthroughSchedule(legacy));
assert.throws(()=>workflow.assertWalkthroughSchedule({...legacy,walkthrough_time:null}),/date and time must be scheduled together/);
const photo={status:"Completed",walkthrough_date:null,walkthrough_time:null,measurements:{assessmentMethod:"Customer Photo Submission",photoSubmittedAt:"2026-09-04T00:00:00Z"},photos:[{}]};
assert.doesNotThrow(()=>workflow.assertWalkthroughSchedule(photo));
assert.equal(workflow.assessmentReadyForPricing(photo),true);
assert.equal(workflow.assessmentReadyForPricing({...photo,measurements:{assessmentMethod:"Customer Photo Submission"},photos:[]}),false);

const publicRequest=source("lib/services/publicEstimateRequests.ts");
assert.match(publicRequest,/from\("walkthroughs"\)\.insert/);
assert.match(publicRequest,/catalogAddons:result\.catalogAddons/);
assert.match(publicRequest,/estimate_id:created\.data\.id/);

const walkthroughService=source("lib/services/walkthroughs.ts");
assert.match(walkthroughService,/from\("properties"\)\.update\(propertyUpdate\)/);
assert.match(walkthroughService,/from\("estimates"\)\.update/);
assert.match(walkthroughService,/calculatorInput/);

const contacts=source("components/walkthroughs/SalesContactAttempts.tsx");
assert.match(contacts,/createCommunication/);
assert.match(contacts,/salesQualification:true/);
assert.match(contacts,/estimate_id:estimateId/);

const publicPhotos=source("app/api/public/assessments/[token]/photos/route.ts");
assert.match(publicPhotos,/assessmentForToken\(token\)/g);
assert.match(publicPhotos,/createSupabaseAdminClient/);
assert.doesNotMatch(publicPhotos,/NEXT_PUBLIC_SUPABASE_SERVICE/);
assert.match(publicPhotos,/walkthroughs\/\$\{assessment\.walkthrough\.id\}/);
assert.doesNotMatch(publicPhotos,/status:"Completed"/); assert.match(publicPhotos,/photoSubmissionStatus:"Submitted"/);

const tokenAccess=source("lib/assessmentPhotoAccess.ts"),migration=source("supabase/migrations/20260904023016_sales_qualification_property_assessment.sql");
assert.match(tokenAccess,/createHash\("sha256"\)/);
assert.match(tokenAccess,/\.eq\("token_hash",hashAssessmentToken\(token\)\)/);
assert.match(migration,/enable row level security/i);
assert.match(migration,/revoke all on table public\.assessment_photo_access from public, anon, authenticated/i);
assert.doesNotMatch(migration,/create policy[\s\S]+to anon/i);

const pricingReview=source("app/api/walkthroughs/pricing-review/route.ts"),proposal=source("components/proposals/ProposalBuilder.tsx");
assert.match(pricingReview,/walkthrough\.status !== "Completed"/);
assert.match(proposal,/pricing_review\?\.estimateResult/);
assert.match(proposal,/catalogAddons/);

console.log("Sales assessment workflow tests passed.");

