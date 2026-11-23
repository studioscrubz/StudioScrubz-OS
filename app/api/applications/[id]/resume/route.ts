import { hasPermission } from "@/lib/auth/permissions";
import { RESUME_BUCKET } from "@/lib/recruiting/resumes";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/types/auth";

export async function GET(_request: Request, {params}: {params: Promise<{id:string}>}) {
  const session = await createSupabaseServerClient();
  const {data: {user}} = await session.auth.getUser();
  if (!user) return new Response("Sign in to download this résumé.", {status: 401});
  const {data: profile, error} = await session.from("user_profiles").select("*").eq("id", user.id).single();
  if (error || !hasPermission(profile as UserProfile | null, "jobApplications.manage"))
    return new Response("Application access denied.", {status: 403});

  const {id} = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    return new Response("Résumé not found.", {status: 404});
  const admin = createSupabaseAdminClient();
  const {data: application, error: lookupError} = await admin.from("job_applications")
    .select("id").eq("id", id).eq("opening_identifier", "scrub-tech").eq("has_resume", true).maybeSingle();
  if (lookupError) return new Response("Résumé unavailable.", {status: 503});
  if (!application) return new Response("Résumé not found.", {status: 404});
  const {data: resume, error: downloadError} = await admin.storage.from(RESUME_BUCKET).download(`${application.id}.pdf`);
  if (downloadError) return new Response("Résumé unavailable.", {status: 503});
  return new Response(resume, {headers: {
    "Content-Type": "application/pdf",
    "Content-Disposition": 'attachment; filename="resume.pdf"',
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  }});
}
