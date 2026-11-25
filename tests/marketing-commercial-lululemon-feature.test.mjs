import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const commercial=readFileSync(new URL("../app/site/commercial/page.tsx",import.meta.url),"utf8");

test("commercial page features recurring lululemon service alongside existing Starbucks and WAM projects",()=>{
 assert.match(commercial,/Starbucks — Commercial High-Dusting Services/);
 assert.match(commercial,/lululemon — Recurring Retail Cleaning/);
 assert.match(commercial,/Women&apos;s Audio Mission Academy/);
 assert.match(commercial,/Downtown Disney, Anaheim/);
 assert.doesNotMatch(commercial,/Service Frequency/);
 assert.match(commercial,/alt="lululemon logo"/);
 assert.match(commercial,/lululemon-logo\.png/);
});
test("featured retail subcontract does not imply a direct lululemon contract or endorsement",()=>{
 assert.match(commercial,/LJ Facility Services LLC Subcontract/);
 assert.match(commercial,/Services are provided as a subcontractor to LJ Facility Services LLC\. Reference to lululemon identifies the serviced location and does not imply endorsement or a direct contract with lululemon\./);
});
