import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const hostname = (request.headers.get("host") ?? request.nextUrl.hostname).split(":")[0].toLowerCase();
  const pathname = request.nextUrl.pathname;
  if (hostname === "www.studioscrubz.com") {
    const canonical = request.nextUrl.clone();
    canonical.hostname = "studioscrubz.com";
    canonical.port = "";
    canonical.protocol = "https";
    return NextResponse.redirect(canonical, 308);
  }
  if (hostname === "estimate.studioscrubz.com" && request.nextUrl.pathname === "/") {
    return NextResponse.rewrite(new URL("/request-estimate", request.url));
  }
  if (hostname === "studioscrubz.com") {
    if (pathname === "/robots.txt" || pathname === "/sitemap.xml") return NextResponse.next();
    const publicDocument = pathname.startsWith("/api/public/")
      || ["/agreement/", "/estimate/", "/invoice/", "/proposal/"].some((prefix) => pathname.startsWith(prefix));
    if (publicDocument) return updateSession(request);
    const marketingPaths = new Set(["/", "/residential", "/commercial", "/property-management", "/airbnb-cleaning", "/post-construction", "/pressure-washing", "/about", "/contact"]);
    if (marketingPaths.has(pathname)) {
      const destination = request.nextUrl.clone();
      destination.pathname = pathname === "/" ? "/site" : `/site${pathname}`;
      return NextResponse.rewrite(destination);
    }
    return NextResponse.rewrite(new URL("/site/not-found", request.url), { status: 404 });
  }
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest\\.webmanifest|sw\\.js|offline\\.html|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
