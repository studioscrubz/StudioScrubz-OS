import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function evaluateTypeScript(path, dependencies = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(read(path), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    Buffer,
    require: id => {
      if (Object.hasOwn(dependencies, id)) return dependencies[id];
      throw new Error(`Unexpected import ${id} from ${path}`);
    },
  });
  return module.exports;
}

const content = evaluateTypeScript("lib/vendorPackets/content.ts");
const capability = evaluateTypeScript("lib/vendorPackets/capability.ts", { "./content": content });
const email = evaluateTypeScript("lib/vendorPackets/email.ts", { "./capability": capability });
const pdf = evaluateTypeScript("lib/vendorPackets/pdf.ts");
const migration = read("supabase/migrations/20261029090000_corporate_capability_profile.sql");
const route = read("app/api/vendor-packets/send/route.ts");

const emptyProfile = () => ({
  version: 1,
  overview: "",
  differentiators: [],
  pastPerformance: [],
  naicsCodes: [],
  certifications: [],
  uei: "",
  cageCode: "",
  serviceAreas: "",
  contactName: "",
  contactTitle: "",
});

const baseInput = profile => ({
  documentKind: "corporate-capability-statement",
  clientName: "LJ Facility Services LLC",
  propertyLabel: "Starbucks #20227",
  business: {
    name: "StudioScrubz",
    tagline: "No Mess. No Stress.",
    email: "info@studioscrubz.com",
    phone: "(747) 365-6265",
    website: "www.studioscrubz.com",
    address: "20353 Saticoy St., Winnetka, CA 91306",
  },
  corporateProfile: profile,
  moduleIds: ["commercial", "property-management"],
});

test("corporate statement omits empty and unverified identifiers and claims", () => {
  const empty = capability.buildVendorCapabilityDocumentModel(baseInput(emptyProfile()));
  assert.equal(empty.documentKind, "corporate-capability-statement");
  assert.equal(empty.documentVersion, "corporate-capability-statement-v1");
  assert.equal(empty.corporateData.length, 0);
  assert.equal(empty.pastPerformance.length, 0);
  assert.equal(empty.serviceAreas.length, 0);
  assert.equal(empty.business.contactName, null);
  assert.equal(empty.business.contactTitle, null);

  const invalidVersion = capability.buildVendorCapabilityDocumentModel(baseInput({
    ...emptyProfile(),
    version: 99,
    uei: "UNVERIFIED12",
    cageCode: "BAD99",
    certifications: ["Unverified claim"],
  }));
  assert.equal(invalidVersion.corporateData.length, 0);
  const rendered = email.renderCapabilityDocumentEmail({ model: empty, message: "Please review." });
  assert.doesNotMatch(rendered.html, /Unique Entity ID|CAGE Code|NAICS Codes|Certifications|Past Performance/);
});

test("configured corporate facts are preserved in the model, snapshot, and email", () => {
  const profile = {
    ...emptyProfile(),
    overview: "Commercial cleaning and property-service support for managed facilities.",
    differentiators: ["Documented completion", "Equipment-conscious service"],
    pastPerformance: ["Verified facility reference available on request"],
    naicsCodes: ["561720", "561790"],
    certifications: ["Verified small-business certification"],
    uei: "ABC123DEF456",
    cageCode: "1A2B3",
    serviceAreas: "Greater Los Angeles",
    contactName: "Capability Desk",
    contactTitle: "Vendor Relations",
  };
  const model = capability.buildVendorCapabilityDocumentModel(baseInput(profile));
  assert.equal(model.overview[0], profile.overview);
  assert.equal(model.differentiators.join("|"), profile.differentiators.join("|"));
  assert.equal(model.pastPerformance[0], profile.pastPerformance[0]);
  assert.equal(model.serviceAreas[0], profile.serviceAreas);
  assert.equal(model.business.contactName, profile.contactName);
  assert.equal(model.corporateData.find(item => item.label === "Unique Entity ID (UEI)")?.value, profile.uei);
  assert.equal(model.corporateData.find(item => item.label === "CAGE Code")?.value, profile.cageCode);
  assert.equal(model.corporateData.find(item => item.label === "NAICS Codes")?.value, "561720, 561790");
  assert.equal(model.contentSnapshot.corporateData.length, model.corporateData.length);
  assert.ok(Object.isFrozen(model.contentSnapshot));
  assert.ok(Object.isFrozen(model.contentSnapshot.corporateData));

  const rendered = email.renderCapabilityDocumentEmail({ model, message: "Please review the attached qualifications." });
  for (const fact of [profile.uei, profile.cageCode, ...profile.naicsCodes, ...profile.certifications, ...profile.pastPerformance]) {
    assert.ok(rendered.text.includes(fact), `missing text fact: ${fact}`);
    assert.ok(rendered.html.includes(fact), `missing HTML fact: ${fact}`);
  }
});

test("email renderer escapes unsafe profile, recipient, property, and message values", () => {
  const profile = {
    ...emptyProfile(),
    overview: '<img src=x onerror="alert(1)"> & overview',
    differentiators: ["Safe <b>claim</b> & proof"],
    serviceAreas: "Los Angeles <script>alert(2)</script>",
    contactName: "<Admin>",
  };
  const model = capability.buildVendorCapabilityDocumentModel({
    ...baseInput(profile),
    clientName: "Client <script>alert(3)</script>",
    propertyLabel: "Site <svg onload=alert(4)>",
  });
  const rendered = email.renderCapabilityDocumentEmail({
    model,
    message: "Hello <iframe src=javascript:alert(5)></iframe> & welcome",
  });
  assert.doesNotMatch(rendered.html, /<(?:script|img|svg|iframe|b)(?:\s|>)/i);
  assert.match(rendered.html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; overview/);
  assert.match(rendered.html, /Client &lt;script&gt;alert\(3\)&lt;\/script&gt;/);
  assert.match(rendered.html, /Hello &lt;iframe src=javascript:alert\(5\)&gt;&lt;\/iframe&gt; &amp; welcome/);
});

test("corporate statements enforce four modules while service packets retain the full catalog", () => {
  const ids = content.modules.map(module => module.id);
  assert.throws(
    () => capability.buildVendorCapabilityDocumentModel({ ...baseInput(emptyProfile()), moduleIds: ids.slice(0, 5) }),
    /no more than 4 capability modules/i,
  );

  const corporateStatement = capability.buildVendorCapabilityDocumentModel(baseInput(emptyProfile()));
  assert.ok(corporateStatement.coreCompetencies.every(item => item.bullets.length <= 5));
  assert.ok(corporateStatement.coreCompetencies.every(item => item.note === null));
  assert.equal(corporateStatement.coreCompetencies[0].bullets.length, 5);

  const servicePacket = capability.buildVendorCapabilityDocumentModel({
    ...baseInput(null),
    documentKind: "service-packet",
    moduleIds: ids,
  });
  assert.equal(servicePacket.documentKind, "service-packet");
  assert.equal(servicePacket.documentVersion, "service-packet-v1");
  assert.equal(servicePacket.coreCompetencies.length, ids.length);
  assert.equal(servicePacket.process.length, content.process.length);
  assert.ok(servicePacket.closing);
  assert.ok(servicePacket.coreCompetencies.every(item => item.note));
  assert.equal(servicePacket.coreCompetencies[0].bullets.length, content.modules[0].bullets.length);

  const legacy = email.renderPacketEmail({
    clientName: "Existing Client",
    propertyLabel: "Existing Property",
    businessName: "StudioScrubz",
    contacts: ["(747) 365-6265", "info@studioscrubz.com", "www.studioscrubz.com"],
    moduleIds: ids,
    message: "Existing packet message",
  });
  assert.match(legacy.text, /Professional Cleaning & Property Service Capabilities/);
  assert.match(legacy.html, /Existing Client/);
});

test("profile migration keeps the fact store narrow, validated, and role scoped", () => {
  assert.match(migration, /add column corporate_capability_profile jsonb not null default/);
  assert.match(migration, /octet_length\(p_profile::text\) > 32768/);
  assert.match(migration, /UEI must contain exactly 12 letters or numbers/);
  assert.match(migration, /CAGE code must contain exactly 5 letters or numbers/);
  assert.match(migration, /jsonb_array_length\(p_profile->'differentiators'\) > 12/);
  assert.match(migration, /create trigger business_settings_normalize_corporate_capability_profile/);
  assert.match(migration, /has_any_role\(array\['Master Admin', 'Administrator', 'Sales'\]\)/);
  assert.match(migration, /not public\.is_master_admin\(\)/);
  assert.match(migration, /revoke all on function public\.validate_corporate_capability_profile\(jsonb\) from public, anon, authenticated/);
  assert.match(migration, /revoke all on function public\.normalize_corporate_capability_profile\(\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.get_corporate_capability_profile\(\) to authenticated/);
  assert.match(migration, /grant execute on function public\.save_corporate_capability_profile\(jsonb\) to authenticated/);
  assert.doesNotMatch(migration, /create or replace view public\.business_settings_(?:public|workflow)/);
  assert.doesNotMatch(migration, /grant [^;]+ on (?:table )?public\.business_settings/i);
});

test("send route authorizes active document senders and rebuilds content from authoritative records", () => {
  assert.match(route, /if \(!auth\.user\).*status: 401/);
  assert.match(route, /!profile\?\.is_active/);
  assert.match(route, /\["Sales", "Administrator", "Master Admin"\]\.includes\(profile\.role\)/);
  assert.match(route, /hasPermission\(profile, "estimates\.create"\)/);
  assert.match(route, /hasPermission\(profile, "communications\.create"\)/);
  assert.match(route, /admin\.from\("clients"\)[\s\S]*?\.eq\("id", identity\.clientId\)[\s\S]*?\.is\("archived_at", null\)/);
  assert.match(route, /admin\.from\("properties"\)[\s\S]*?\.eq\("id", identity\.propertyId\)[\s\S]*?\.eq\("client_id", identity\.clientId\)[\s\S]*?\.is\("archived_at", null\)/);
  assert.match(route, /admin\.from\("business_settings"\)[\s\S]*?corporate_capability_profile/);
  assert.match(route, /validateCorporateCapabilityProfile\(business\.corporate_capability_profile\)/);
  assert.match(route, /buildVendorCapabilityDocumentModel\(\{[\s\S]*?clientName:[\s\S]*?propertyLabel,[\s\S]*?business:[\s\S]*?corporateProfile,[\s\S]*?moduleIds: identity\.documentKind === "both"/);
  assert.doesNotMatch(route, /body\.(?:corporateProfile|business|clientName|propertyLabel)/);
});

test("send route journals Prepared delivery and provider acceptance before finalizing Sent", () => {
  assert.match(route, /const eventKey = `vendor-document:\$\{profile\.id\}:\$\{requestId\}`/);
  assert.match(route, /status: "Prepared"/);
  assert.match(route, /request_fingerprint: identity\.fingerprint/);
  assert.match(route, /assertSameRequest\(communication, identity, eventKey\)/);
  assert.match(route, /sendResendEmail\(\{[\s\S]*?idempotencyKey: eventKey/);
  assert.match(route, /confirmedProviderMessageId\(sent\.id\)/);
  assert.match(route, /UUID_PATTERN\.test\(value\.trim\(\)\)/);
  assert.match(route, /communications_email_provider_submissions/);
  assert.match(route, /persistProviderSubmission\(admin, communicationId, eventKey, providerMessageId\)/);
  assert.match(route, /finalize\(admin, communicationId, providerMessageId, null\)/);
  assert.ok(route.indexOf('status: "Prepared"') < route.indexOf("sendResendEmail({"), "Prepared row must precede provider submission");
  assert.ok(route.indexOf("await persistProviderSubmission") < route.lastIndexOf("await finalize(admin, communicationId, providerMessageId, null)"), "durable receipt must precede Sent finalization");
  assert.match(route, /status: sent \? "Sent" : "Failed"/);
  assert.match(route, /provider_message_id: sent \? providerMessageId!\.trim\(\) : null/);
});

test("send route recovers provider receipts without resending and snapshots exact document content", () => {
  assert.match(route, /findProviderSubmission\(admin, communicationId, eventKey\)/);
  assert.match(route, /if \(recoveredSubmission\)[\s\S]*?finalize\(admin, communicationId, providerMessageId, null\)[\s\S]*?recovered: true/);
  assert.match(route, /marked Sent, but no matching durable email provider receipt exists/);
  assert.match(route, /Retry this same send request to recover it without sending a duplicate/);
  assert.match(route, /createError\?\.code === "23505"/);
  assert.match(route, /content_snapshot: model\.contentSnapshot/);
  assert.match(route, /document_kind: identity\.documentKind/);
  assert.match(route, /document_version: model\.documentVersion/);
  assert.match(route, /selected_module_ids: \[\.\.\.model\.selectedModuleIds\]|selected_module_ids: \[\.\.\.identity\.moduleIds\]/);
  assert.match(route, /Corporate Capability Statement Sent/);
  assert.match(route, /Vendor Packet Sent/);
  assert.match(route, /capabilityModelFromSnapshot\(metadata\.content_snapshot\)/);
  assert.match(route, /model\.documentKind !== \(identity\.documentKind === "both"/);
  assert.match(route, /!sameStringArray\(model\.selectedModuleIds, identity\.documentKind === "both"/);
  assert.match(route, /resolveEmailSenderProfile\("vendor"\)/);
});

test("combined send generates a genuine US Letter PDF attachment with branded pagination", () => {
  const model = capability.buildVendorCapabilityDocumentModel({
    ...baseInput(emptyProfile()),
    documentKind: "service-packet",
    moduleIds: content.modules.map(item => item.id),
  });
  const bytes = pdf.generateServiceCapabilityPacketPdf(model);
  assert.ok(Buffer.isBuffer(bytes));
  assert.equal(bytes.subarray(0, 8).toString(), "%PDF-1.4");
  assert.match(bytes.toString("latin1"), /\/MediaBox \[0 0 612 792\]/);
  assert.match(bytes.toString("latin1"), /SERVICE CAPABILITY PACKET/);
  assert.match(bytes.toString("latin1"), /Core capabilities/i);
  assert.match(bytes.toString("latin1"), /\/Count [1-9][0-9]* >>/);
  assert.throws(() => pdf.generateServiceCapabilityPacketPdf(capability.buildVendorCapabilityDocumentModel(baseInput(emptyProfile()))), /service packet/i);
});

test("combined send uses server-authoritative snapshots and one idempotent communication", () => {
  const ui = read("components/vendorPackets/VendorPacketsPage.tsx");
  assert.match(ui, /Send Both Documents/);
  assert.match(ui, /emailDraft\.sendBoth \? "both" : emailDraft\.kind/);
  assert.match(route, /documentKind === "both" \? "service-packet" : documentKind/);
  assert.match(route, /attachment_content_snapshot: packetModel\.contentSnapshot/);
  assert.match(route, /packetFromCommunication\(communication, identity\)/);
  assert.match(route, /generateServiceCapabilityPacketPdf\(/);
  assert.match(route, /contentType: "application\/pdf"/);
  assert.match(route, /attachments,/);
  assert.match(route, /idempotencyKey: eventKey/);
  assert.match(route, /status: "Prepared"/);
});
