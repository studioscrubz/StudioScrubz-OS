import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read=(p)=>readFileSync(new URL(p,import.meta.url),"utf8");
test("public marketing homepage features registered and insured wording without license claims",()=>{
 const homepage=read("../app/site/page.tsx");
 assert.match(homepage,/Registered &amp; Insured/);
 assert.match(homepage,/No Mess\. No Stress\./);
 assert.doesNotMatch(homepage,/Licensed &amp; Insured/);
});
test("all marketing pages share registered and insured footer branding",()=>{
 const chrome=read("../components/site/SiteChrome.tsx");
 assert.match(chrome,/Registered &amp; Insured/);
 assert.match(chrome,/export function SiteFooter/);
});
