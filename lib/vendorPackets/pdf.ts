import type { CapabilityStatementModel } from "./capability";

// Dependency-free, server-side US Letter PDF generation. Values come only from
// the immutable, validated service-packet snapshot, never from the request body.
const W = 612;
const H = 792;
const LEFT = 48;
const RIGHT = 564;
const GREEN = "0.078 0.239 0.102";
const GOLD = "0.831 0.686 0.216";
const DARK = "0.16 0.19 0.16";

function pdfText(value: string): string {
  return value.normalize("NFKD").replace(/[^\x20-\x7e]/g, "-")
    .replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
function wrap(text: string, size: number, width = RIGHT - LEFT): string[] {
  const max = Math.max(18, Math.floor(width / (size * 0.52)));
  const result: string[] = [];
  for (const paragraph of text.split(/\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && (line + " " + word).length > max) {
        result.push(line);
        line = "";
      }
      if (word.length > max) {
        if (line) { result.push(line); line = ""; }
        for (let i = 0; i < word.length; i += max) result.push(word.slice(i, i + max));
      } else line += (line ? " " : "") + word;
    }
    result.push(line);
  }
  return result;
}

export function generateServiceCapabilityPacketPdf(model: CapabilityStatementModel): Buffer {
  if (model.documentKind !== "service-packet") throw new Error("PDF attachment requires a service packet.");
  const pages: string[][] = [];
  let commands: string[] = [];
  let y = H - 112;

  function newPage() {
    if (commands.length) pages.push(commands);
    commands = [
      `q ${GREEN} rg 0 728 612 64 re f Q`,
      `BT /F2 19 Tf 1 1 1 rg 48 754 Td (STUDIOSCRUBZ) Tj ET`,
      `BT /F1 9 Tf 1 1 1 rg 48 738 Td (SERVICE CAPABILITY PACKET) Tj ET`,
      `q ${GOLD} rg 48 719 516 3 re f Q`,
    ];
    y = H - 112;
  }
  function lines(value: string, size = 10, bold = false, color = DARK, indent = 0, gap = 4) {
    for (const line of wrap(value, size, RIGHT - LEFT - indent)) {
      if (y < 68) newPage();
      if (line) commands.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${color} rg ${LEFT + indent} ${y.toFixed(2)} Td (${pdfText(line)}) Tj ET`);
      y -= size * 1.35 + gap;
    }
  }
  function heading(value: string) {
    y -= 8;
    if (y < 92) newPage();
    lines(value.toUpperCase(), 12, true, GREEN, 0, 5);
  }
  newPage();
  lines(model.title, 17, true, GREEN, 0, 6);
  lines(`Prepared for: ${model.preparedFor}`, 10, true);
  if (model.propertyLabel) lines(`Property / project: ${model.propertyLabel}`);
  y -= 8;
  for (const p of model.overview) lines(p);
  heading("Core capabilities");
  for (const item of model.coreCompetencies) {
    y -= 4;
    lines(item.title, 11, true, GREEN);
    for (const bullet of item.bullets) lines(`- ${bullet}`, 9.5, false, DARK, 10, 2);
    if (item.note) lines(item.note, 9.5, false, DARK, 10, 2);
  }
  if (model.process.length) {
    heading("How we work");
    for (const p of model.process) lines(`${p.title}: ${p.copy}`);
  }
  if (model.differentiators.length) {
    heading("Why StudioScrubz");
    for (const line of model.differentiators) lines(`- ${line}`);
  }
  if (model.pastPerformance.length) {
    heading("Past performance");
    for (const line of model.pastPerformance) lines(`- ${line}`);
  }
  if (model.serviceAreas.length) {
    heading("Service areas");
    for (const line of model.serviceAreas) lines(line);
  }
  if (model.closing) { heading("Next steps"); lines(model.closing); }
  heading("Contact");
  for (const line of [model.business.name, model.business.phone, model.business.email, model.business.website, model.business.address]) {
    if (line) lines(line);
  }
  lines(model.disclaimer, 8, false, DARK);
  pages.push(commands);

  const objects: string[] = [];
  function object(body: string): number { objects.push(body); return objects.length; }
  const catalog = object("");
  const rootPages = object("");
  const regular = object("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const bold = object("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const pageIds: number[] = [];
  pages.forEach((pageCommands, index) => {
    const footer = `BT /F1 8 Tf ${DARK} rg 48 34 Td (StudioScrubz  |  Page ${index + 1} of ${pages.length}) Tj ET`;
    const stream = [...pageCommands, footer].join("\n") + "\n";
    const bytes = Buffer.byteLength(stream, "ascii");
    const contentId = object(`<< /Length ${bytes} >>\nstream\n${stream}endstream`);
    pageIds.push(object(`<< /Type /Page /Parent ${rootPages} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${contentId} 0 R >>`));
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${rootPages} 0 R >>`;
  objects[rootPages - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
}
