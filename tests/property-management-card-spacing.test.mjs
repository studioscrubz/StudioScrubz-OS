import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const page = readFileSync("app/site/property-management/page.tsx", "utf8");

test("property management cards have compact responsive spacing without losing content", () => {
  assert.match(page, /propertyAreas\.map\(\(\[title,copy\]\)/);
  assert.match(page, /bg-\[#f4f7f1\] p-5 sm:p-6/);
  assert.match(page, /className="mt-2 leading-6 text-neutral-600">\{copy\}/);
  assert.match(page, /md:grid-cols-2 xl:grid-cols-3/);
  assert.equal((page.match(/\["(?:Shared spaces|Leasing and community areas|Unit turns|Recurring property care|One-time and deep cleaning|Post-maintenance cleanup)"/g) || []).length, 6);
});
