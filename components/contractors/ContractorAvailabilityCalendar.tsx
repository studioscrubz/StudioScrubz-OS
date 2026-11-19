"use client";
import {useEffect,useMemo,useState} from "react";
import {formatTime12Hour} from "@/lib/formatTime";

type Status="available"|"limited"|"busy";
type Day={date:string;status:Status;times:Array<{time:string;status:Status}>};
type CalendarResponse={month:string;timezone:string;indicative:true;days:Day[]};
const classFor:Record<Status,string>={
 available:"border-green-300 bg-green-50 text-green-900",
 limited:"border-amber-300 bg-amber-50 text-amber-950",
 busy:"border-neutral-200 bg-neutral-100 text-neutral-500",
};
const labelFor:Record<Status,string>={available:"Requestable",limited:"Limited",busy:"Busy"};
function pacificMonth(){
 const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Los_Angeles",year:"numeric",month:"2-digit"}).formatToParts(new Date());
 const year=parts.find(part=>part.type==="year")?.value??"2026";
 const month=parts.find(part=>part.type==="month")?.value??"01";
 return `${year}-${month}`;
}
function shiftMonth(month:string,amount:number){
 const [year,m]=month.split("-").map(Number);
 const d=new Date(Date.UTC(year,m-1+amount,1));
 return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`;
}
export function ContractorAvailabilityCalendar({onChoose,chosenDate,previewCompanyId}:{
 onChoose?:(date:string,time:string)=>void;chosenDate?:string;previewCompanyId?:string;
}){
 const [month,setMonth]=useState(()=>chosenDate?.slice(0,7)||pacificMonth());
 const [selected,setSelected]=useState(chosenDate||"");
 const [data,setData]=useState<CalendarResponse|null>(null);
 const [loading,setLoading]=useState(true),[error,setError]=useState("");
 const [refresh,setRefresh]=useState(0);
 const firstWeekday=useMemo(()=>{
  const [year,m]=month.split("-").map(Number);
  return new Date(Date.UTC(year,m-1,1)).getUTCDay();
 },[month]);
 const maxMonth=useMemo(()=>shiftMonth(pacificMonth(),12),[]);
 useEffect(()=>{
  const controller=new AbortController();
  void fetch("/api/contractors?"+new URLSearchParams({view:"availability-month",month,...(previewCompanyId?{previewCompanyId}:{})}),{
   cache:"no-store",signal:controller.signal,
  }).then(async response=>{
   const payload=await response.json();
   if(!response.ok)throw new Error(payload.error??"Availability calendar is unavailable.");
   if(!controller.signal.aborted){setData(payload as CalendarResponse);setError("");}
  }).catch(cause=>{
   if(!controller.signal.aborted){setData(null);setError(cause instanceof Error?cause.message:"Availability unavailable.");}
  }).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return()=>controller.abort();
 },[month,refresh,previewCompanyId]);
 const days=data?.month===month?data.days:[];
 const chosen=days.find(day=>day.date===selected);
 const dates=Array.from({length:firstWeekday},(_,index)=>`empty-${index}`);
 const title=new Date(month+"-01T12:00:00Z").toLocaleDateString("en-US",{month:"long",year:"numeric",timeZone:"UTC"});
 const monthToday=pacificMonth();
 const selectDate=(day:Day)=>{if(day.status!=="busy")setSelected(day.date);};
 return <section className="rounded-xl border bg-white p-4 sm:p-5">
  <div className="flex flex-wrap items-center justify-between gap-3">
   <div><h2 className="text-xl font-extrabold text-[#143d1a]">Availability Calendar</h2>
    <p className="text-sm text-neutral-600">Pacific time · Google Calendar and StudioScrubz scheduling</p></div>
   <button type="button" className="rounded-lg border px-3 py-2 text-sm font-bold text-[#143d1a]" onClick={()=>{setLoading(true);setRefresh(value=>value+1);}}>Refresh</button>
  </div>
  <div className="my-4 flex items-center justify-between gap-3">
   <button type="button" aria-label="Previous month" disabled={month<=monthToday} className="rounded-lg border px-3 py-2 disabled:opacity-40" onClick={()=>{setLoading(true);setSelected("");setMonth(value=>shiftMonth(value,-1));}}>‹</button>
   <h3 className="font-bold">{title}</h3>
   <button type="button" aria-label="Next month" disabled={month>=maxMonth} className="rounded-lg border px-3 py-2 disabled:opacity-40" onClick={()=>{setLoading(true);setSelected("");setMonth(value=>shiftMonth(value,1));}}>›</button>
  </div>
  <div className="mb-2 grid grid-cols-7 gap-1 text-center text-xs font-bold text-neutral-600">
   {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(day=><div key={day}>{day}</div>)}
  </div>
  {error?<div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900">
   {error} <button type="button" className="ml-2 underline" onClick={()=>{setLoading(true);setRefresh(value=>value+1);}}>Retry</button>
  </div>:<div className="grid grid-cols-7 gap-1">
   {dates.map(empty=><div key={empty}/>)}
   {days.map(day=><button key={day.date} type="button" disabled={loading||day.status==="busy"}
    aria-label={`${day.date}: ${labelFor[day.status]}`}
    aria-pressed={selected===day.date}
    title={labelFor[day.status]}
    className={`min-h-14 rounded-lg border p-1 text-center disabled:cursor-not-allowed ${classFor[day.status]} ${selected===day.date?"ring-2 ring-[#143d1a] ring-offset-1":""}`}
    onClick={()=>selectDate(day)}>
    <span className="block text-sm font-bold">{Number(day.date.slice(-2))}</span>
    <span className="block text-[10px] leading-tight">{labelFor[day.status]}</span>
   </button>)}
  </div>}
  {loading&&<p role="status" className="mt-2 text-sm text-neutral-500">Checking live availability…</p>}
  <div className="mt-4 flex flex-wrap gap-3 text-xs">
   {(["available","limited","busy"] as const).map(status=><span key={status} className="flex items-center gap-1"><span className={`h-3 w-3 rounded border ${classFor[status]}`}/>{labelFor[status]}</span>)}
  </div>
  {chosen&&<div className="mt-4 border-t pt-4">
   <p className="font-bold">Choose a requested start time · {chosen.date}</p>
   <div className="mt-3 grid max-h-56 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4 md:grid-cols-6">
    {chosen.times.filter(slot=>slot.status!=="busy").map(slot=><button type="button"
     key={slot.time} disabled={!onChoose} onClick={()=>onChoose?.(chosen.date,slot.time)}
     className={`rounded-lg border px-2 py-2 text-xs font-semibold ${classFor[slot.status]}`}
     title={slot.status==="limited"?"Other work may overlap; Operations will confirm.":"Request this time"}
    >{formatTime12Hour(slot.time)}{slot.status==="limited"?" · Limited":""}</button>)}
   </div>
   {!chosen.times.some(slot=>slot.status!=="busy")&&<p className="text-sm text-neutral-600">No requestable start times shown for this date.</p>}
  </div>}
  <p className="mt-4 text-xs text-neutral-600">Availability is indicative, not a reservation or a crew guarantee. Existing work and pending requests may limit capacity. Operations reviews every submitted request. Private calendar event details are never shown.</p>
 </section>;
}
