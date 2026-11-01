/**
 * Café outreach metadata is stored as labeled prospect Notes lines so the
 * existing CSV import, signed updates, and PostgreSQL schema stay compatible.
 * Unknown vendor approval is never represented as a confirmed permission.
 */
export const licensedCafeIndustry = "Licensed Starbucks / In-Store Cafés";
export type CafeNoteField = "Host company" | "Facilities decision-maker" | "Outside specialty-cleaning vendors";

export function readCafeNote(notes: string | null | undefined, field: CafeNoteField): string {
  const prefix = field + ":";
  const match = (notes ?? "").split(/\r?\n/).find(line => line.trimStart().startsWith(prefix));
  return match ? match.trimStart().slice(prefix.length).trim() : "";
}

export function updateCafeNote(notes: string | null | undefined, field: CafeNoteField, value: string): string | null {
  const prefix = field + ":";
  const lines = (notes ?? "").split(/\r?\n/);
  const existingIndex = lines.findIndex(line => line.trimStart().startsWith(prefix));
  const nextValue = value.trim();
  // Keep the original line position while preventing duplicate metadata lines.
  const cleaned = lines.filter((line, index) => index === existingIndex || !line.trimStart().startsWith(prefix));
  if (existingIndex >= 0) {
    if (nextValue) cleaned[existingIndex] = prefix + " " + nextValue;
    else cleaned.splice(existingIndex, 1);
  } else if (nextValue) cleaned.push(prefix + " " + nextValue);
  return cleaned.join("\n").trim() || null;
}
