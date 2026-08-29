import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Property Management has a dedicated canonical landing page", async () => {
  const page = await read("app/site/property-management/page.tsx");
  assert.match(page, /Property Management Cleaning Los Angeles \| StudioScrubz/);
  assert.match(page, /canonical: "https:\/\/studioscrubz\.com\/property-management"/);
  assert.match(page, /url: "https:\/\/studioscrubz\.com\/property-management"/);
  assert.match(page, /title="Property management cleaning built for busy communities\."/);
  assert.equal((page.match(/<PageHero/g) ?? []).length, 1);
});

test("Airbnb has a distinct canonical turnover-cleaning page", async () => {
  const page = await read("app/site/airbnb-cleaning/page.tsx");
  assert.match(page, /Airbnb Cleaning Services Los Angeles \| StudioScrubz/);
  assert.match(page, /canonical: "https:\/\/studioscrubz\.com\/airbnb-cleaning"/);
  assert.match(page, /url: "https:\/\/studioscrubz\.com\/airbnb-cleaning"/);
  assert.match(page, /title="Turnover cleaning that keeps your rental guest-ready\."/);
  assert.match(page, /Same-day turnover capability depends on scheduling/);
  assert.match(page, /host-provided consumables/i);
  assert.equal((page.match(/<PageHero/g) ?? []).length, 1);
});

test("public routing, discovery, and service cards include both pages", async () => {
  const [proxy, sitemap, robots, data, layout] = await Promise.all([
    read("proxy.ts"), read("app/sitemap.ts"), read("app/robots.ts"),
    read("components/site/siteData.ts"), read("app/site/layout.tsx"),
  ]);
  for (const route of ["/property-management", "/airbnb-cleaning"]) {
    assert.match(proxy, new RegExp(`"${route}"`));
    assert.match(sitemap, new RegExp(`"${route}"`));
    assert.match(robots, new RegExp(`"${route}"`));
    assert.match(data, new RegExp(`href: "${route}"`));
    assert.match(layout, new RegExp(`https://studioscrubz\\.com${route}`));
  }
  assert.doesNotMatch(data, /Airbnb \/ Turnover Cleaning[\s\S]*?href: "\/residential#turnovers"/);
  assert.doesNotMatch(data, /Property Management \/ Unit Turns[\s\S]*?href: "\/commercial#property-management"/);
});

test("related public pages link contextually to the new destinations", async () => {
  const [commercial, residential, postConstruction] = await Promise.all([
    read("app/site/commercial/page.tsx"),
    read("app/site/residential/page.tsx"),
    read("app/site/post-construction/page.tsx"),
  ]);
  assert.match(commercial, /\["Property Management Cleaning", "\/property-management"\]/);
  assert.match(residential, /\["Airbnb \/ Short-Term Rental Cleaning", "\/airbnb-cleaning"\]/);
  assert.match(postConstruction, /\["Property Management Cleaning", "\/property-management"\]/);
});
