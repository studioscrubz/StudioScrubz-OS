import type { Metadata } from "next";
import { ContactBand, FeatureList, PageHero, RelatedServices, SectionHeading } from "@/components/site/SiteSections";
import { ServicePageJsonLd } from "@/components/site/SeoJsonLd";

export const metadata: Metadata = {
  title: { absolute: "Pressure Washing in Los Angeles | StudioScrubz" },
  description: "Residential, commercial, and managed-property pressure washing for suitable concrete, driveways, walkways, patios, entries, and common areas across Los Angeles County and the San Fernando Valley.",
  alternates: { canonical: "https://studioscrubz.com/pressure-washing" },
  openGraph: {
    title: "Pressure Washing in Los Angeles | StudioScrubz",
    description: "Residential, commercial, and managed-property pressure washing for suitable concrete, driveways, walkways, patios, entries, and common areas across Los Angeles County and the San Fernando Valley.",
    url: "https://studioscrubz.com/pressure-washing",
    siteName: "StudioScrubz",
    type: "website",
    images: [{ url: "/branding/studioscrubz-logo.png", width: 500, height: 500, alt: "StudioScrubz" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Pressure Washing in Los Angeles | StudioScrubz",
    description: "Residential, commercial, and managed-property pressure washing for suitable concrete, driveways, walkways, patios, entries, and common areas across Los Angeles County and the San Fernando Valley.",
    images: ["/branding/studioscrubz-logo.png"],
  },
};

export default function PressureWashingPage(){return <><ServicePageJsonLd name="Pressure Washing" path="/pressure-washing" description="Residential, commercial, and managed-property pressure washing for suitable exterior hard surfaces across Los Angeles County and the San Fernando Valley."/>
  <PageHero eyebrow="Pressure washing" title="Pressure Washing and Exterior Cleaning for Your Property." copy="StudioScrubz provides pressure washing and exterior cleaning for suitable hard surfaces at homes, businesses, apartment and multifamily communities, and other managed properties across Los Angeles County and the San Fernando Valley. Service areas can include concrete, driveways, walkways, patios, entries, and shared exterior spaces when appropriate for the surface and condition." cta="Request a Pressure Washing Estimate"/>
  <section className="px-5 py-20 sm:px-8 sm:py-28"><div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-2"><SectionHeading eyebrow="Exterior surfaces" title="Pressure washing for suitable outdoor hard surfaces." copy="Clean surface dirt and buildup from suitable concrete, walkways, patios, entry areas, driveways, and property common areas. We review the surface material, condition, area size, access, buildup, water availability, surrounding spaces, and property needs before confirming the scope. Not every surface is suitable for pressure washing, and cleaning results depend on the material and condition."/><FeatureList items={["Suitable concrete surfaces","Walkways and patios","Suitable driveways","Property common areas","Storefront and entry areas","Residential, commercial, and managed properties"]}/></div></section>
  <section className="bg-[#eef3ea] px-5 py-20 sm:px-8 sm:py-28"><div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-2"><SectionHeading eyebrow="Plan the exterior clean" title="Confirm the surfaces. Coordinate the service." copy="Tell us which exterior areas need cleaning and share the surface material, condition, size, buildup, access details, and property priorities. We review suitability, confirm the cleaning scope, and provide a professional estimate. Once service details are agreed, we coordinate scheduling and complete the cleaning with a final service review."/><FeatureList items={["Surface and condition review","Access and water availability confirmed","Clear scope and professional estimate","Coordinated scheduling","Professional communication","Final service review"]}/></div></section>
  <section className="px-5 py-20 sm:px-8 sm:py-24"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="Service area" title="Pressure washing across Los Angeles and the San Fernando Valley." copy="StudioScrubz provides exterior cleaning across Los Angeles County, with a strong focus on the San Fernando Valley, including Winnetka, Canoga Park, Woodland Hills, Reseda, Chatsworth, Northridge, Van Nuys, Encino, and Tarzana. Availability in surrounding areas depends on the property location, surface suitability, cleaning scope, access, and scheduling."/></div></section>
  <RelatedServices links={[["Residential Cleaning", "/residential"], ["Commercial Cleaning", "/commercial"], ["Property Management Cleaning", "/property-management"], ["Post-Construction Cleaning", "/post-construction"]]}/><ContactBand title="Give the outside a cleaner first impression."/>
</>}
