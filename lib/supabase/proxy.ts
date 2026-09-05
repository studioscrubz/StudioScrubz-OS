import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) return response;

  const supabase = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data, error } = await supabase.auth.getClaims();
  const isLogin = request.nextUrl.pathname === "/login";
  const isPublicDocument = request.nextUrl.pathname === "/request-estimate"
    || request.nextUrl.pathname === "/api/webhooks/square"
    || request.nextUrl.pathname.startsWith("/api/public/request-estimate")
    || request.nextUrl.pathname.startsWith("/api/public/assessments/")
    || request.nextUrl.pathname.startsWith("/api/public/change-requests/")
    || request.nextUrl.pathname.startsWith("/api/public/invoices/")
    || ["/agreement/", "/assessment/", "/change-request/", "/estimate/", "/invoice/", "/proposal/"].some((prefix) => request.nextUrl.pathname.startsWith(prefix));

  if ((error || !data?.claims) && !isLogin && !isPublicDocument) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("returnTo", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}
