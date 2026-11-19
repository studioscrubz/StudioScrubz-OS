import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const files=["components/contractors/ContractorPortal.tsx","components/contractors/ContractorPortalAdminPreview.tsx"];
test("Contractor dashboard metrics and invoice history appear above upcoming jobs, then recent opportunities",()=>{
 for(const file of files){
  const ui=readFileSync(new URL("../"+file,import.meta.url),"utf8");
  const dashboard=ui.indexOf(file.endsWith("/ContractorPortal.tsx")?'{data&&tab==="dashboard"&&<>':'{tab==="dashboard"&&<>');
  const metrics=ui.indexOf("Submitted opportunities",dashboard);
  const invoice=ui.indexOf("Invoice history",dashboard);
  const recent=ui.indexOf("Recent opportunities",dashboard);
  const upcoming=ui.indexOf("Upcoming jobs",dashboard);
  assert.ok(dashboard>0&&metrics>dashboard&&invoice>metrics&&upcoming>invoice&&recent>upcoming,`incorrect section order: ${file}`);
 }
});
