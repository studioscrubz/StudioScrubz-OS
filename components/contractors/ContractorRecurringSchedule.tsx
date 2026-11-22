"use client";

import {useState} from "react";
import {generateServiceDates} from "@/lib/scheduling/recurrence";
import type {AgreementFrequency, RecurrenceRule} from "@/types/agreement";

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function ContractorRecurringSchedule({start, frequency, busy, onSchedule}: {
 start: string;
 frequency: AgreementFrequency;
 busy: boolean;
 onSchedule: (dates: string[]) => void;
}) {
 const first = new Date(start + "T12:00:00Z");
 const firstDay = first.getUTCDay() as RecurrenceRule["daysOfWeek"][number];
 const last = new Date(first);
 last.setUTCDate(last.getUTCDate() + 366);
 const max = last.toISOString().slice(0,10);
 const [end, setEnd] = useState("");
 const [days, setDays] = useState<RecurrenceRule["daysOfWeek"]>([firstDay]);
 const [interval, setIntervalDays] = useState(7);
 const [secondDay, setSecondDay] = useState("");
 const multipleWeekdays = frequency === "Multiple Days Per Week";
 const twiceMonthly = frequency === "Twice Monthly";
 const validRule = (!multipleWeekdays || days.length >= 2)
  && (!twiceMonthly || (Number(secondDay) >= 1 && Number(secondDay) <= 31 && Number(secondDay) !== first.getUTCDate()))
  && (frequency !== "Custom" || (Number.isInteger(interval) && interval >= 1 && interval <= 366));
 const dates = validRule && end >= start && end <= max ? generateServiceDates(start,end,frequency,{
  daysOfWeek:days, intervalWeeks:1, dayOfMonth:first.getUTCDate(),
  secondDayOfMonth:twiceMonthly ? Number(secondDay) : null, customIntervalDays:interval,
 },end,false) : [];

 return <div className="space-y-3 rounded-lg border p-4">
  <h3 className="font-bold">Schedule recurring visits</h3>
  <p className="text-sm">The visits use the requested start time and confirmed per-visit price.</p>
  <label className="block text-sm">Schedule through <input className="rounded border p-2" type="date" min={start} max={max} value={end} onChange={event=>setEnd(event.target.value)}/></label>
  {multipleWeekdays && <fieldset className="flex flex-wrap gap-3">
   <legend className="text-sm">Service weekdays</legend>
   {weekdays.map((label,i)=>{
    const day=i as typeof firstDay;
    return <label key={label} className="text-sm"><input type="checkbox" checked={days.includes(day)} disabled={day===firstDay} onChange={event=>setDays(current=>event.target.checked?[...current,day]:current.filter(value=>value!==day))}/> {label}</label>;
   })}
  </fieldset>}
  {twiceMonthly && <label className="block text-sm">Second day of the month <input className="rounded border p-2" type="number" min={1} max={31} value={secondDay} onChange={event=>setSecondDay(event.target.value)}/></label>}
  {frequency==="Custom" && <label className="block text-sm">Days between visits <input className="rounded border p-2" type="number" min={1} max={366} value={interval} onChange={event=>setIntervalDays(Number(event.target.value))}/></label>}
  {dates.length > 0 && <p className="max-h-36 overflow-auto text-sm">{dates.join(", ")}</p>}
  <button type="button" className="rounded bg-[#143d1a] px-4 py-2 font-bold text-white disabled:opacity-50" disabled={busy||dates.length<2||dates.length>366} onClick={()=>onSchedule(dates)}>Approve &amp; schedule {dates.length || ""} visits</button>
 </div>;
}
