import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = path => readFileSync(new URL("../"+path, import.meta.url),"utf8");
const view=read("components/estimates/PublicEstimateRequest.tsx");
const server=read("lib/services/publicEstimateRequests.ts");
const surfacePicker=read("components/estimates/ElevatedSurfaceMultiSelect.tsx");
test("customer high dusting collects five area measurements, height, methods and scope",()=>{
 for(const field of ["Square Feet","Bathrooms","Kitchens","Common Areas","Units","Highest surface / working height","Access methods (select all that apply)"]) assert.ok(view.includes(field),field);
 assert.match(view, /<ElevatedSurfaceMultiSelect required value={highDustingScope}/);
 assert.match(surfacePicker, /Elevated surfaces and scope/);
 assert.match(surfacePicker, /type="checkbox"/);
 for(const field of ["commonAreas","highDustingHeight","highDustingAccessMethods","highDustingScope"]) {
  assert.ok(view.includes(field),field);
  assert.ok(server.includes(field),field);
 }
});
test("public quote uses server-only estimate values and preserves high dusting scope in sales review",()=>{
 assert.match(server,/const highDustingInput = highDusting \?/);
 assert.match(server,/priceHighDusting\(highDustingInput\)/);
 assert.match(server,/calculateCommercialEstimate\(calculator, catalog\)/);
 assert.match(server,/specialtyAreas: input\.division === "Commercial"/);
 assert.match(view,/Preliminary High Dusting Estimate/);
 assert.doesNotMatch(view,/hourlyLaborCost|targetMarginPercent|travelAndOverhead/);
});
