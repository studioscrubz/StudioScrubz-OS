import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const hostname = (request.headers.get("host") ?? request.nextUrl.hostname).split(":")[0].toLowerCase();
  const pathname = request.nextUrl.pathname;
  // The external partner hostname is a separate public entry point to the
  // existing contractor components. Never expose employee pages on this host.
  if (hostname === "partners.studioscrubz.com") {
    if (pathname === "/" || pathname === "/login") {
      const destination = request.nextUrl.clone();
      destination.pathname = "/contractor/login";
      return NextResponse.rewrite(destination);
    }
    if (pathname === "/activate" || pathname === "/reset-password") {
      const destination = request.nextUrl.clone();
      destination.pathname = `/contractor${pathname}`;
      return NextResponse.rewrite(destination);
    }
    if (["/contractor/login", "/contractor/activate", "/contractor/reset-password"].includes(pathname)) {
      return NextResponse.next();
    }
    if (pathname === "/contractor" || pathname === "/contractor/") return updateSession(request);
    // All contractor APIs enforce authorization and company isolation in their handlers.
    if (pathname.startsWith("/api/contractors/") || pathname === "/api/contractors") return NextResponse.next();
    return new NextResponse("Not Found", { status: 404 });
  }
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
      || pathname.startsWith("/internal-event/rsvp/")
      || ["/agreement/", "/estimate/", "/invoice/", "/proposal/"].some((prefix) => pathname.startsWith(prefix));
    if (publicDocument) return updateSession(request);
    const marketingPaths = new Set(["/", "/residential", "/commercial", "/property-management", "/property-porter-services", "/luxury-property-care", "/airbnb-cleaning", "/post-construction", "/pressure-washing", "/about", "/contact", "/careers"]);
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
