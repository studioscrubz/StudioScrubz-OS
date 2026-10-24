import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { UserProfile } from "@/types/auth";

const allowed = ["estimate_id","client_id","property_id","division","walkthrough_date","walkthrough_time","status","sales_stage","contact_name","phone","email","assigned_to","assigned_employee_id","notes","scope","measurements","photos","archived_at"];
const protectedMeasurementKeys = ["workerHourlyPay","targetProfitMarginPercent","projectCosting","totalLaborCost","projectedProfit","profitMargin","assessmentPricing"];

export async function POST(request: Request) {
  try {
    const session=await createSupabaseServerClient();
    const {data:userData}=await session.auth.getUser();
    if(!userData.user)return Response.json({error:"Authentication is required."},{status:401});
    const {data:profileData,error:profileError}=await session.from("user_profiles").select("*").eq("id",userData.user.id).single();
    if(profileError)throw profileError;
    const profile=profileData as UserProfile;
    if(!profile.is_active||profile.role!=="Sales")return Response.json({error:"An active Sales account is required."},{status:403});
    const body=await request.json() as {walkthroughId?:unknown;walkthrough?:unknown};
    if(!body.walkthrough||typeof body.walkthrough!=="object"||Array.isArray(body.walkthrough))return Response.json({error:"A valid Sales Assessment is required."},{status:400});
    const submitted=body.walkthrough as Record<string,unknown>;
    if(Object.keys(submitted).some(key=>!allowed.includes(key)))return Response.json({error:"The Sales Assessment contains unsupported fields."},{status:400});
    const measurements={...((submitted.measurements&&typeof submitted.measurements==="object"&&!Array.isArray(submitted.measurements)?submitted.measurements:{}) as Record<string,unknown>)};
    for(const key of protectedMeasurementKeys)delete measurements[key];
    const payload:Record<string,unknown>={...submitted,measurements};
    const id=body.walkthroughId===null||body.walkthroughId===undefined?null:typeof body.walkthroughId==="string"?body.walkthroughId:undefined;
    if(id===undefined)return Response.json({error:"The Sales Assessment identifier is invalid."},{status:400});
    const admin=createSupabaseAdminClient();
    if(id){
      delete payload.photos;
      const {data:current,error:currentError}=await admin.from("walkthroughs").select("pricing_review,pricing_reviewed_at,pricing_reviewed_by").eq("id",id).single();
      if(currentError)throw currentError;
      const {data,error}=await admin.from("walkthroughs").update(payload).eq("id",id).select("*").single();
      if(error)throw error;
      return Response.json({walkthrough:publicWalkthrough({...data,...current})});
    }
    const {data,error}=await admin.from("walkthroughs").insert({...payload,recommendations:[],pricing_review:null,pricing_reviewed_at:null,pricing_reviewed_by:null}).select("*").single();
    if(error)throw error;
    return Response.json({walkthrough:publicWalkthrough(data)});
  }catch(error){console.error("Sales assessment workflow failed",error instanceof Error?error.message:"Unknown error");return Response.json({error:error instanceof Error?error.message:"The Sales Assessment could not be saved."},{status:400})}
}

function publicWalkthrough(row:Record<string,unknown>){const copy={...row};delete copy.pricing_review;delete copy.pricing_reviewed_at;delete copy.pricing_reviewed_by;delete copy.recommendations;return copy;}
