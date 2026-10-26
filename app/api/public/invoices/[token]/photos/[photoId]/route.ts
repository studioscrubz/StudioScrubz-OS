import "server-only";
import sharp from "sharp";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { OPERATIONAL_PHOTO_BUCKET } from "@/types/photo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; photoId: string }> },
) {
  const { token, photoId } = await params;
  if (token.length < 40 || token.length > 256 || !UUID_PATTERN.test(photoId)) {
    return NextResponse.json({ error: "Photo unavailable." }, { status: 404, headers: PRIVATE_HEADERS });
  }

  try {
    const admin = createSupabaseAdminClient();
    const { data: invoice, error: invoiceError } = await admin.from("invoices")
      .select("id,client_access_token_expires_at").eq("client_access_token", token).maybeSingle();
    if (invoiceError || !invoice ||
        (invoice.client_access_token_expires_at && Date.parse(invoice.client_access_token_expires_at) <= Date.now())) {
      return NextResponse.json({ error: "Photo unavailable." }, { status: 404, headers: PRIVATE_HEADERS });
    }

    // The token alone never grants access to another invoice's photos or private job evidence.
    const { data: photo, error: photoError } = await admin.from("invoice_job_photos")
      .select("storage_path").eq("id", photoId).eq("invoice_id", invoice.id)
      .eq("customer_visible", true).maybeSingle();
    if (photoError || !photo?.storage_path) {
      return NextResponse.json({ error: "Photo unavailable." }, { status: 404, headers: PRIVATE_HEADERS });
    }

    const { data: blob, error: downloadError } = await admin.storage
      .from(OPERATIONAL_PHOTO_BUCKET).download(photo.storage_path);
    if (downloadError || !blob) {
      return NextResponse.json({ error: "Photo unavailable." }, { status: 404, headers: PRIVATE_HEADERS });
    }

    // Small thumbnails print reliably on mobile instead of decoding original multi-megabyte photos.
    const thumbnail = await sharp(Buffer.from(await blob.arrayBuffer()), { limitInputPixels: 36_000_000 })
      .rotate()
      .resize({ width: 1000, height: 1000, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 78, mozjpeg: true })
      .toBuffer();

    return new Response(new Uint8Array(thumbnail), {
      status: 200,
      headers: { ...PRIVATE_HEADERS, "Content-Type": "image/jpeg", "Content-Disposition": "inline" },
    });
  } catch (error) {
    console.error("Public invoice photo thumbnail failed", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ error: "Photo unavailable." }, { status: 500, headers: PRIVATE_HEADERS });
  }
}
