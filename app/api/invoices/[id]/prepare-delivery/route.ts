import "server-only";
import { randomBytes } from "node:crypto";
import { hasPermission } from "@/lib/auth/permissions";
import { clientTokenExpiration, validClientToken } from "@/lib/secureClientToken";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/types/auth";

const SENDABLE_STATUSES = new Set(["Draft", "Open", "Sent", "Past Due", "Partially Paid"]);

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await createSupabaseServerClient();
  const { data: authData } = await session.auth.getUser();
  if (!authData.user) return Response.json({ error: "Authentication is required." }, { status: 401 });

  const { data: profileData, error: profileError } = await session.from("user_profiles").select("*").eq("id", authData.user.id).single();
  const profile = profileData as UserProfile | null;
  if (profileError || !profile?.is_active || !hasPermission(profile, "invoices.send")) {
    return Response.json({ error: "You do not have permission to send Invoices." }, { status: 403 });
  }

  const { id } = await params;
  const admin = createSupabaseAdminClient();
  const { data: invoice, error: invoiceError } = await admin.from("invoices")
    .select("id,status,archived_at,client_access_token,client_access_token_expires_at")
    .eq("id", id)
    .maybeSingle();
  if (invoiceError) return Response.json({ error: "Invoice delivery could not be prepared." }, { status: 500 });
  if (!invoice || invoice.archived_at || !SENDABLE_STATUSES.has(invoice.status)) {
    return Response.json({ error: "This Invoice is not eligible for delivery." }, { status: 409 });
  }

  const token = validClientToken(invoice.client_access_token, invoice.client_access_token_expires_at)
    ? invoice.client_access_token
    : randomBytes(32).toString("hex");
  const expiresAt = token === invoice.client_access_token
    ? invoice.client_access_token_expires_at
    : clientTokenExpiration();
  const sentAt = new Date().toISOString();
  const { data: prepared, error: updateError } = await admin.from("invoices").update({
    status: "Sent", sent_at: sentAt, client_access_token: token, client_access_token_expires_at: expiresAt,
  }).eq("id", invoice.id).select("id,client_access_token,client_access_token_expires_at").single();
  if (updateError || !prepared?.client_access_token) {
    return Response.json({ error: "Invoice delivery could not be prepared." }, { status: 500 });
  }
  return Response.json({ token: prepared.client_access_token, expiresAt: prepared.client_access_token_expires_at });
}
