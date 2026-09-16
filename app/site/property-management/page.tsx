import type { Metadata } from "next";
import Link from "next/link";
import { ContactBand, EstimateCta, FeatureList, PageHero, RelatedServices, SectionHeading } from "@/components/site/SiteSections";

export const metadata: Metadata = {
  title: { absolute: "Property Management Cleaning in Los Angeles | StudioScrubz" },
  description: "Property management cleaning for apartment and multifamily communities, common areas, recurring service, and unit turns across Los Angeles County and the San Fernando Valley.",
  alternates: { canonical: "https://studioscrubz.com/property-management" },
  openGraph: {
    title: "Property Management Cleaning in Los Angeles | StudioScrubz",
    description: "Property management cleaning for apartment and multifamily communities, common areas, recurring service, and unit turns across Los Angeles County and the San Fernando Valley.",
    url: "https://studioscrubz.com/property-management",
    siteName: "StudioScrubz",
    type: "website",
    images: [{ url: "/branding/studioscrubz-logo.png", width: 500, height: 500, alt: "StudioScrubz" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Property Management Cleaning in Los Angeles | StudioScrubz",
    description: "Property management cleaning for apartment and multifamily communities, common areas, recurring service, and unit turns across Los Angeles County and the San Fernando Valley.",
    images: ["/branding/studioscrubz-logo.png"],
  },
};

const propertyAreas = [
  ["Shared spaces", "Cleaning for lobbies, entry areas, hallways, stairwells, elevator interiors, and other high-traffic common areas that shape the everyday resident experience."],
  ["Leasing and community areas", "Care for leasing offices, community rooms, laundry rooms, fitness centers, gyms, and amenity spaces based on the property’s confirmed scope."],
  ["Unit turns", "Vacant-unit cleaning planned around turnover schedules, access, unit condition, and move-in readiness. Scope covers kitchens, bathrooms, floors, and fixtures, with cabinets and closets included when agreed."],
  ["Recurring property care", "Consistent common-area and janitorial support built around the number of buildings, cleanable square footage, property traffic, and requested service frequency."],
  ["One-time and deep cleaning", "Additional detail work for managed spaces that need a reset, seasonal attention, or deeper cleaning beyond the recurring maintenance plan."],
  ["Post-maintenance cleanup", "Dust, residue, and final-detail cleaning after maintenance or light construction, with the cleaning scope confirmed separately from repairs or trade work."],
] as const;

export default function PropertyManagementPage() {
  return <>
    <PageHero eyebrow="Property management cleaning" title="Property Management Cleaning Built Around Your Community." copy="StudioScrubz provides apartment community and multifamily property cleaning across Los Angeles County and the San Fernando Valley. We help property managers coordinate recurring common-area cleaning, leasing and amenity-space care, and vacant-unit turns around each property's schedule and priorities." cta="Request a Property Walkthrough"/>
    <section className="px-5 py-20 sm:px-8 sm:py-28"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="Managed-property support" title="Cleaning plans shaped around how your community operates." copy="For property managers, community managers, multifamily operators, apartment owners, and management companies: a clear property-specific scope for shared spaces, recurring janitorial support, and unit-turn cleaning. We confirm service areas, frequency, access, communication needs, and turnover requirements around your property priorities."/><div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">{propertyAreas.map(([title,copy])=><article key={title} className="rounded-[1.6rem] border border-[#143d1a]/10 bg-[#f4f7f1] p-7"><h2 className="text-2xl font-extrabold text-[#143d1a]">{title}</h2><p className="mt-3 leading-7 text-neutral-600">{copy}</p></article>)}</div></div></section>
    <section aria-labelledby="porter-services-heading" className="px-5 pb-20 sm:px-8 sm:pb-28">
      <div className="mx-auto grid max-w-7xl gap-8 rounded-[2rem] bg-[#143d1a] p-8 text-white sm:p-12 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <h2 id="porter-services-heading" className="text-xl font-extrabold text-[#e5cd7d]">Property Porter Services</h2>
          <p className="mt-4 max-w-3xl text-3xl font-extrabold tracking-[-.045em] sm:text-4xl">Reliable property upkeep. Consistent eyes on your property.</p>
          <p className="mt-5 max-w-3xl leading-7 text-white/70">Properties that need scheduled ongoing upkeep beyond cleaning can also consider Property Porter Services, which combine visual condition checks, photo documentation, and property issue reporting to help keep management informed.</p>
        </div>
        <Link href="/property-porter-services" className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#d4af37] px-6 py-3 text-center text-sm font-extrabold text-[#143d1a] transition hover:bg-[#e5cd7d]">Explore Property Porter Services</Link>
      </div>
    </section>
    <section className="bg-[#eef3ea] px-5 py-20 sm:px-8 sm:py-28"><div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-2"><SectionHeading eyebrow="Common-area cleaning" title="Support for the spaces residents and teams use every day." copy="Keep lobbies, hallways, stairwells, laundry rooms, leasing offices, community rooms, and fitness and amenity spaces ready for daily use. The plan defines floor and surface cleaning, trash and common-area cleanup, access, and site requirements."/><div><FeatureList items={["Apartment and community common areas","Lobbies, hallways, and stairwells","Leasing offices and community rooms","Laundry and amenity areas","Fitness centers and gyms","Trash and common-area cleanup"]}/><p className="mt-6 text-sm leading-6 text-neutral-500">StudioScrubz confirms included areas and service details during the walkthrough; specialized building, pool, or regulated maintenance services are not implied.</p></div></div></section>
    <section className="bg-[#143d1a] px-5 py-20 text-white sm:px-8 sm:py-24"><div className="mx-auto max-w-7xl"><p className="text-xs font-extrabold uppercase tracking-[.2em] text-[#e5cd7d]">Property walkthroughs</p><h2 className="mt-4 max-w-4xl text-4xl font-extrabold tracking-[-.045em] sm:text-5xl">Start with the buildings, schedule, and turnover needs.</h2><p className="mt-6 max-w-3xl text-lg leading-8 text-white/70">Show us the buildings and applicable cleaning areas, shared spaces, and unit-turn needs. We review access, service frequency, turnover schedules, and property priorities with you before preparing a cleaning proposal that defines the work and service expectations.</p><div className="mt-8"><EstimateCta label="Request a Property Walkthrough" className="bg-[#d4af37] text-[#143d1a] hover:bg-[#e5cd7d]"/></div></div></section>
    <section className="px-5 py-20 sm:px-8 sm:py-24"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="Service area" title="Property management cleaning across Los Angeles and the San Fernando Valley." copy="StudioScrubz serves managed properties across Los Angeles County, with a strong focus on the San Fernando Valley, including Winnetka, Canoga Park, Woodland Hills, Reseda, Chatsworth, Northridge, Van Nuys, Encino, and Tarzana. Availability in surrounding areas depends on the property's needs, location, service frequency, and scheduling."/></div></section>
    <RelatedServices links={[["Commercial Cleaning", "/commercial"], ["Post-Construction Cleaning", "/post-construction"], ["Contact StudioScrubz", "/contact"]]}/>
    <ContactBand title="Build a clearer property cleaning plan." copy="Tell us about your buildings, shared spaces, service frequency, and turnover needs."/>
  </>;
}
