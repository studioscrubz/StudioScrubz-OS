import{requireMasterAdmin,apiError}from"@/lib/google-calendar/route-auth";import{listOwnedCalendars}from"@/lib/google-calendar/server";
export async function GET(){try{await requireMasterAdmin();return Response.json({calendars:await listOwnedCalendars()})}catch(e){return apiError(e)}}
