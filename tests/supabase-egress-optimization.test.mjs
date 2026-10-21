import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const marketingPage = read("components/marketingMaterials/MarketingMaterialsPage.tsx");
const marketingRoute = read("app/api/marketing-materials/route.ts");
const auth = read("lib/services/auth.ts");
const authProvider = read("components/auth/AuthProvider.tsx");
const users = read("lib/services/users.ts");
const realtime = read("components/realtime/OperationalRealtimeProvider.tsx");
const attention = read("components/attention/useAttentionRefresh.ts");
const discovery = read("app/api/prospects/discover/route.ts");

test("marketing catalog metadata does not create or load private originals", () => {
  assert.match(marketingRoute, /if\(assetIdentifier\)\{/);
  assert.match(marketingRoute, /createSignedUrl\(version\.data\.storage_path,3600/);
  assert.match(marketingRoute, /Cache-Control":"private, no-store/);
  assert.match(marketingRoute, /catalog\.push\(\{\.\.\.material,current,preview_url:`\$\{assetBase\}&mode=preview`,download_url:`\$\{assetBase\}&mode=download`\}\)/);
  assert.doesNotMatch(marketingRoute, /createSignedUrl\(current\.storage_path/);
  assert.match(marketingPage, /if\(!full\)return <div/);
  assert.match(marketingPage, /Use Preview to load the original asset/);
});

test("explicit assets remain authorized, private, immutable, and downloadable", () => {
  assert.match(marketingRoute, /const\{session,canManage\}=await authorized\(\)/);
  assert.match(marketingRoute, /if\(!material\.data\.is_active&&!canManage\)throw forbidden\(\)/);
  assert.match(marketingRoute, /assetMode==="download"\?\{download:version\.data\.original_filename\}:undefined/);
  assert.match(marketingRoute, /cacheControl:"31536000"/);
  assert.match(marketingRoute, /download\(delivery\.storage_path\)/);
  assert.doesNotMatch(marketingRoute, /getPublicUrl|publicUrl/);
});

test("identity requests share in-flight work and invalidate on auth and role changes", () => {
  assert.match(auth, /const USER_CACHE_MS = 15_000/);
  assert.match(auth, /const PROFILE_CACHE_MS = 30_000/);
  assert.match(auth, /if \(userRequest\) return userRequest/);
  assert.match(auth, /if \(profileRequest\?\.userId === id\) return profileRequest\.promise/);
  assert.match(authProvider, /table: "user_profiles", filter: `id=eq\.\$\{userId\}`/);
  assert.match(authProvider, /invalidateAuthIdentityCache\(\)/);
  assert.ok((users.match(/invalidateAuthIdentityCache\(\)/g) ?? []).length >= 3);
});

test("realtime subscribes only to tables requested by mounted consumers", () => {
  assert.match(realtime, /const activeTables = useMemo/);
  assert.match(realtime, /for \(const table of activeTables\)/);
  assert.doesNotMatch(realtime, /for \(const table of OPERATIONAL_TABLES\)/);
  assert.match(realtime, /return \(\) => \{ void client\.removeChannel\(channel\); \}/);
});

test("attention keeps realtime immediacy with a five-minute fallback", () => {
  assert.match(attention, /useOperationalRealtime/);
  assert.match(attention, /5 \* 60_000/);
  assert.match(attention, /document\.visibilityState !== "visible"/);
  assert.match(attention, /visibilitychange/);
  assert.doesNotMatch(attention, /\}, 60_000\)/);
});

test("routine discovery success diagnostics no longer ingest logs", () => {
  assert.doesNotMatch(discovery, /console\.info\("Prospect discovery provider diagnostics"/);
  assert.match(discovery, /console\.error\("Prospect discovery provider failed"/);
});
