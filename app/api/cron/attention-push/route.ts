import { processAttentionPushes } from "@/lib/push/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try { return Response.json({ ok: true, ...(await processAttentionPushes()) }); }
  catch (cause) { console.error("Attention push cron failed", cause instanceof Error ? cause.message : "Unknown error"); return Response.json({ error: "Push processing failed." }, { status: 500 }); }
}
