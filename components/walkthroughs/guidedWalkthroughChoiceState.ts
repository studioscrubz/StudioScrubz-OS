export function nextGuidedWalkthroughSelection(
  selected: readonly string[],
  option: string,
  multiple: boolean,
): string[] {
  if (!multiple) return [option];
  return selected.includes(option)
    ? selected.filter((value) => value !== option)
    : [...selected, option];
}
