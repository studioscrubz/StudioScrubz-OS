import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { getPublicBusinessContact } from "@/lib/services/publicBusinessSettings";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  metadataBase: new URL("https://studioscrubz.com"),
  applicationName: "StudioScrubz",
  manifest: null,
  title: { default: "StudioScrubz | Residential & Commercial Cleaning", template: "%s | StudioScrubz" },
  description: "Residential cleaning, commercial cleaning, post-construction cleaning, and pressure washing in the Los Angeles area.",
  keywords: ["residential cleaning", "commercial cleaning", "property management cleaning", "post-construction cleaning", "San Fernando Valley cleaning", "Los Angeles cleaning"],
  alternates: { canonical: "https://studioscrubz.com" },
  robots: { index: true, follow: true },
  openGraph: { type: "website", siteName: "StudioScrubz", title: "StudioScrubz | Residential & Commercial Cleaning", description: "Professional residential and commercial cleaning across the Los Angeles area.", url: "https://studioscrubz.com", images: [{ url: "/branding/studioscrubz-logo.png", width: 500, height: 500, alt: "StudioScrubz" }] },
  twitter: { card: "summary_large_image", title: "StudioScrubz | Residential & Commercial Cleaning", description: "Professional residential and commercial cleaning across the Los Angeles area.", images: ["/branding/studioscrubz-logo.png"] },
};

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const contact = await getPublicBusinessContact();
  return <div className="min-h-screen bg-[#fbfcf9] text-[#18201a]"><SiteHeader phone={contact.phone}/><main>{children}</main><SiteFooter businessName={contact.businessName} phone={contact.phone} email={contact.email}/></div>;
}
