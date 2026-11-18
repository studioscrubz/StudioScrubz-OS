type MonthlySchedule = {
  monthly_week_ordinals?: number[] | null;
  days_of_week: number[];
};

export function validateMonthlyWeekdays(schedule: MonthlySchedule): string | null {
  if (schedule.monthly_week_ordinals == null) return null;
  const weeks = schedule.monthly_week_ordinals;
  if (weeks.length !== 2 || new Set(weeks).size !== 2 ||
      weeks.some(week => !Number.isInteger(week) || week < 1 || week > 4)) {
    return "Select two different weekday occurrences from first through fourth.";
  }
  if (schedule.days_of_week.length !== 1 ||
      !Number.isInteger(schedule.days_of_week[0]) ||
      schedule.days_of_week[0] < 0 || schedule.days_of_week[0] > 6) {
    return "Select one weekday for the twice-monthly schedule.";
  }
  return null;
}

export function monthlyWeekdayLabel(schedule: MonthlySchedule): string | null {
  if (schedule.monthly_week_ordinals == null || validateMonthlyWeekdays(schedule)) return null;
  const ordinals = ["", "1st", "2nd", "3rd", "4th"];
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const weeks = [...schedule.monthly_week_ordinals].sort((a, b) => a - b);
  return `${ordinals[weeks[0]]} and ${ordinals[weeks[1]]} ${days[schedule.days_of_week[0]]} of each month`;
}
