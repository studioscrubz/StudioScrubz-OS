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
  ["Shared spaces", "Cleaning for lobbies, entry areas, hallways, stairwells, elevator interiors, and other high-traffic common areas that shape the everyday resident experience."],
  ["Leasing and community areas", "Care for leasing offices, community rooms, laundry rooms, fitness centers, gyms, and amenity spaces based on the property’s confirmed scope."],
  ["Unit turns", "Vacant-unit cleaning planned around turnover schedules, access, unit condition, and move-in readiness. Scope covers kitchens, bathrooms, floors, and fixtures, with cabinets and closets included when agreed."],
  ["Recurring property care", "Consistent common-area and janitorial support built around the number of buildings, cleanable square footage, property traffic, and requested service frequency."],
  ["One-time and deep cleaning", "Additional detail work for managed spaces that need a reset, seasonal attention, or deeper cleaning beyond the recurring maintenance plan."],
  ["Post-maintenance cleanup", "Dust, residue, and final-detail cleaning after maintenance or light construction, with the cleaning scope confirmed separately from repairs or trade work."],
] as const;

export default function PropertyManagementPage() {
  return <>
    <PageHero eyebrow="Property management cleaning" title="Cleaning Support Built Around Your Property." copy="Cleaning support for apartment communities and multifamily properties across Los Angeles County and the San Fernando Valley, from common areas, leasing spaces, and amenities to vacant-unit turns." cta="Request a Property Walkthrough"/>
    <section className="px-5 py-20 sm:px-8 sm:py-28"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="Managed-property support" title="Cleaning plans shaped around how your community operates." copy="For property managers, community managers, multifamily operators, apartment owners, and management companies: one cleaning relationship for shared spaces, recurring care, and unit turns. We confirm the areas, frequency, and turnover requirements around your property priorities."/><div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">{propertyAreas.map(([title,copy])=><article key={title} className="rounded-[1.6rem] border border-[#143d1a]/10 bg-[#f4f7f1] p-7"><h2 className="text-2xl font-extrabold text-[#143d1a]">{title}</h2><p className="mt-3 leading-7 text-neutral-600">{copy}</p></article>)}</div></div></section>
    <section className="bg-[#eef3ea] px-5 py-20 sm:px-8 sm:py-28"><div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-2"><SectionHeading eyebrow="Common-area cleaning" title="Support for the spaces residents and teams use every day." copy="Keep lobbies, hallways, stairwells, laundry rooms, leasing offices, community rooms, and fitness and amenity spaces ready for daily use. The plan defines floor and surface cleaning, trash and common-area cleanup, access, and site requirements."/><div><FeatureList items={["Apartment and community common areas","Lobbies, hallways, and stairwells","Leasing offices and community rooms","Laundry and amenity areas","Fitness centers and gyms","Trash and common-area cleanup"]}/><p className="mt-6 text-sm leading-6 text-neutral-500">StudioScrubz confirms included areas and service details during the walkthrough; specialized building, pool, or regulated maintenance services are not implied.</p></div></div></section>
    <section className="bg-[#143d1a] px-5 py-20 text-white sm:px-8 sm:py-24"><div className="mx-auto max-w-7xl"><p className="text-xs font-extrabold uppercase tracking-[.2em] text-[#e5cd7d]">Property walkthroughs</p><h2 className="mt-4 max-w-4xl text-4xl font-extrabold tracking-[-.045em] sm:text-5xl">Start with the buildings, schedule, and turnover needs.</h2><p className="mt-6 max-w-3xl text-lg leading-8 text-white/70">Show us the buildings and applicable cleaning areas, shared spaces, and unit-turn needs. We review access, service frequency, turnover schedules, and property priorities with you before preparing a cleaning proposal that defines the work and service expectations.</p><div className="mt-8"><EstimateCta label="Request a Property Walkthrough" className="bg-[#d4af37] text-[#143d1a] hover:bg-[#e5cd7d]"/></div></div></section>
    <RelatedServices links={[["Commercial Cleaning", "/commercial"], ["Post-Construction Cleaning", "/post-construction"], ["Contact StudioScrubz", "/contact"]]}/>
    <ContactBand title="Build a clearer property cleaning plan." copy="Tell us about your buildings, shared spaces, service frequency, and turnover needs."/>
  </>;
}
