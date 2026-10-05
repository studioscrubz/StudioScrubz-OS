import { NextResponse } from "next/server";
import {
  newAssessmentToken,
  hashAssessmentToken,
  ASSESSMENT_PHOTO_TOKEN_DAYS,
} from "@/lib/assessmentPhotoAccess";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getPublicSiteUrl } from "@/lib/publicSiteUrl";

const ALLOWED_ROLES = ["Master Admin", "Administrator", "Manager", "Sales"];

async function authorizePhotoSubmissionAccess(id: string) {
  const server = await createSupabaseServerClient();

  const {
    data: { user },
  } = await server.auth.getUser();

  if (!user) {
    return {
      error: NextResponse.json(
        { error: "Sign in required." },
        { status: 401 },
      ),
    };
  }

  const admin = createSupabaseAdminClient();

  const { data: profile } = await admin
    .from("user_profiles")
    .select("role,is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (
    !profile?.is_active ||
    !ALLOWED_ROLES.includes(profile.role)
  ) {
    return {
      error: NextResponse.json(
        { error: "Photo submission access denied." },
        { status: 403 },
      ),
    };
  }

  const { data: walkthrough } = await server
    .from("walkthroughs")
    .select("id,measurements")
    .eq("id", id)
    .maybeSingle();

  if (!walkthrough) {
    return {
      error: NextResponse.json(
        { error: "Assessment unavailable." },
        { status: 404 },
      ),
    };
  }

  return {
    admin,
    user,
    walkthrough,
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await authorizePhotoSubmissionAccess(id);

  if ("error" in access) {
    return access.error;
  }

  const { admin } = access;

  const { data: existing, error } = await admin
    .from("assessment_photo_access")
    .select("token_value,expires_at,submitted_at")
    .eq("walkthrough_id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "Photo submission link could not be loaded." },
      { status: 500 },
    );
  }

  if (
    !existing?.token_value ||
    !existing.expires_at ||
    Date.parse(existing.expires_at) <= Date.now()
  ) {
    return NextResponse.json(
      {
        url: null,
        expiresAt: existing?.expires_at ?? null,
        submittedAt: existing?.submitted_at ?? null,
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    );
  }

  return NextResponse.json(
    {
      url: `${getPublicSiteUrl()}/assessment/${existing.token_value}`,
      expiresAt: existing.expires_at,
      submittedAt: existing.submitted_at ?? null,
      reused: true,
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    },
  );
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await authorizePhotoSubmissionAccess(id);

  if ("error" in access) {
    return access.error;
  }

  const { admin, user, walkthrough } = access;

  const { data: existing } = await admin
    .from("assessment_photo_access")
    .select("token_value,expires_at,submitted_at")
    .eq("walkthrough_id", id)
    .maybeSingle();

  if (
    existing?.token_value &&
    existing.expires_at &&
    Date.parse(existing.expires_at) > Date.now()
  ) {
    return NextResponse.json(
      {
        url: `${getPublicSiteUrl()}/assessment/${existing.token_value}`,
        expiresAt: existing.expires_at,
        reused: true,
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    );
  }

  const token = newAssessmentToken();

  const expiresAt = new Date(
    Date.now() + ASSESSMENT_PHOTO_TOKEN_DAYS * 86400000,
  ).toISOString();

  const { error } = await admin
    .from("assessment_photo_access")
    .upsert(
      {
        walkthrough_id: id,
        token_hash: hashAssessmentToken(token),
        token_value: token,
        expires_at: expiresAt,
        submitted_at: existing?.submitted_at ?? null,
        created_by: user.id,
      },
      {
        onConflict: "walkthrough_id",
      },
    );

  if (error) {
    return NextResponse.json(
      { error: "Photo submission link could not be created." },
      { status: 500 },
    );
  }

  const measurements = {
    ...(walkthrough.measurements as Record<string, unknown>),
    assessmentMethod: "Customer Photo Submission",
    photoSubmissionStatus: "Sent",
  };

  await admin
    .from("walkthroughs")
    .update({
      measurements,
      sales_stage: existing?.submitted_at
        ? "Assessment In Progress"
        : "Awaiting Customer Photos",
    })
    .eq("id", id);

  return NextResponse.json(
    {
      url: `${getPublicSiteUrl()}/assessment/${token}`,
      expiresAt,
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    },
  );
}