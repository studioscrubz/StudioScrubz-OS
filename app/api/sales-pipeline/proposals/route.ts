import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { UserProfile } from "@/types/auth";
import type { EstimateResult } from "@/types/estimate";
import type { ProposalResult } from "@/types/proposal";

export async function POST(request: Request) {
  try {
    const session = await createSupabaseServerClient();
    const { data: userData } = await session.auth.getUser();
    if (!userData.user) return Response.json({ error: "Authentication is required." }, { status: 401 });
    const { data: profileData, error: profileError } = await session.from("user_profiles").select("*").eq("id", userData.user.id).single();
    if (profileError) throw profileError;
    const profile = profileData as UserProfile;
    if (!profile.is_active || profile.role !== "Sales") return Response.json({ error: "An active Sales account is required." }, { status: 403 });
    const body = await request.json() as { proposalId?: unknown; proposal?: unknown };
    if (!body.proposal || typeof body.proposal !== "object" || Array.isArray(body.proposal)) return Response.json({ error: "A valid Proposal is required." }, { status: 400 });
    const submitted = body.proposal as Record<string, unknown>;
    const result = submitted.result as ProposalResult | undefined;
    if (!result || typeof result !== "object") return Response.json({ error: "Proposal pricing is required." }, { status: 400 });
    const admin = createSupabaseAdminClient();
    const estimateId = typeof submitted.estimate_id === "string" ? submitted.estimate_id : null;
    const walkthroughId = typeof submitted.walkthrough_id === "string" ? submitted.walkthrough_id : null;
    let source: EstimateResult | null = null;
    if (estimateId) {
      const { data, error } = await admin.from("estimates").select("result,approval_status,approved_pricing_snapshot").eq("id", estimateId).single();
      if (error) throw error;
      if (data.approval_status !== "Approved" || !data.approved_pricing_snapshot) return Response.json({ error: "The source Estimate must be approved before Sales can build a Proposal." }, { status: 409 });
      source = data.result as EstimateResult;
    } else if (walkthroughId) {
      const { data, error } = await admin.from("walkthroughs").select("pricing_review,status").eq("id", walkthroughId).single();
      if (error) throw error;
      const review = data.pricing_review as { estimateResult?: EstimateResult } | null;
      if (!review?.estimateResult || !["Completed","Proposal Ready"].includes(data.status)) return Response.json({ error: "Management pricing review is required before Sales can build this Proposal." }, { status: 409 });
      source = review.estimateResult;
    }
    if (!source) return Response.json({ error: "An approved Estimate or reviewed Walkthrough is required." }, { status: 400 });
    const perVisitTotal = finiteNonnegative(result.perVisitTotal, "Proposal price");
    const internalCosts = Number(source.laborCost ?? 0) + Number(source.supplyCost ?? 0);
    const fullResult: ProposalResult = {
      ...result,
      additionalLabor: 0,
      additionalMaterials: 0,
      recommendedLaborHours: source.laborHours,
      laborHoursOverride: null,
      laborHours: source.laborHours,
      recommendedCrewSize: source.crewSize,
      crewSizeOverride: null,
      crewRecommendation: source.crewSize,
      estimatedDuration: source.estimatedDuration,
      estimatedProfit: Math.round((perVisitTotal - internalCosts) * 100) / 100,
    };
    const allowed = ["client_id","property_id","estimate_id","walkthrough_id","division","client_name","property_name","customer_phone","customer_email","frequency","requested_date","representative_name","notes","photos","expiration_date","lead_representative_id"];
    const payload = Object.fromEntries(Object.entries(submitted).filter(([key]) => allowed.includes(key)));
    const proposalId = body.proposalId === null || body.proposalId === undefined ? null : typeof body.proposalId === "string" ? body.proposalId : undefined;
    if (proposalId === undefined) return Response.json({ error: "The Proposal identifier is invalid." }, { status: 400 });
    if (proposalId) {
      const { data: current, error: currentError } = await admin.from("proposals").select("status,approval_status,archived_at").eq("id", proposalId).single();
      if (currentError) throw currentError;
      if (current.archived_at || current.status !== "Draft" || !["Not Submitted","Changes Requested"].includes(current.approval_status)) return Response.json({ error: "Only an actionable Proposal draft may be edited." }, { status: 409 });
      delete payload.photos;
      const { data, error } = await admin.from("proposals").update({ ...payload, result: fullResult }).eq("id", proposalId).select("*").single();
      if (error) throw error;
      await admin.from("proposal_history").insert({ proposal_id: proposalId, event_type: "Proposal Edited", previous_status: current.status, new_status: data.status, description: null, metadata: {}, performed_by: profile.display_name || profile.email || "Sales" });
      return Response.json({ proposal: publicProposal(data) });
    }
    if (submitted.status !== "Draft" || submitted.approval_status !== "Not Submitted") return Response.json({ error: "New Proposals must begin as drafts." }, { status: 400 });
    for (let attempt=0; attempt<5; attempt+=1) {
      const proposalNumber = `PROP-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${String(Math.floor(Math.random()*10000)).padStart(4,"0")}`;
      const { data, error } = await admin.from("proposals").insert({ ...payload, proposal_number: proposalNumber, result: fullResult, signature:null,status:"Draft",approval_status:"Not Submitted",approved_at:null,approved_by:null,approval_notes:null,accepted:false,accepted_at:null,accepted_by_name:null,acceptance_method:null,declined_at:null,decline_reason:null,expired_at:null }).select("*").single();
      if (!error) { await admin.from("proposal_history").insert({ proposal_id: data.id, event_type: "Proposal Created", previous_status: null, new_status: "Draft", description: null, metadata: {}, performed_by: profile.display_name || profile.email || "Sales" }); return Response.json({ proposal: publicProposal(data) }); }
      if (error.code !== "23505") throw error;
    }
    throw new Error("A unique Proposal number could not be generated.");
  } catch (error) {
    console.error("Sales proposal workflow failed", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: error instanceof Error ? error.message : "The Proposal could not be saved." }, { status: 400 });
  }
}

function publicProposal(row: Record<string, unknown>) { const copy={...row}; delete copy.approved_pricing_snapshot; delete copy.client_delivery_snapshot; copy.result=publicProposalResult(copy.result as ProposalResult); return copy; }
function publicProposalResult(result: ProposalResult) { const safe={...result} as Partial<ProposalResult>;for(const key of ["estimatedProfit","additionalLabor","additionalMaterials","laborHours","laborHoursOverride","recommendedLaborHours","crewRecommendation","crewSizeOverride","recommendedCrewSize","estimatedDuration"] as const)delete safe[key];return safe; }
function finiteNonnegative(value: unknown, label: string) { const number=Number(value); if(!Number.isFinite(number)||number<0)throw new Error(`A valid ${label} is required.`);return number; }
