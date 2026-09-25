import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import test from "node:test";
import { buildMarketingMaterialEmailTemplate } from "../lib/marketingMaterials/emailTemplate.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const page = read("components/marketingMaterials/MarketingMaterialsPage.tsx");
const route = read("app/api/marketing-materials/route.ts");
const migration = read("supabase/migrations/20260925131341_marketing_material_deliveries.sql");
const permissions = read("lib/auth/permissions.ts");
const sidebar = read("components/layout/Sidebar.tsx");
const sql = migration.replace(/\s+/g, " ").trim();

test("navigation permits management and Sales but denies field roles", () => {
  for (const role of ["Master Admin", "Administrator", "Manager", "Sales"]) {
    const label = role === "Master Admin" ? '"Master Admin"' : role;
    const section = permissions.match(
      new RegExp(`${label}:[\\s\\S]*?(?:\\n  \\]|\\n  \\})`),
    )?.[0] ?? permissions;
    assert.match(section, /marketingMaterials\.send/);
  }
  for (const role of ["Crew Lead", "Scrub Technician"]) {
    const section = permissions.match(
      new RegExp(`"${role}":[\\s\\S]*?\\n  \\]`),
    )?.[0] ?? "";
    assert.doesNotMatch(section, /marketingMaterials\.send/);
  }
  assert.match(sidebar, /Marketing Materials/);
});

test("catalog is reusable and the initial flyer remains a manual management upload", () => {
  assert.match(migration, /create table public\.marketing_materials/);
  assert.match(migration, /create table public\.marketing_material_versions/);
  assert.doesNotMatch(sql, /values \('property-porter-services', 'Property Porter Services'/);
  assert.doesNotMatch(migration, /550e8400-e29b-41d4-a716-446655440001|System migration/);
  assert.doesNotMatch(route, /ensureInitialAsset|node:fs\/promises|node:path|readFile\(/);
  const asset = new URL("../public/marketing-materials/property-porter-services.png", import.meta.url);
  assert.ok(existsSync(asset));
  assert.ok(statSync(asset).size > 100000);
});

test("all extensible categories are database constrained and exposed to management UI", () => {
  const types = read("types/marketingMaterial.ts");
  for (const category of [
    "Residential Cleaning", "Commercial Offices", "Property Management / Multifamily",
    "Post-Construction", "Airbnb / Short-Term Rentals", "Restaurants / Hospitality",
    "Salons / Barbershops", "Gyms / Spas", "Recording / Production Facilities",
    "Pressure Washing", "Luxury Property Care", "Other",
  ]) {
    const escaped = category.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    assert.match(migration, new RegExp(escaped));
    assert.match(types, new RegExp(escaped));
  }
});

test("private Storage validates immutable assets and separates management writes from staff reads", () => {
  assert.match(sql, /marketing-materials-private.*false, 15728640/);
  for (const mime of ["image/png", "image/jpeg", "image/webp", "application/pdf"]) {
    assert.match(migration, new RegExp(mime.replace("/", "\\/")));
  }
  assert.match(migration, /management upload files/);
  assert.doesNotMatch(migration, /management update files/);
  assert.match(migration, /staff read files/);
  assert.match(sql, /delete unreferenced files.*not exists \( select 1 from public\.marketing_material_versions v where v\.storage_path = name/);
  assert.doesNotMatch(sql, /delete unreferenced files.*marketing_material_deliveries d where d\.storage_path = name/);
  assert.doesNotMatch(migration, /to anon/);
});

test("management can add replace activate deactivate preview and download", () => {
  for (const phrase of ["Manage Materials", "Replace", "Deactivate", "Activate", "Preview", "Download", "Save Version"]) {
    assert.match(page, new RegExp(phrase));
  }
  assert.match(route, /register_marketing_material_version/);
  assert.match(route, /set_marketing_material_active/);
  assert.match(route, /multipart\/form-data/);
});

test("Porter retains its approved specialized copy with the plural opening", () => {
  const template = buildMarketingMaterialEmailTemplate({identifier:"property-porter-services",title:"Property Porter Services",category:"Property Management / Multifamily",description:"Catalog description"});
  assert.equal(template.subject, "Property Porter Services from StudioScrubz");
  assert.match(template.messageBody, /We’re reaching out to introduce StudioScrubz Property Porter Services—reliable, ongoing support/);
  assert.doesNotMatch(template.messageBody, /I’m reaching out/);
  assert.match(template.messageBody, /routine property checks, common-area upkeep, light cleaning, photo documentation, and maintenance issue reporting/);
});

test("generic defaults use exact metadata for Post-Construction and another category", () => {
  for (const material of [
    {identifier:"post-construction-cleaning",title:"Post-Construction Cleaning",category:"Post-Construction",description:"Detailed turnover cleaning after construction."},
    {identifier:"restaurant-care",title:"Restaurant Care",category:"Restaurants / Hospitality",description:"Reliable dining and back-of-house cleaning."},
  ]) {
    const template = buildMarketingMaterialEmailTemplate(material);
    assert.equal(template.subject, `${material.title} from StudioScrubz`);
    assert.match(template.messageBody, new RegExp(`StudioScrubz ${material.title}—professional, reliable service`));
    assert.ok(template.messageBody.includes(material.description));
    assert.doesNotMatch(template.messageBody, /I’m reaching out/);
  }
});

test("future custom materials work without template code changes", () => {
  const template = buildMarketingMaterialEmailTemplate({identifier:"future-custom-flyer",title:"Future Custom Care",category:"Other",description:"A newly uploaded custom service description."});
  assert.equal(template.subject, "Future Custom Care from StudioScrubz");
  assert.match(template.messageBody, /A newly uploaded custom service description\./);
  assert.match(template.messageBody, /custom service plan for your property or business/);
  assert.match(template.messageBody, /747-365-6265\ninfo@studioscrubz\.com\nStudioScrubz\.com/);
});

test("manual edits persist until selecting a different material", () => {
  const first={identifier:"office-care",title:"Office Care",category:"Commercial Offices",description:"Office description."};
  const second={identifier:"luxury-care",title:"Luxury Care",category:"Luxury Property Care",description:"Luxury description."};
  let draft={material:first,...buildMarketingMaterialEmailTemplate(first)};
  draft={...draft,subject:"Sender-edited subject",messageBody:"Sender-edited body"};
  assert.equal(draft.subject,"Sender-edited subject");
  assert.equal(draft.messageBody,"Sender-edited body");
  draft={material:second,...buildMarketingMaterialEmailTemplate(second)};
  assert.equal(draft.subject,"Luxury Care from StudioScrubz");
  assert.match(draft.messageBody,/Luxury description\./);
  assert.doesNotMatch(draft.messageBody,/Sender-edited/);
  assert.match(page, /function compose\(material:MarketingMaterialCatalogItem\)\{const template=buildMarketingMaterialEmailTemplate\(material\)/);
  assert.match(page, /value=\{draft\.subject\} set=\{v=>setDraft\(\{\.\.\.draft,subject:v\}\)\}/);
  assert.match(page, /value=\{draft\.messageBody\} onChange=\{e=>setDraft\(\{\.\.\.draft,messageBody:e\.target\.value\}\)\}/);
});

test("versions are immutable and delivery snapshots exact version and path", () => {
  assert.match(sql, /unique \(material_identifier, version\)/);
  assert.match(sql, /material_version_id uuid not null references public\.marketing_material_versions\(id\)/);
  assert.match(sql, /storage_path text not null/);
  assert.match(route, /download\(delivery\.storage_path\)/);
  assert.match(route, /idempotencyKey:`marketing-material:\$\{delivery\.id\}`/);
  assert.doesNotMatch(route, /getPublicSiteUrl/);
});

test("RLS gives Sales active catalog and own history while management sees all", () => {
  assert.match(migration, /Marketing materials staff read/);
  assert.match(sql, /is_active or public\.has_any_role/);
  assert.match(migration, /Marketing delivery Sales own read/);
  assert.match(sql, /public\.has_role\('Sales'\) and sent_by_user_id = auth\.uid\(\)/);
  assert.match(migration, /Marketing delivery management read/);
  assert.match(route, /session\.from\("marketing_material_deliveries"\)/);
  assert.doesNotMatch(route, /createSupabaseAdminClient\(\)\.from\("marketing_material_deliveries"\)/);
});

test("management RPCs and Sales delivery RPCs are hardened and ownership-scoped", () => {
  assert.ok((migration.match(/security definer/g) ?? []).length >= 5);
  assert.ok((migration.match(/set search_path = ''/g) ?? []).length >= 5);
  assert.match(sql, /not management and d\.sent_by_user_id <> auth\.uid\(\)/);
  assert.match(sql, /revoke all on function/);
  assert.match(sql, /from public, anon, authenticated/);
  assert.match(sql, /to authenticated/);
});

test("version registration has the exact unfused PostgreSQL signature", () => {
  assert.match(sql, /create function public\.register_marketing_material_version\( p_identifier text, p_title text, p_description text, p_category text, p_internal_notes text, p_version_id uuid, p_storage_path text, p_original_filename text, p_media_type text, p_size_bytes bigint \) returns jsonb/);
  assert.doesNotMatch(migration, /p_version_iduuid|p_[a-z0-9_]+(?:uuid|text|boolean|bigint|integer)\b/);
});

test("all PL/pgSQL bodies use terminated tagged dollar quotes", () => {
  assert.doesNotMatch(migration, /as\s*\$\$|do\s*\$\$|end\s*\$\$/i);
  assert.doesNotMatch(migration, /as\$\$|do\$\$|end\$\$/i);
  const functionCount = (migration.match(/create function public\./g) ?? []).length;
  const openingCount = (migration.match(/as \$function\$/g) ?? []).length;
  const closingCount = (migration.match(/\n\$function\$;/g) ?? []).length;
  const terminatedBodies = (migration.match(/\nend;\n\$function\$;/g) ?? []).length;
  assert.equal(functionCount, 6);
  assert.equal(openingCount, functionCount);
  assert.equal(closingCount, functionCount);
  assert.equal(terminatedBodies, functionCount);
  assert.equal((migration.match(/\$function\$/g) ?? []).length % 2, 0);
});

test("client linkage prospects rate limits transitions and retries remain intact", () => {
  assert.match(sql, /insert into public\.client_communications/);
  assert.match(sql, /p_recipient_kind = 'Existing Client'/);
  assert.match(migration, /New Prospect/);
  assert.doesNotMatch(route, /from\("clients"\)\.insert|createClient/);
  assert.match(sql, />= 20/);
  for (const status of ["Prepared", "Sent", "Failed"]) assert.match(migration, new RegExp(status));
  assert.match(sql, /attempt_count = attempt_count \+ 1/);
  assert.match(migration, /Wait before retrying/);
});

test("Sent transitions require a nonblank provider message identifier", () => {
  assert.match(sql, /p_status = 'Sent' and nullif\(btrim\(p_provider_message_id\), ''\) is null then raise exception 'Provider message ID is required for a sent delivery\.'/);
  assert.match(route, /p_status:"Sent",p_provider_message_id:sent\.id/);
});

test("secrets stay server-only and accepted files are bounded on both layers", () => {
  assert.match(route, /import "server-only"/);
  assert.match(route, /MAX=15\*1024\*1024/);
  assert.match(route, /MIMES=new Set/);
  assert.doesNotMatch(page, /SUPABASE_SERVICE_ROLE_KEY|RESEND_API_KEY|donotreply@studioscrubz\.com/);
  assert.match(route, /attachments:\[\{filename:delivery\.original_filename,content,contentType:delivery\.media_type\}\]/);
});
