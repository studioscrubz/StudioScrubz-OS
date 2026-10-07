import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

function source(path) { return readFileSync(resolve(path), "utf8"); }
function load(path) {
  const output=ts.transpileModule(source(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  new Function("exports","module","require",output)(module.exports,module,()=>({}));
  return module.exports;
}

const questionnaire=load("lib/customerPhotoAssessment.ts");
const input=questionnaire.normalizeCustomerPhotoAssessment({
  propertyType:"Single-family home",squareFeet:2200,occupied:true,bedrooms:3,bathrooms:2,
  areasInScope:["Kitchen","Bedrooms","Bathrooms","Other","INTERNAL_FIELD"],bedroomQuantity:3,bathroomQuantity:2,otherScope:"Sunroom",
  areasExcluded:"Locked office",condition:"Heavy",lastProfessionallyCleaned:"Over one year ago",
  conditionConcerns:["Heavy buildup","Pet hair"],problemAreas:"Mineral buildup in primary shower",
  stairs:"One flight",elevator:"None",parkingAccess:"Driveway",gateAccessInstructions:"Call on arrival",pets:"One dog",
  waterAvailable:"Yes",powerAvailable:"Yes",specialItems:["Inside Oven"],
  serviceAnswers:{moveDirection:"Move-out",completelyVacant:"Yes"},certificationAccepted:true,
});
assert.doesNotThrow(()=>questionnaire.validateCustomerPhotoAssessment(input));
assert.deepEqual(questionnaire.customerScope(input).map(item=>item.label),["Kitchen","Bedrooms (3)","Bathrooms (2)","Sunroom"]);
const saved=questionnaire.customerSubmission(input,"2026-10-07T20:00:00.000Z");
assert.equal(saved.certificationAccepted,true);
assert.equal(saved.reviewStatus,"Pending Review");
assert.equal(saved.serviceAnswers.moveDirection,"Move-out");
assert.throws(()=>questionnaire.validateCustomerPhotoAssessment({...input,certificationAccepted:false}),/acknowledgment/i);
assert.equal(questionnaire.serviceQuestionKind("Post-Construction Cleaning"),"post-construction");
assert.equal(questionnaire.serviceQuestionKind("Move-In / Move-Out"),"move");
assert.equal(questionnaire.serviceQuestionKind("Pressure Washing"),"pressure");
assert.match(questionnaire.guidedPhotoPrompts("Standard Cleaning",["Kitchen"],["Heavy buildup"]).join(" "),/Kitchen overview/);

const route=source("app/api/public/assessments/[token]/photos/route.ts");
assert.match(route,/assessmentForToken\(token\)/g);
assert.match(route,/export async function PUT/);
assert.match(route,/customerPhotoAssessment:\s*submission/);
assert.match(route,/scope:\s*customerScope\(input\)/);
assert.match(route,/sales_stage:\s*"Assessment In Progress"/);
assert.doesNotMatch(route,/status:\s*"Completed"/);
assert.doesNotMatch(route,/from\("proposals"\)|createProposal/);
assert.doesNotMatch(route,/pricing_review|workerHourlyPay|targetProfitMarginPercent/);

const access=source("lib/assessmentPhotoAccess.ts");
assert.match(access,/\.eq\("token_hash",hashAssessmentToken\(token\)\)/);
assert.match(access,/\.eq\("id",access\.walkthrough_id\)/);
assert.doesNotMatch(access,/to anon|create policy/i);

const publicUi=source("components/walkthroughs/CustomerAssessmentPhotos.tsx");
assert.match(publicUi,/Property.*Scope.*Condition.*Access & Items.*Photos.*Review & Confirm/s);
assert.match(publicUi,/certificationAccepted/);
assert.match(publicUi,/Submit Photo Assessment for Review/);
assert.match(publicUi,/serviceQuestionKind/);

const internalUi=source("components/walkthroughs/WalkthroughFormModal.tsx");
assert.match(internalUi,/Approve for Pricing/);
assert.match(internalUi,/Request More Information/);
assert.match(internalUi,/Require On-Site Assessment/);
assert.match(internalUi,/Submission Method.*Customer Photo Assessment/s);
assert.match(internalUi,/reviewStatus:action==="approve"\?"Approved for Pricing"/);

console.log("Customer photo Assessment questionnaire tests passed.");
