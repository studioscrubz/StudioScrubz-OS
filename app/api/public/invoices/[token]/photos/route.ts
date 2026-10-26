import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (token.length < 40) return NextResponse.json({ error: "Invoice unavailable." }, { status: 404 });
  const admin = createSupabaseAdminClient();
  const { data: invoice, error: invoiceError } = await admin.from("invoices").select("id,client_access_token_expires_at").eq("client_access_token", token).maybeSingle();
  if (invoiceError) return NextResponse.json({ error: "Invoice photos could not be loaded." }, { status: 500 });
  if (!invoice || (invoice.client_access_token_expires_at && Date.parse(invoice.client_access_token_expires_at) <= Date.now())) return NextResponse.json({ error: "Invoice unavailable." }, { status: 404 });
  const { data, error } = await admin.from("invoice_job_photos").select("id,caption,original_filename,uploaded_at").eq("invoice_id", invoice.id).eq("customer_visible", true).order("uploaded_at");
  if (error) return NextResponse.json({ error: "Invoice photos could not be loaded." }, { status: 500 });
  if (!data?.length) return NextResponse.json({ photos: [] }, { headers: { "Cache-Control": "private, no-store" } });
  return NextResponse.json({ photos: data.map((photo) => ({
    id: photo.id,
    caption: photo.caption,
    originalFilename: photo.original_filename,
    uploadedAt: photo.uploaded_at,
    url: `/api/public/invoices/${encodeURIComponent(token)}/photos/${encodeURIComponent(photo.id)}`,
  })) }, { headers: { "Cache-Control": "private, no-store" } });
}
