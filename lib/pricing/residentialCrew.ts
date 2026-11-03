/**
 * Staffing is a scheduling recommendation, not a labor-cost multiplier.
 * Cleaner-hours are set by scope; crew count changes only expected onsite duration.
 */
export function recommendResidentialCrew(
  laborHours: number,
  requestedWindowHours: number | null | undefined = 4.5,
  crewOverride: number | null | undefined = null,
): number {
  if (!Number.isFinite(laborHours) || laborHours <= 0) return 1;
  const window = Number.isFinite(requestedWindowHours) && (requestedWindowHours ?? 0) >= 1
    ? Math.min(12, requestedWindowHours!)
    : 4.5;
  const autoCrew = Math.max(1, Math.ceil(laborHours / window));
  return Number.isInteger(crewOverride) && crewOverride! >= 1 && crewOverride! <= 12
    ? crewOverride!
    : autoCrew;
}
