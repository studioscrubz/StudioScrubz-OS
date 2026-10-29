import {
  buildVendorCapabilityDocumentModel,
  type CapabilityStatementModel,
} from "./capability";

export function renderCapabilityDocumentEmail(input: { model: CapabilityStatementModel; message: string }) {
  const { model } = input;
  const message = input.message.trim();
  const prepared = [
    `Prepared for: ${model.preparedFor}`,
    ...(model.propertyLabel ? [`Property/Project: ${model.propertyLabel}`] : []),
  ];
  const pointOfContact = pointOfContactLines(model);
  const textSections = [
    [model.title, ...model.overview],
    ["Core Capabilities", ...model.coreCompetencies.flatMap(item => [item.title, ...item.bullets, ...(item.note ? [item.note] : [])])],
    ...(model.process.length ? [["How We Work", ...model.process.map(item => `${item.title}: ${item.copy}`)]] : []),
    ...(model.differentiators.length ? [[model.documentKind === "corporate-capability-statement" ? "Differentiators" : "Why StudioScrubz", ...model.differentiators]] : []),
    ...(model.pastPerformance.length ? [["Past Performance", ...model.pastPerformance]] : []),
    ...(model.serviceAreas.length ? [["Service Areas", ...model.serviceAreas]] : []),
    ...(model.corporateData.length ? [["Corporate Data", ...model.corporateData.map(item => `${item.label}: ${item.value}`)]] : []),
    ...(pointOfContact.length ? [["Point of Contact", ...pointOfContact]] : []),
    ...(model.closing ? [["Next Steps", model.closing]] : []),
  ];
  return {
    text: [message, ...prepared, ...textSections.flat(), model.disclaimer].filter(Boolean).join("\n\n"),
    html: [
      message ? `<div style="white-space:pre-wrap;margin:0 0 24px">${escape(message)}</div>` : "",
      `<div style="border-left:3px solid #D4AF37;padding:2px 0 2px 16px;margin:0 0 24px">${prepared.map(paragraph).join("")}</div>`,
      `<h1 style="font-size:25px;line-height:1.25;color:#143D1A;margin:0 0 14px">${escape(model.title)}</h1>`,
      model.overview.map(paragraph).join(""),
      `<h2 style="font-size:20px;line-height:1.3;color:#143D1A;margin:26px 0 10px">Core Capabilities</h2>`,
      model.coreCompetencies.map(item => `<section style="margin:16px 0"><h3 style="font-size:16px;color:#143D1A;margin:0 0 6px">${escape(item.title)}</h3><ul style="margin:6px 0 8px;padding-left:22px">${item.bullets.map(value => `<li style="margin:3px 0">${escape(value)}</li>`).join("")}</ul>${item.note ? paragraph(item.note) : ""}</section>`).join(""),
      model.process.length ? section("How We Work", `<ol style="margin:6px 0;padding-left:22px">${model.process.map(item => `<li style="margin:8px 0"><strong>${escape(item.title)}:</strong> ${escape(item.copy)}</li>`).join("")}</ol>`) : "",
      model.differentiators.length ? bulletSection(model.documentKind === "corporate-capability-statement" ? "Differentiators" : "Why StudioScrubz", model.differentiators) : "",
      model.pastPerformance.length ? bulletSection("Past Performance", model.pastPerformance) : "",
      model.serviceAreas.length ? section("Service Areas", model.serviceAreas.map(paragraph).join("")) : "",
      model.corporateData.length ? section("Corporate Data", `<dl style="margin:6px 0">${model.corporateData.map(item => `<div style="margin:7px 0"><dt style="display:inline;font-weight:bold">${escape(item.label)}:</dt> <dd style="display:inline;margin:0">${escape(item.value)}</dd></div>`).join("")}</dl>`) : "",
      pointOfContact.length ? section("Point of Contact", pointOfContact.map(paragraph).join("")) : "",
      model.closing ? section("Next Steps", paragraph(model.closing)) : "",
      `<p style="margin:28px 0 0;color:#6b7280;font-size:12px">${escape(model.disclaimer)}</p>`,
    ].join(""),
  };
}

// Kept for existing callers while both vendor document kinds use the shared model renderer.
export function renderPacketEmail(input: {
  clientName: string;
  propertyLabel?: string;
  businessName: string;
  contacts: string[];
  moduleIds: string[];
  message: string;
}) {
  const model = buildVendorCapabilityDocumentModel({
    documentKind: "service-packet",
    clientName: input.clientName,
    propertyLabel: input.propertyLabel,
    business: {
      name: input.businessName,
      phone: input.contacts[0] ?? null,
      email: input.contacts[1] ?? null,
      website: input.contacts[2] ?? null,
    },
    moduleIds: input.moduleIds,
  });
  return renderCapabilityDocumentEmail({ model, message: input.message });
}

function pointOfContactLines(model: CapabilityStatementModel): string[] {
  const namedContact = [model.business.contactName, model.business.contactTitle].filter(Boolean).join(" · ");
  return [namedContact, model.business.phone, model.business.email, model.business.website]
    .filter((value): value is string => Boolean(value?.trim()));
}
function section(title: string, content: string) { return `<section style="margin:26px 0 0"><h2 style="font-size:20px;line-height:1.3;color:#143D1A;margin:0 0 10px">${escape(title)}</h2>${content}</section>`; }
function bulletSection(title: string, values: readonly string[]) { return section(title, `<ul style="margin:6px 0;padding-left:22px">${values.map(value => `<li style="margin:5px 0">${escape(value)}</li>`).join("")}</ul>`); }
function paragraph(value: string) { return `<p style="margin:9px 0">${escape(value).replaceAll("\n", "<br />")}</p>`; }
function escape(value: string) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
