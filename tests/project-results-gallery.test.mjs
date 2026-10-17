import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "components/site/ProjectResults.tsx"), "utf8");

test("project gallery keeps all eight existing photos and alt text", () => {
  const gallery = source.match(/const projectPhotos = \[([\s\S]*?)\] as const;/)?.[1] ?? "";
  assert.equal((gallery.match(/^\s*\["/gm) ?? []).length, 8);
  assert.match(gallery, /bathroom-vanity\.webp/);
  assert.match(gallery, /bathroom-tub\.webp/);
});

test("project gallery uses a consistent responsive 4:5 layout", () => {
  assert.match(source, /max-w-6xl grid-cols-2/);
  assert.match(source, /lg:grid-cols-4/);
  assert.match(source, /className="group relative aspect-\[4\/5\]/);
  assert.doesNotMatch(source, /lg:row-span-2/);
  assert.doesNotMatch(source, /index === 2 \|\| index === 5/);
});

test("project gallery images retain optimized lazy loading and restrained motion", () => {
  assert.match(source, /fill\s+loading="lazy"/);
  assert.match(source, /sizes="\(min-width: 1280px\) 272px/);
  assert.match(source, /object-cover/);
  assert.match(source, /group-hover:scale-\[1\.015\]/);
  assert.match(source, /motion-reduce:transition-none/);
});
