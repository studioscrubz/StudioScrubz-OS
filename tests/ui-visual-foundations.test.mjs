import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const target={exports:{}};
const source=readFileSync(new URL("../lib/ui/status.ts",import.meta.url),"utf8");
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(code,{module:target,exports:target.exports});
const {normalizeStatus,statusTone}=target.exports;

test("status semantics are centralized and normalization is stable",()=>{assert.equal(normalizeStatus("  READY_FOR-APPROVAL "),"ready for approval");assert.equal(statusTone("Completed"),"success");assert.equal(statusTone("In Progress"),"info");assert.equal(statusTone("Past Due"),"danger");assert.equal(statusTone("Archived"),"neutral");assert.equal(statusTone("Unexpected State"),"neutral")});

test("light and dark themes define every semantic status token",()=>{const css=readFileSync(new URL("../app/globals.css",import.meta.url),"utf8");for(const tone of ["success","info","warning","danger","neutral"])for(const part of ["bg","border","fg"])assert.equal((css.match(new RegExp(`--status-${tone}-${part}:`,"g"))??[]).length,2)});

test("shared primitives preserve accessible labels and roles",()=>{const badge=readFileSync(new URL("../components/ui/StatusBadge.tsx",import.meta.url),"utf8"),alert=readFileSync(new URL("../components/ui/Alert.tsx",import.meta.url),"utf8"),button=readFileSync(new URL("../components/ui/Button.tsx",import.meta.url),"utf8");assert.match(badge,/label\?\?status/);assert.match(alert,/role=\{urgent\?"alert":"status"\}/);assert.match(alert,/aria-live/);assert.match(button,/min-h-11/)});

test("existing PageHeader and MetricCard calls remain valid",()=>{const header=readFileSync(new URL("../components/layout/PageHeader.tsx",import.meta.url),"utf8"),metric=readFileSync(new URL("../components/ui/MetricCard.tsx",import.meta.url),"utf8");assert.match(header,/eyebrow = "Operations workspace"/);assert.match(header,/variant = "default"/);assert.match(metric,/value = "—"/);assert.match(metric,/label: string/)});
