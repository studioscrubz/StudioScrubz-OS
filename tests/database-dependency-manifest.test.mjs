import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = fs.readFileSync(path.join(root, "docs/database-dependency-manifest.md"), "utf8");
const sourceRoots = ["app", "components", "lib"];

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? files(target) : [target];
  });
}

const source = sourceRoots
  .flatMap((directory) => files(path.join(root, directory)))
  .filter((file) => /\.(?:js|mjs|ts|tsx)$/.test(file))
  .map((file) => fs.readFileSync(file, "utf8"))
  .join("\n");

function references(pattern) {
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

test("manifest inventories every statically named application RPC", () => {
  for (const name of new Set(references(/\.rpc\(\s*["'`]([^"'`]+)["'`]/g))) {
    assert.match(manifest, new RegExp(`\\b${name}\\b`), `RPC missing from manifest: ${name}`);
  }
});

test("manifest inventories every statically named Data API relation", () => {
  for (const name of new Set(references(/\.from\(\s*["'`]([^"'`]+)["'`]/g))) {
    assert.match(manifest, new RegExp(`\\b${name}\\b`), `relation missing from manifest: ${name}`);
  }
});

test("manifest records the known missing view and both Storage buckets", () => {
  assert.match(manifest, /employee_directory_company_safe[^\n]*Missing entirely/);
  assert.match(manifest, /operational-photos/);
  assert.match(manifest, /agreement-documents/);
});
