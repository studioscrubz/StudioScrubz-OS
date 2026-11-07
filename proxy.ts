import { NextResponse, type NextRequest } from "next/server";
import { isPartnerHost, PARTNER_HOST } from "@/lib/contractors/host";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const hostname = (request.headers.get("host") ?? request.nextUrl.hostname).split(":")[0].toLowerCase();
  const pathname = request.nextUrl.pathname;
  if (isPartnerHost(hostname)) {
    const destination = request.nextUrl.clone();
    if (pathname === "/") return updateSession(request, { partnerEntry: true });
    if (["/login", "/activate", "/reset-password"].includes(pathname)) {
      destination.pathname = `/contractor${pathname}`;
      const response = NextResponse.rewrite(destination);
      response.headers.set("Referrer-Policy", "no-referrer");
      return response;
    }
    if (["/contractor", "/contractor/", "/contractor/login", "/contractor/activate", "/contractor/reset-password",
      "/api/contractors", "/api/contractors/session", "/api/contractors/invitations", "/api/contractors/files", "/api/contractors/completion-photos"].includes(pathname)) {
      const response = NextResponse.next();
      response.headers.set("Referrer-Policy", "no-referrer");
      return response;
    }
    if (pathname.startsWith("/_next/static/") || pathname.startsWith("/branding/") || pathname === "/favicon.ico"
      || (pathname === "/_next/image" && request.nextUrl.searchParams.get("url") === "/branding/studioscrubz-logo.png")) {
      return NextResponse.next();
    }
    return new NextResponse("Not Found", { status: 404 });
  }
  if (hostname === "app.studioscrubz.com" && ["/contractor", "/contractor/login", "/contractor/activate", "/contractor/reset-password"].includes(pathname)) {
    const destination = new URL(request.nextUrl.pathname.slice("/contractor".length) || "/", `https://${PARTNER_HOST}`);
    destination.search = request.nextUrl.search;
    return NextResponse.redirect(destination);
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
  matcher: [{ source: "/:path*", has: [{ type: "host", value: "partners.studioscrubz.com" }] }, "/((?!_next/static|_next/image|favicon.ico|manifest\\.webmanifest|sw\\.js|offline\\.html|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
