import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request, context: { params: Promise<{ id: string; fileId: string }> }) {
  try {
    const { id, fileId } = await context.params;
    const server = await createSupabaseServerClient();
    const { data: { user } } = await server.auth.getUser();
    if (!user) return Response.json({ error: "Authentication is required." }, { status: 401 });
    const { data: profile } = await server.from("user_profiles").select("role,is_active").eq("id", user.id).single();
    if (!profile?.is_active || !["Master Admin", "Administrator"].includes(profile.role)) return Response.json({ error: "Signed Agreement access denied." }, { status: 403 });

    const admin = createSupabaseAdminClient();
    const { data: file, error } = await admin.from("service_agreement_physical_files")
      .select("storage_path,original_filename")
      .eq("id", fileId)
      .eq("agreement_id", id)
      .is("archived_at", null)
      .single();
    if (error || !file) return Response.json({ error: "Signed Agreement file not found." }, { status: 404 });
    const download = new URL(request.url).searchParams.get("download") === "1";
    const { data, error: urlError } = await admin.storage.from("signed-agreements").createSignedUrl(
      file.storage_path,
      5 * 60,
      download ? { download: file.original_filename } : undefined,
    );
    if (urlError) throw new Error(urlError.message);
    return NextResponse.redirect(data.signedUrl, 307);
  } catch (cause) {
    return Response.json({ error: cause instanceof Error ? cause.message : "A secure signed Agreement link could not be created." }, { status: 400 });
  }
}
