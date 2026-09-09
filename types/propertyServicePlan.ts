export const PLAN_STATUSES = ["Active", "Paused", "Ended"] as const;
export const PLAN_FREQUENCIES = ["Daily", "Multiple Days Per Week", "Weekly", "Custom"] as const;
export const PLAN_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export type PropertyServicePlanInput = {
  client_id: string;
  property_id: string;
  agreement_id: string | null;
  service_id: string | null;
  name: string;
  status: (typeof PLAN_STATUSES)[number];
  start_date: string;
  end_date: string | null;
  frequency: (typeof PLAN_FREQUENCIES)[number];
  service_days: number[];
  assigned_crew_id: string | null;
  notes: string | null;
};
export type PropertyServicePlan = PropertyServicePlanInput & {
  id: string; created_at: string; updated_at: string; archived_at: string | null;
};
export type PropertyServicePlanAreaInput = {
  id?: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_required: boolean;
  requires_photo: boolean;
  active: boolean;
};
export type PropertyServicePlanArea = PropertyServicePlanAreaInput & {
  id: string; service_plan_id: string; created_at: string; updated_at: string;
};
export type PropertyServicePlanWithAreas = PropertyServicePlan & { areas: PropertyServicePlanArea[] };

export function validatePropertyServicePlan(input: PropertyServicePlanInput, areas: PropertyServicePlanAreaInput[]) {
  if (!input.name.trim() || !input.client_id || !input.property_id) throw new Error("Name, client, and property are required.");
  if (!PLAN_STATUSES.includes(input.status) || !PLAN_FREQUENCIES.includes(input.frequency)) throw new Error("Select a valid status and frequency.");
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!validDate(input.start_date) || (input.end_date && (!validDate(input.end_date) || input.end_date < input.start_date))) throw new Error("Choose valid dates; end date cannot precede start date.");
  const days = input.service_days;
  if (new Set(days).size !== days.length || days.some(day => !Number.isInteger(day) || day < 1 || day > 7)) throw new Error("Service days must be unique Monday–Sunday values.");
  if ((input.frequency === "Daily" && days.length !== 7) || (input.frequency === "Weekly" && days.length !== 1) || (input.frequency === "Multiple Days Per Week" && days.length < 2)) throw new Error("Daily requires all seven days, Weekly requires one, and Multiple Days Per Week requires at least two.");
  if (areas.some(area => !area.name.trim() || !Number.isInteger(area.sort_order) || area.sort_order < 0)) throw new Error("Each service area needs a name and valid order.");
  const ids = areas.flatMap(area => area.id ? [area.id] : []);
  if (new Set(ids).size !== ids.length) throw new Error("Service areas cannot have duplicate IDs.");
}
