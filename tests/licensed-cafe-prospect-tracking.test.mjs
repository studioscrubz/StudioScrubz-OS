import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("lib/prospectCafe.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports });
const { licensedCafeIndustry, readCafeNote, updateCafeNote } = module.exports;

test("licensed café category is available and matches CSV vocabulary", () => {
  assert.equal(licensedCafeIndustry, "Licensed Starbucks / In-Store Cafés");
});

test("reads imported café qualification metadata from Notes", () => {
  const notes = [
    "Host company: Target",
    "Facilities decision-maker: Not identified",
    "Outside specialty-cleaning vendors: Not confirmed",
    "Source URL: https://www.target.com/example",
  ].join("\n");
  assert.equal(readCafeNote(notes, "Host company"), "Target");
  assert.equal(readCafeNote(notes, "Facilities decision-maker"), "Not identified");
  assert.equal(readCafeNote(notes, "Outside specialty-cleaning vendors"), "Not confirmed");
});

test("reads one-line Notes after CSV whitespace normalization", () => {
  const notes = "Host company: Ralphs | Facilities decision-maker: Not identified | Outside specialty-cleaning vendors: Not confirmed | Source URL: https://www.ralphs.com/example";
  assert.equal(readCafeNote(notes, "Host company"), "Ralphs");
  assert.equal(readCafeNote(notes, "Outside specialty-cleaning vendors"), "Not confirmed");
  const next = updateCafeNote(notes, "Outside specialty-cleaning vendors", "Approval required");
  assert.equal(readCafeNote(next, "Outside specialty-cleaning vendors"), "Approval required");
  assert.match(next, /Source URL: https:\/\/www.ralphs.com\/example/);
});

test("editing tracked fields preserves unrelated notes and source links", () => {
  const original = "Host company: Target\nOutside specialty-cleaning vendors: Not confirmed\nSource URL: https://www.target.com/example";
  const updated = updateCafeNote(original, "Outside specialty-cleaning vendors", "Approval required");
  assert.equal(readCafeNote(updated, "Outside specialty-cleaning vendors"), "Approval required");
  assert.match(updated, /Host company: Target/);
  assert.match(updated, /Source URL: https:\/\/www.target.com\/example/);
  const changedAgain = updateCafeNote(updated, "Outside specialty-cleaning vendors", "Allowed");
  assert.equal(changedAgain.split("Outside specialty-cleaning vendors:").length - 1, 1);
  assert.equal(readCafeNote(updateCafeNote(changedAgain, "Facilities decision-maker", "Manager Name"), "Facilities decision-maker"), "Manager Name");
});

test("café fields are visible in edit and detail views without DB column changes", () => {
  const page = readFileSync("components/prospects/ProspectsPage.tsx", "utf8");
  assert.match(page, /Set licensed Starbucks \/ in-store café category/);
  assert.match(page, /Licensed café qualification/);
  assert.match(page, /readCafeNote\(form.notes,"Host company"\)/);
  assert.match(page, /updateCafeNote\(form.notes,"Outside specialty-cleaning vendors"/);
});
