import { getPublicLeadRepresentatives } from "@/lib/services/publicEstimateRequests";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return Response.json(await getPublicLeadRepresentatives(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Representatives are temporarily unavailable." }, { status: 503 });
  }
}
