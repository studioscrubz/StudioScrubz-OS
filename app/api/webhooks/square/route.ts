import { getSquarePayment, verifySquareWebhookSignature } from "@/lib/square";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type SquareWebhook = { type?: string; data?: { object?: { payment?: { id?: string } } } };

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifySquareWebhookSignature(rawBody, request.headers.get("x-square-hmacsha256-signature"))) return Response.json({ error: "Invalid webhook signature." }, { status: 401 });
  try {
    const event = JSON.parse(rawBody) as SquareWebhook;
    if (!["payment.created", "payment.updated"].includes(event.type || "")) return Response.json({ received: true, ignored: true });
    const paymentId = event.data?.object?.payment?.id;
    if (!paymentId) return Response.json({ error: "Square Payment ID is missing." }, { status: 400 });
    const payment = await getSquarePayment(paymentId);
    if (!payment.id || !payment.order_id) return Response.json({ error: "Square Payment details are invalid." }, { status: 400 });
    const admin = createSupabaseAdminClient();
    const { data: attempt, error: attemptError } = await admin.from("square_checkout_attempts").select("id").eq("square_order_id", payment.order_id).maybeSingle();
    if (attemptError) throw attemptError;
    if (!attempt) return Response.json({ received: true, ignored: true });
    if (payment.status !== "COMPLETED") {
      if (["FAILED", "CANCELED"].includes(payment.status || "")) await admin.from("square_checkout_attempts").update({ status: payment.status === "CANCELED" ? "Cancelled" : "Failed", updated_at: new Date().toISOString() }).eq("id", attempt.id);
      return Response.json({ received: true, ignored: true, status: payment.status });
    }
    if (!Number.isSafeInteger(payment.amount_money?.amount) || payment.amount_money!.amount! <= 0 || payment.amount_money?.currency !== "USD") return Response.json({ error: "Square Payment details are invalid." }, { status: 400 });
    const { data, error } = await admin.rpc("record_square_invoice_payment", { p_attempt_id: attempt.id, p_square_payment_id: payment.id, p_square_order_id: payment.order_id, p_amount_cents: payment.amount_money.amount, p_currency: payment.amount_money.currency, p_paid_at: payment.updated_at || payment.created_at || new Date().toISOString() });
    if (error) throw error;
    if (data && typeof data === "object" && "conflict" in data && data.conflict) console.error("Square payment requires manual reconciliation", { paymentId: payment.id, orderId: payment.order_id, attemptId: attempt.id });
    return Response.json({ received: true, settlement: data });
  } catch (cause) {
    console.error("Square webhook processing failed", cause);
    return Response.json({ error: "Square webhook processing failed." }, { status: 500 });
  }
}
