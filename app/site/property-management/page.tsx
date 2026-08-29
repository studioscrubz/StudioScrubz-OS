import type { Metadata } from "next";
import { ContactBand, EstimateCta, FeatureList, PageHero, RelatedServices, SectionHeading } from "@/components/site/SiteSections";

export const metadata: Metadata = {
  title: { absolute: "Property Management Cleaning Los Angeles | StudioScrubz" },
  description: "Property management cleaning for apartment communities, common areas, leasing offices, amenities, and unit turns across Los Angeles County and the San Fernando Valley.",
  alternates: { canonical: "https://studioscrubz.com/property-management" },
  openGraph: {
    title: "Property Management Cleaning Los Angeles | StudioScrubz",
    description: "Flexible cleaning plans for managed apartment and multifamily properties across Los Angeles County and the San Fernando Valley.",
    url: "https://studioscrubz.com/property-management",
  },
};

const propertyAreas = [
  ["Shared spaces", "Cleaning for lobbies, entry areas, hallways, stairwells, elevators where applicable, and other high-traffic common areas that shape the everyday resident experience."],
  ["Leasing and community areas", "Care for leasing offices, community rooms, laundry rooms, fitness centers, gyms, and appropriate amenity spaces based on the property’s confirmed scope."],
  ["Unit turns", "Move-out and move-in-ready cleaning for vacant or mostly vacant units, coordinated around turnover volume, access, condition, and the next occupancy date."],
  ["Recurring property care", "Consistent common-area and janitorial support built around the number of buildings, cleanable square footage, property traffic, and requested service frequency."],
  ["One-time and deep cleaning", "Additional detail work for managed spaces that need a reset, seasonal attention, or deeper cleaning beyond the recurring maintenance plan."],
  ["Post-maintenance cleanup", "Appropriate cleanup after maintenance or light construction work can be scoped separately when dust, residue, and final-readiness cleaning are needed."],
] as const;

export default function PropertyManagementPage() {
  return <>
    <PageHero eyebrow="Property management cleaning" title="Property management cleaning built for busy communities." copy="StudioScrubz works with property managers, community managers, apartment operators, multifamily owners, and management companies across Los Angeles County and the San Fernando Valley." cta="Request a Property Walkthrough"/>
    <section className="px-5 py-20 sm:px-8 sm:py-28"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="Managed-property support" title="Cleaning plans shaped around how your community operates." copy="Apartment and multifamily properties have different traffic patterns, shared spaces, turnover schedules, and resident expectations. We review the real property before building a practical plan around its size, number of buildings, common-area square footage, service frequency, turnover volume, and property-specific requirements."/><div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">{propertyAreas.map(([title,copy])=><article key={title} className="rounded-[1.6rem] border border-[#143d1a]/10 bg-[#f4f7f1] p-7"><h2 className="text-2xl font-extrabold text-[#143d1a]">{title}</h2><p className="mt-3 leading-7 text-neutral-600">{copy}</p></article>)}</div></div></section>
    <section className="bg-[#eef3ea] px-5 py-20 sm:px-8 sm:py-28"><div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-2"><SectionHeading eyebrow="Common-area cleaning" title="Support for the spaces residents and teams use every day." copy="A confirmed property plan may include trash and common-area cleanup, floor and surface cleaning, lobbies, hallways, stairs, laundry rooms, leasing spaces, amenities, and pool-area support where appropriate. Exact tasks depend on access, surfaces, site rules, and the agreed scope."/><div><FeatureList items={["Apartment and community common areas","Lobbies, hallways, and stairwells","Leasing offices and community rooms","Laundry and appropriate amenity areas","Fitness centers and gyms","Trash and common-area cleanup"]}/><p className="mt-6 text-sm leading-6 text-neutral-500">StudioScrubz confirms included areas and service details during the walkthrough; specialized building, pool, or regulated maintenance services are not implied.</p></div></div></section>
    <section className="bg-[#143d1a] px-5 py-20 text-white sm:px-8 sm:py-24"><div className="mx-auto max-w-7xl"><p className="text-xs font-extrabold uppercase tracking-[.2em] text-[#e5cd7d]">Property walkthroughs</p><h2 className="mt-4 max-w-4xl text-4xl font-extrabold tracking-[-.045em] sm:text-5xl">Start with the buildings, schedule, and turnover needs.</h2><p className="mt-6 max-w-3xl text-lg leading-8 text-white/70">Whether you manage one apartment community or multiple properties, a walkthrough helps define priorities, recurring frequency, access, unit-turn coordination, and the cleanable areas that belong in the proposal.</p><div className="mt-8"><EstimateCta label="Get a Property Cleaning Quote" className="bg-[#d4af37] text-[#143d1a] hover:bg-[#e5cd7d]"/></div></div></section>
    <RelatedServices links={[["Commercial Cleaning", "/commercial"], ["Post-Construction Cleaning", "/post-construction"], ["Contact StudioScrubz", "/contact"]]}/>
    <ContactBand title="Build a clearer property cleaning plan." copy="Tell us about your buildings, shared spaces, service frequency, and turnover needs."/>
  </>;
}
