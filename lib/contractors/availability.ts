import "server-only";
import {createSupabaseAdminClient} from "@/lib/supabase/admin";
import {getContractorCalendarBusy} from "@/lib/google-calendar/server";
import {contractorScheduledJobStatuses} from "@/lib/contractors/scheduledJobs";

type Block={start:number;end:number};
export type AvailabilityStatus="available"|"limited"|"busy";
export type AvailabilityDay={date:string;status:AvailabilityStatus;times:Array<{time:string;status:AvailabilityStatus}>};
const SLOT_MINUTES=30;
const REQUEST_DURATION_MINUTES=120;
const TIMEZONE="America/Los_Angeles";
const pacificPartsFormatter=new Intl.DateTimeFormat("en-US",{timeZone:TIMEZONE,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
const isoDate=(year:number,month:number,day:number)=>`${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;

function localParts(timestamp:number){
 const parts=pacificPartsFormatter.formatToParts(timestamp);
 const vals=Object.fromEntries(parts.map(p=>[p.type,Number(p.value)]));
 return {year:vals.year,month:vals.month,day:vals.day,hour:vals.hour,minute:vals.minute};
}
/** Convert a Pacific wall-clock appointment to epoch milliseconds across DST boundaries. */
export function pacificTimeUtc(year:number,month:number,day:number,hour:number,minute:number){
 const intended=Date.UTC(year,month-1,day,hour,minute);
 let instant=intended;
 for(let i=0;i<3;i++){
  const current=localParts(instant);
  const represented=Date.UTC(current.year,current.month-1,current.day,current.hour,current.minute);
  instant+=intended-represented;
 }
 return instant;
}
function overlaps(start:number,end:number,blocks:Block[]){
 return blocks.some(block=>start<block.end&&end>block.start);
}
function blocksOfGoogle(items:Array<{start:string;end:string}>):Block[]{
 return items.map(item=>({start:Date.parse(item.start),end:Date.parse(item.end)}))
  .filter(item=>Number.isFinite(item.start)&&Number.isFinite(item.end)&&item.start<item.end);
}
function dateFromValue(value:string){
 const match=/^(\d{4})-(\d{2})$/.exec(value);
 if(!match)throw new Error("Select a valid calendar month.");
 const year=Number(match[1]),month=Number(match[2]);
 if(year<2025||year>2100||month<1||month>12)throw new Error("Select a valid calendar month.");
 return {year,month};
}
export async function getContractorMonthlyAvailability(month:string){
 const {year,month:monthNumber}=dateFromValue(month);
 const today=localParts(Date.now());
 const delta=(year-today.year)*12+monthNumber-today.month;
 if(delta<0||delta>12)throw new Error("Calendar availability supports this month through the next 12 months.");
 const next=new Date(Date.UTC(year,monthNumber,1));
 const through=isoDate(next.getUTCFullYear(),next.getUTCMonth()+1,1);
 const startDate=isoDate(year,monthNumber,1);
 const lastDay=new Date(Date.UTC(year,monthNumber,0)).getUTCDate();
 const queryStart=new Date(Date.UTC(year,monthNumber-1,1)-86_400_000).toISOString();
 const queryEnd=new Date(Date.UTC(next.getUTCFullYear(),next.getUTCMonth(),next.getUTCDate())+2*86_400_000).toISOString();
 const db=createSupabaseAdminClient();
 const [google,scheduled,requests]=await Promise.all([
  getContractorCalendarBusy(queryStart,queryEnd),
  db.from("jobs").select("scheduled_date,start_time,estimated_duration")
   .gte("scheduled_date",startDate).lt("scheduled_date",through)
   .in("status",contractorScheduledJobStatuses).is("archived_at",null)
   .not("start_time","is",null),
  db.from("contractor_opportunities").select("requested_date,requested_time")
   .gte("requested_date",startDate).lt("requested_date",through)
   .not("status","in","(Declined,Cancelled,Disputed)")
   .not("requested_time","is",null),
 ]);
 if(scheduled.error||requests.error)throw scheduled.error??requests.error;
 const googleBlocks=blocksOfGoogle(google);
 const scheduledBlocks:Block[]=[];
 for(const row of scheduled.data??[]){
  if(!row.scheduled_date||!row.start_time)continue;
  const date=row.scheduled_date.split("-").map(Number);
  const clock=row.start_time.split(":").map(Number);
  const start=pacificTimeUtc(date[0],date[1],date[2],clock[0],clock[1]);
  const duration=Number(row.estimated_duration);
  scheduledBlocks.push({start,end:start+(Number.isFinite(duration)&&duration>0?Math.min(duration*60,24*60):REQUEST_DURATION_MINUTES)*60_000});
 }
 const requestedBlocks:Block[]=[];
 for(const row of requests.data??[]){
  if(!row.requested_date||!row.requested_time)continue;
  const date=row.requested_date.split("-").map(Number);
  const clock=row.requested_time.split(":").map(Number);
  const start=pacificTimeUtc(date[0],date[1],date[2],clock[0],clock[1]);
  requestedBlocks.push({start,end:start+REQUEST_DURATION_MINUTES*60_000});
 }
 const days:AvailabilityDay[]=[];
 for(let day=1;day<=lastDay;day++){
  const date=isoDate(year,monthNumber,day);
  const times:AvailabilityDay["times"]=[];
  for(let minute=0;minute<24*60;minute+=SLOT_MINUTES){
   const hour=Math.floor(minute/60),m=minute%60;
   const start=pacificTimeUtc(year,monthNumber,day,hour,m);
   const end=start+REQUEST_DURATION_MINUTES*60_000;
   // The preview is advisory. Other crews may be free even when one is working.
   const status:AvailabilityStatus=start<Date.now()||overlaps(start,end,googleBlocks)?"busy":
    overlaps(start,end,scheduledBlocks)||overlaps(start,end,requestedBlocks)?"limited":"available";
   times.push({time:`${String(hour).padStart(2,"0")}:${String(m).padStart(2,"0")}`,status});
  }
  const usable=times.filter(slot=>slot.status!=="busy");
  const status:AvailabilityStatus=!usable.length?"busy":usable.some(slot=>slot.status==="available")?"available":"limited";
  days.push({date,status,times});
 }
 return {month,timezone:TIMEZONE,slotMinutes:SLOT_MINUTES,indicative:true,days};
}
