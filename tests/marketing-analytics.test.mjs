import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const siteLayout = read("../app/site/layout.tsx");
const rootLayout = read("../app/layout.tsx");
const proxy = read("../proxy.ts");

test("Vercel Analytics is mounted only in the public marketing layout", () => {
  assert.match(siteLayout, /import \{ Analytics \} from "@vercel\/analytics\/next"/);
  assert.equal((siteLayout.match(/<Analytics\s*\/>/g) ?? []).length, 1);
  assert.doesNotMatch(rootLayout, /@vercel\/analytics|<Analytics\b/);
});

test("canonical marketing hosts rewrite into the Analytics-enabled site tree", () => {
  assert.match(proxy, /hostname === "studioscrubz\.com"/);
  assert.match(proxy, /destination\.pathname = pathname === "\/" \? "\/site" : `\/site\$\{pathname\}`/);
  assert.match(proxy, /const marketingPaths = new Set\(\["\/"/);
  assert.doesNotMatch(siteLayout, /\btrack\s*\(/);
});
