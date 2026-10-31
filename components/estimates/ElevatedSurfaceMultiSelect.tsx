"use client";

const surfaceOptions = [
  "Ceiling corners and edges",
  "Ceiling fans",
  "Light fixtures and chandeliers",
  "Air vents and registers",
  "Exposed pipes and ductwork",
  "High walls and ledges",
  "Upper cabinets and shelving",
  "Window tops and frames",
  "Beams and structural supports",
] as const;

function decodeScope(scope: string) {
  const tokens = scope.split(",").map(item => item.trim()).filter(Boolean);
  const selected = tokens.filter(item => surfaceOptions.some(option => option === item));
  const other = tokens.filter(item => !surfaceOptions.some(option => option === item)).join(", ");
  return { selected, other };
}

export function ElevatedSurfaceMultiSelect({
  value,
  onChange,
  required = false,
}: {
  value: string;
  onChange: (scope: string) => void;
  required?: boolean;
}) {
  const { selected, other } = decodeScope(value);
  const update = (nextSelected: string[], nextOther: string) => {
    onChange([...surfaceOptions.filter(option => nextSelected.includes(option)), nextOther.trim()].filter(Boolean).join(", "));
  };
  return (
    <fieldset className="rounded-lg border border-neutral-200 p-3 sm:col-span-2">
      <legend className="px-1 text-sm font-bold text-[#143d1a]">
        Elevated surfaces and scope{required ? " *" : ""}
      </legend>
      <p className="mb-2 text-xs text-neutral-600">Select all that apply.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {surfaceOptions.map(option => (
          <label key={option} className="flex cursor-pointer items-center gap-2 text-sm text-neutral-800">
            <input
              type="checkbox"
              checked={selected.includes(option)}
              onChange={event =>
                update(event.target.checked ? [...selected, option] : selected.filter(item => item !== option), other)
              }
              className="size-4 accent-[#143d1a]"
            />
            {option}
          </label>
        ))}
      </div>
      <label className="mt-3 block text-xs font-bold text-neutral-700">
        Other elevated surfaces / exclusions (optional)
        <textarea
          value={other}
          onChange={event => update(selected, event.target.value)}
          rows={2}
          maxLength={1400}
          placeholder="Describe any other elevated surfaces or exclusions"
          className="mt-1 w-full rounded-lg border border-neutral-300 bg-white p-2 text-sm"
        />
      </label>
      {required && !value.trim() && <p className="mt-2 text-xs text-amber-800">Select at least one surface or describe the scope.</p>}
    </fieldset>
  );
}
