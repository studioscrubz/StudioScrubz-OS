export type CalendarJob = {id:string;job_number:string;service_name:string|null;client_name:string|null;scheduled_date:string|null;start_time:string|null;estimated_duration:number|null;assigned_crew_id:string|null;property?:{property_name?:string|null;address?:string|null;address_line_2?:string|null;city?:string|null;state?:string|null;zip?:string|null}|null};
export type CalendarAttendee={email:string};
export function deterministicEventId(jobId:string){return `ssjob${jobId.replaceAll("-","").toLowerCase()}`}
export function validEmail(value:string|null|undefined){return Boolean(value&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))}
export function uniqueAttendees(emails:Array<string|null|undefined>){return [...new Set(emails.filter(validEmail).map(x=>x!.trim().toLowerCase()))].map(email=>({email}))}
export function buildEvent(job:CalendarJob,timezone:string,durationMinutes:number,attendees:CalendarAttendee[],appUrl:string,crewName?:string|null){
  if(!job.scheduled_date||!job.start_time)throw new Error("The Job needs both a scheduled date and start time before Calendar sync.");
  const start=`${job.scheduled_date}T${job.start_time.slice(0,8)}`;const startDate=new Date(`${start}Z`);const minutes=Math.round((job.estimated_duration??0)*60)||durationMinutes;const end=new Date(startDate.getTime()+minutes*60000);const localEnd=end.toISOString().slice(0,19);
  const p=job.property;const location=[p?.address,p?.address_line_2,p?.city,p?.state,p?.zip].filter(Boolean).join(", ");
  return {summary:`StudioScrubz — ${job.job_number} — ${job.service_name||"Service"}`,location,description:["StudioScrubz Job",`Job #: ${job.job_number}`,`Client: ${job.client_name||"Client"}`,`Service: ${job.service_name||"Service"}`,`Location: ${location||"See StudioScrubz OS"}`,`Crew: ${crewName||"Unassigned"}`,"",`View Job: ${appUrl.replace(/\/$/,"")}/jobs?jobId=${job.id}`].join("\n"),start:{dateTime:start,timeZone:timezone},end:{dateTime:localEnd,timeZone:timezone},attendees};
}
