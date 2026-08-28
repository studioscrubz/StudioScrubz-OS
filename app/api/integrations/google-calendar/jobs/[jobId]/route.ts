import { requireMasterAdmin,apiError } from "@/lib/google-calendar/route-auth";import { syncJobCalendar } from "@/lib/google-calendar/server";
export async function POST(_:Request,context:{params:Promise<{jobId:string}>}){try{await requireMasterAdmin();return Response.json(await syncJobCalendar((await context.params).jobId))}catch(e){return apiError(e)}}
