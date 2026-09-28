"use client";

import { nextGuidedWalkthroughSelection } from "@/components/walkthroughs/guidedWalkthroughChoiceState";

type Props = {
  label: string;
  options: readonly string[];
  selected: readonly string[];
  multiple?: boolean;
  onSelect: (option: string, nextSelected: readonly string[]) => void;
  className?: string;
};

export function GuidedWalkthroughChoice({
  label,
  options,
  selected,
  multiple = false,
  onSelect,
  className = "",
}: Props) {
  return (
    <fieldset className={className}>
      <legend className="text-sm font-bold">{label}</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const isSelected = selected.includes(option);

          return (
            <button
              key={option}
              type="button"
              aria-pressed={isSelected}
              aria-label={`${option}${isSelected ? ", selected" : ""}`}
              className={`min-h-11 rounded-lg border p-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#143d1a] focus-visible:ring-offset-2 ${
                isSelected
                  ? "border-[#143d1a] bg-[#e8f2e7] font-semibold text-[#143d1a]"
                  : "border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-50"
              }`}
              onClick={() =>
                onSelect(
                  option,
                  nextGuidedWalkthroughSelection(selected, option, multiple),
                )
              }
            >
              <span aria-hidden="true" className="mr-2">
                {multiple ? (isSelected ? "☑" : "☐") : isSelected ? "●" : "○"}
              </span>
              {option}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
