import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const publicPages = new Map([
  ["app/site/page.tsx", "https://studioscrubz.com/"],
  ["app/site/residential/page.tsx", "https://studioscrubz.com/residential"],
  ["app/site/commercial/page.tsx", "https://studioscrubz.com/commercial"],
  ["app/site/property-management/page.tsx", "https://studioscrubz.com/property-management"],
  ["app/site/property-porter-services/page.tsx", "https://studioscrubz.com/property-porter-services"],
  ["app/site/luxury-property-care/page.tsx", "https://studioscrubz.com/luxury-property-care"],
  ["app/site/airbnb-cleaning/page.tsx", "https://studioscrubz.com/airbnb-cleaning"],
  ["app/site/post-construction/page.tsx", "https://studioscrubz.com/post-construction"],
  ["app/site/pressure-washing/page.tsx", "https://studioscrubz.com/pressure-washing"],
  ["app/site/about/page.tsx", "https://studioscrubz.com/about"],
  ["app/site/contact/page.tsx", "https://studioscrubz.com/contact"],
  ["app/site/careers/page.tsx", "https://studioscrubz.com/careers"],
]);

const servicePages = [
  "app/site/residential/page.tsx",
  "app/site/commercial/page.tsx",
  "app/site/property-management/page.tsx",
  "app/site/property-porter-services/page.tsx",
  "app/site/luxury-property-care/page.tsx",
  "app/site/airbnb-cleaning/page.tsx",
  "app/site/post-construction/page.tsx",
  "app/site/pressure-washing/page.tsx",
];

test("public pages define canonical and complete social metadata", async () => {
  for (const [path, canonical] of publicPages) {
    const source = await read(path);
    assert.match(source, /export const metadata/, `${path} needs static metadata`);
    const escapedCanonical = canonical.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(source, new RegExp(`canonical\\s*:\\s*"${escapedCanonical}"`), `${path} needs its exact canonical URL`);
    assert.match(source, /openGraph\s*:/, `${path} needs Open Graph metadata`);
    assert.match(source, /twitter\s*:/, `${path} needs Twitter metadata`);
    assert.doesNotMatch(source, /robots\s*:\s*\{[^}]*index\s*:\s*false/, `${path} must remain indexable`);
  }
});

test("structured data covers the business, services, breadcrumbs, and visible FAQ", async () => {
  const layout = await read("app/site/layout.tsx");
  const helpers = await read("components/site/SeoJsonLd.tsx");
  const home = await read("app/site/page.tsx");

  assert.ok(layout.includes('["LocalBusiness", "CleaningService"]'));
  assert.ok(layout.includes('"@id": "https://studioscrubz.com/#business"'));
  assert.match(helpers, /"@type": "Service"/);
  assert.match(helpers, /"@type": "BreadcrumbList"/);
  assert.match(helpers, /"@type": "FAQPage"/);
  assert.match(helpers, /provider:\s*\{\s*"@id": `\$\{origin\}\/\#business`/s);
  assert.ok(home.includes("<FaqJsonLd items={faqItems} />"));

  for (const path of servicePages) {
    assert.match(await read(path), /<ServicePageJsonLd\s/, `${path} needs Service and breadcrumb schema`);
  }

  for (const path of ["app/site/about/layout.tsx", "app/site/contact/layout.tsx", "app/site/careers/layout.tsx"]) {
    assert.match(await read(path), /<BreadcrumbJsonLd\s/, `${path} needs breadcrumb schema`);
  }
});

test("sitemap uses canonical public URLs with stable timestamps only", async () => {
  const sitemap = await read("app/sitemap.ts");
  assert.match(sitemap, /const lastModified = new Date\("2026-09-25T00:00:00\.000Z"\)/);
  assert.match(sitemap, /lastModified,/);
  for (const canonical of publicPages.values()) {
    const pathname = new URL(canonical).pathname;
    const route = pathname === "/" ? '""' : `"${pathname}"`;
    assert.ok(sitemap.includes(route), `sitemap is missing ${canonical}`);
  }
  assert.doesNotMatch(sitemap, /"\/site"|"\/login"|"\/jobs"/);
});

test("robots and route metadata separate public marketing pages from the OS", async () => {
  const robots = await read("app/robots.ts");
  const workspace = await read("app/(workspace)/layout.tsx");
  const notFound = await read("app/site/not-found/page.tsx");

  for (const allowed of ["/residential", "/property-porter-services", "/careers"]) {
    assert.ok(robots.includes(`"${allowed}"`));
  }
  for (const blocked of ["/site", "/api/", "/login", "/clients", "/employees", "/jobs", "/payroll-prep", "/settings"]) {
    assert.ok(robots.includes(`"${blocked}"`));
  }
  assert.ok(robots.includes('sitemap: "https://studioscrubz.com/sitemap.xml"'));
  assert.ok(robots.includes('host: "https://studioscrubz.com"'));
  assert.match(workspace, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false,\s*nocache:\s*true/);
  assert.match(notFound, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
});

test("public imagery has alternative text and canonical host routing is preserved", async () => {
  for (const path of ["app/site/page.tsx", "app/site/luxury-property-care/page.tsx", "components/site/ProjectResults.tsx"]) {
    const source = await read(path);
    const images = source.match(/<Image\b[\s\S]*?\/>/g) ?? [];
    assert.ok(images.length > 0, `${path} should contain audited images`);
    for (const image of images) {
      assert.match(image, /\balt=/, `${path} has an Image without alt text`);
    }
  }

  const proxy = await read("proxy.ts");
  assert.ok(proxy.includes('hostname === "www.studioscrubz.com"'));
  assert.ok(proxy.includes("NextResponse.redirect(canonical, 308)"));
  assert.ok(proxy.includes('destination.pathname = pathname === "/" ? "/site" : `/site${pathname}`'));
  assert.ok(proxy.includes("return updateSession(request)"));
});
