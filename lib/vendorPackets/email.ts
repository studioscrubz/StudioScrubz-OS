import { modules, intro, about, process, strengths, cta, disclaimer } from "./content";

const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

export function renderPacketEmail(input: { clientName: string; propertyLabel?: string; businessName: string; contacts: string[]; moduleIds: string[]; message: string }) {
  const chosen = modules.filter(item => input.moduleIds.includes(item.id));
  const sections = [
    { title: "Professional Cleaning & Property Service Capabilities", paragraphs: intro },
    { title: "About StudioScrubz", paragraphs: about },
    ...chosen.map(item => ({ title: item.title, paragraphs: [...item.bullets, ...(item.note ? [item.note] : [])] })),
    { title: "How We Work", paragraphs: process.map(item => `${item.title}: ${item.copy}`) },
    { title: "Why StudioScrubz", paragraphs: strengths.map(item => `${item.title}: ${item.copy}`) },
    { title: "Let's Build the Right Service Plan", paragraphs: [cta, input.businessName, ...input.contacts, disclaimer] },
  ];
  const prepared = [`Prepared for: ${input.clientName}`, ...(input.propertyLabel ? [`Property/Project: ${input.propertyLabel}`] : [])];
  const p = (text: string) => `<p style="margin:10px 0">${escape(text).replaceAll("\n", "<br />")}</p>`;
  return {
    text: ["StudioScrubz", "No mess. No stress.", input.message, ...prepared, ...sections.flatMap(section => [section.title, ...section.paragraphs])].join("\n\n"),
    html: `<html><body style="margin:0;background:#f7f8f5"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:white;font-family:Arial,sans-serif;color:#202820;line-height:1.6"><tr><td style="padding:28px;border-top:5px solid #D4AF37"><h1 style="color:#143D1A;margin:0">StudioScrubz</h1><p style="color:#143D1A">No mess. No stress.</p>${p(input.message)}<div style="border-left:3px solid #D4AF37;padding-left:16px">${prepared.map(p).join("")}</div>${sections.map(section => `<h2 style="font-size:20px;color:#143D1A;margin:28px 0 12px">${escape(section.title)}</h2>${section.paragraphs.map(p).join("")}`).join("")}</td></tr></table></td></tr></table></body></html>`,
  };
}
