import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const hostname = (request.headers.get("host") ?? request.nextUrl.hostname).split(":")[0].toLowerCase();
  if (hostname === "estimate.studioscrubz.com" && request.nextUrl.pathname === "/") {
    return NextResponse.rewrite(new URL("/request-estimate", request.url));
  }
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest\\.webmanifest|sw\\.js|offline\\.html|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
