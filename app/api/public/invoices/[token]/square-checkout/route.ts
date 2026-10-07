import { randomUUID } from "node:crypto";
import { createSquarePaymentLink, getSquareEnvironment } from "@/lib/square";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST(_request: Request, context: RouteContext<"/api/public/invoices/[token]/square-checkout">) {
  try {
    const { token } = await context.params;
    if (!/^[a-f0-9]{64}$/i.test(token)) return Response.json({ error: "Invoice link is invalid." }, { status: 404 });
    const admin = createSupabaseAdminClient();
    const { data: invoice, error } = await admin.from("invoices").select("id,invoice_number,status,total,client_access_token_expires_at,archived_at").eq("client_access_token", token).maybeSingle();
    if (error) throw error;
    if (!invoice || invoice.archived_at || invoice.client_access_token_expires_at && Date.parse(invoice.client_access_token_expires_at) <= Date.now()) return Response.json({ error: "Invoice link is invalid, expired, or unavailable." }, { status: 404 });
    const { data: payments, error: paymentsError } = await admin.from("payments").select("amount").eq("invoice_id", invoice.id).is("voided_at", null);
    if (paymentsError) throw paymentsError;
    const amountPaid = (payments ?? []).reduce((sum, payment) => sum + Number(payment.amount), 0);
    const balanceDue = Math.max(0, Math.round((Number(invoice.total) - amountPaid) * 100) / 100);
    if (["Cancelled", "Archived", "Draft"].includes(invoice.status) || balanceDue <= 0) return Response.json({ error: "This Invoice is not payable." }, { status: 409 });
    const amountCents = Math.round(balanceDue * 100);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return Response.json({ error: "Invoice balance is invalid." }, { status: 409 });
    const squareEnvironment = getSquareEnvironment();
    const { error: staleError } = await admin.from("square_checkout_attempts").update({ status: "Cancelled", conflict_reason: "Invoice balance changed before checkout was completed.", updated_at: new Date().toISOString() }).eq("invoice_id", invoice.id).eq("square_environment", squareEnvironment).in("status", ["Created", "Pending"]).neq("amount_cents", amountCents);
    if (staleError) throw staleError;
    const { data: reusable } = await admin.from("square_checkout_attempts").select("checkout_url").eq("invoice_id", invoice.id).eq("square_environment", squareEnvironment).eq("amount_cents", amountCents).in("status", ["Created", "Pending"]).not("checkout_url", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (reusable?.checkout_url) return Response.json({ checkoutUrl: reusable.checkout_url });
    const attemptId = randomUUID(), idempotencyKey = randomUUID();
    const { error: attemptError } = await admin.from("square_checkout_attempts").insert({ id: attemptId, invoice_id: invoice.id, idempotency_key: idempotencyKey, square_environment: squareEnvironment, amount_cents: amountCents, currency: "USD", status: "Created" });
    if (attemptError) {
      if (attemptError.code === "23505") {
        const { data: active } = await admin.from("square_checkout_attempts").select("checkout_url").eq("invoice_id", invoice.id).eq("square_environment", squareEnvironment).eq("amount_cents", amountCents).in("status", ["Created", "Pending"]).not("checkout_url", "is", null).limit(1).maybeSingle();
        if (active?.checkout_url) return Response.json({ checkoutUrl: active.checkout_url });
      }
      throw attemptError;
    }
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");
    if (!siteUrl) throw new Error("NEXT_PUBLIC_SITE_URL is not configured.");
    try {
      const link = await createSquarePaymentLink({ idempotencyKey, invoiceNumber: invoice.invoice_number, amountCents, redirectUrl: `${siteUrl}/invoice/${token}?payment=processing` });
      const { error: updateError } = await admin.from("square_checkout_attempts").update({ square_payment_link_id: link.id, square_order_id: link.orderId, checkout_url: link.url, status: "Pending", updated_at: new Date().toISOString() }).eq("id", attemptId);
      if (updateError) throw updateError;
      return Response.json({ checkoutUrl: link.url });
    } catch (cause) {
      await admin.from("square_checkout_attempts").update({ status: "Failed", conflict_reason: safeMessage(cause), updated_at: new Date().toISOString() }).eq("id", attemptId);
      throw cause;
    }
  } catch (cause) {
    console.error("Square checkout creation failed", cause);
    return Response.json({ error: "Secure checkout could not be prepared." }, { status: 500 });
  }
}

function safeMessage(cause: unknown) { return cause instanceof Error ? cause.message : cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string" ? cause.message : "Square checkout could not be created."; }
