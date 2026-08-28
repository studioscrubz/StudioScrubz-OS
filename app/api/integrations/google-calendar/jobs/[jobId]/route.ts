import { requireJobAccess,apiError } from "@/lib/google-calendar/route-auth";import { syncJobCalendar } from "@/lib/google-calendar/server";
export async function POST(_:Request,context:{params:Promise<{jobId:string}>}){try{const {jobId}=await context.params;await requireJobAccess(jobId,"jobs.edit");return Response.json(await syncJobCalendar(jobId))}catch(e){return apiError(e)}}
