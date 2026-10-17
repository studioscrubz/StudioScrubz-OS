import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const component = fs.readFileSync(path.join(root, "components/site/ResidentialShowcaseCarousel.tsx"), "utf8");
const results = fs.readFileSync(path.join(root, "components/site/ProjectResults.tsx"), "utf8");

test("the server results component reuses all five residential photos through the client carousel", () => {
  assert.match(results, /const residentialShowcase = \[/);
  assert.equal((results.match(/residential-[a-z-]+\.webp/g) ?? []).length, 5);
  assert.match(results, /<ResidentialShowcaseCarousel photos=\{residentialShowcase\} \/>/);
});

test("the carousel supports touch, keyboard, controls, indicators, and reduced motion without autoplay", () => {
  assert.match(component, /^"use client";/);
  assert.match(component, /overflow-x-auto/);
  assert.match(component, /snap-mandatory/);
  assert.match(component, /event\.key === "ArrowLeft"/);
  assert.match(component, /event\.key === "ArrowRight"/);
  assert.match(component, /aria-label="Show previous residential photos"/);
  assert.match(component, /aria-label="Show next residential photos"/);
  assert.match(component, /Go to carousel position/);
  assert.match(component, /prefers-reduced-motion: reduce/);
  assert.match(component, /motion-reduce:scroll-auto/);
  assert.doesNotMatch(component, /setInterval|autoplay/i);
});

test("responsive image sizing keeps one mobile slide and roughly two desktop slides", () => {
  assert.match(component, /basis-full/);
  assert.match(component, /md:basis-\[calc\(50%-0\.625rem\)\]/);
  assert.match(component, /width=\{1050\}/);
  assert.match(component, /height=\{1400\}/);
  assert.match(component, /object-contain/);
});
