import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

type SquareMoney = { amount?: number; currency?: string };
export type SquarePayment = { id?: string; order_id?: string; status?: string; amount_money?: SquareMoney; created_at?: string; updated_at?: string };

function config() {
  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.SQUARE_LOCATION_ID;
  const apiVersion = process.env.SQUARE_API_VERSION;
  const environment = process.env.SQUARE_ENVIRONMENT || "sandbox";
  if (!accessToken || !locationId || !apiVersion) throw new Error("Square server credentials are not configured.");
  if (!['sandbox','production'].includes(environment)) throw new Error("SQUARE_ENVIRONMENT must be sandbox or production.");
  return { accessToken, locationId, apiVersion, baseUrl: environment === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com" };
}

async function squareRequest(path: string, init: RequestInit) {
  const square = config();
  const response = await fetch(`${square.baseUrl}${path}`, { ...init, cache: "no-store", headers: { Authorization: `Bearer ${square.accessToken}`, "Content-Type": "application/json", "Square-Version": square.apiVersion, ...init.headers } });
  const body = await response.json().catch(() => null) as { errors?: Array<{ detail?: string; code?: string }> } | null;
  if (!response.ok) throw new Error(body?.errors?.map(error => error.detail || error.code).filter(Boolean).join("; ") || "Square request failed.");
  return body;
}

export async function createSquarePaymentLink(input: { idempotencyKey: string; invoiceNumber: string; amountCents: number; redirectUrl: string }) {
  const square = config();
  const body = await squareRequest("/v2/online-checkout/payment-links", { method: "POST", body: JSON.stringify({ idempotency_key: input.idempotencyKey, quick_pay: { name: `StudioScrubz Invoice ${input.invoiceNumber}`, price_money: { amount: input.amountCents, currency: "USD" }, location_id: square.locationId }, checkout_options: { redirect_url: input.redirectUrl }, payment_note: `StudioScrubz Invoice ${input.invoiceNumber}` }) }) as { payment_link?: { id?: string; order_id?: string; url?: string } };
  if (!body.payment_link?.id || !body.payment_link.order_id || !body.payment_link.url) throw new Error("Square did not return a complete payment link.");
  return { id: body.payment_link.id, orderId: body.payment_link.order_id, url: body.payment_link.url };
}

export async function getSquarePayment(paymentId: string): Promise<SquarePayment> {
  const body = await squareRequest(`/v2/payments/${encodeURIComponent(paymentId)}`, { method: "GET" }) as { payment?: SquarePayment };
  if (!body.payment) throw new Error("Square payment verification returned no Payment.");
  return body.payment;
}

export function verifySquareWebhookSignature(rawBody: string, signature: string | null) {
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  const notificationUrl = process.env.SQUARE_WEBHOOK_NOTIFICATION_URL;
  if (!signatureKey || !notificationUrl || !signature) return false;
  const expected = createHmac("sha256", signatureKey).update(notificationUrl + rawBody).digest("base64");
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(signature);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}
