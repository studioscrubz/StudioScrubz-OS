import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { calculateSalesEstimate, loadPrivatePricingCatalog, publicEstimateResult } from "@/lib/server/salesEstimatePricing";
import type { UserProfile } from "@/types/auth";

export async function POST(request: Request) {
  try {
    const session = await createSupabaseServerClient();
    const { data: userData } = await session.auth.getUser();
    if (!userData.user) return Response.json({ error: "Authentication is required." }, { status: 401 });
    const { data: profileData, error: profileError } = await session.from("user_profiles").select("*").eq("id", userData.user.id).single();
    if (profileError) throw profileError;
    const profile = profileData as UserProfile;
    if (!profile.is_active || profile.role !== "Sales") return Response.json({ error: "An active Sales account is required." }, { status: 403 });

    const body = await request.json() as { action?: unknown; calculatorInput?: unknown; manualPrice?: unknown; serviceDescription?: unknown; estimateId?: unknown; estimate?: unknown };
    const admin = createSupabaseAdminClient();
    const catalog = await loadPrivatePricingCatalog(admin);
    const fullResult = calculateSalesEstimate(body.calculatorInput, catalog, body.manualPrice, body.serviceDescription);
    if (body.action === "calculate") return Response.json({ result: publicEstimateResult(fullResult) });
    if (body.action !== "save" || !body.estimate || typeof body.estimate !== "object" || Array.isArray(body.estimate)) {
      return Response.json({ error: "A valid estimate save request is required." }, { status: 400 });
    }
    const payload = body.estimate as Record<string, unknown>;
    const allowed = ["client_id","property_id","division","customer_first_name","customer_last_name","customer_phone","customer_email","customer_address","frequency","service_name","status","notes","terms","lead_representative_id"];
    if (Object.keys(payload).some(key => !allowed.includes(key))) return Response.json({ error: "The estimate contains unsupported fields." }, { status: 400 });
    const estimateId = body.estimateId === null || body.estimateId === undefined ? null : typeof body.estimateId === "string" ? body.estimateId : undefined;
    if (estimateId === undefined) return Response.json({ error: "The estimate identifier is invalid." }, { status: 400 });
    const { data, error } = await admin.rpc("service_save_sales_estimate", { p_actor_id: profile.id, p_estimate_id: estimateId, p_payload: payload, p_result: fullResult });
    if (error) throw error;
    return Response.json({ estimate: data });
  } catch (error) {
    console.error("Sales estimate workflow failed", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: error instanceof Error ? error.message : "The estimate could not be processed." }, { status: 400 });
  }
}
