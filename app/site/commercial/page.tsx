import type { Metadata } from "next";
import { ContactBand, EstimateCta, FeatureList, PageHero, RelatedServices, SectionHeading } from "@/components/site/SiteSections";

export const metadata: Metadata = {
  title: { absolute: "Commercial Cleaning & Janitorial Services in Los Angeles | StudioScrubz" },
  description: "One-time and recurring commercial cleaning and janitorial services for offices, restaurants, studios, and other facilities across Los Angeles County and the San Fernando Valley.",
  alternates: { canonical: "https://studioscrubz.com/commercial" },
  openGraph: {
    title: "Commercial Cleaning & Janitorial Services in Los Angeles | StudioScrubz",
    description: "One-time and recurring commercial cleaning and janitorial services for offices, restaurants, studios, and other facilities across Los Angeles County and the San Fernando Valley.",
    url: "https://studioscrubz.com/commercial",
    siteName: "StudioScrubz",
    type: "website",
    images: [{ url: "/branding/studioscrubz-logo.png", width: 500, height: 500, alt: "StudioScrubz" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Commercial Cleaning & Janitorial Services in Los Angeles | StudioScrubz",
    description: "One-time and recurring commercial cleaning and janitorial services for offices, restaurants, studios, and other facilities across Los Angeles County and the San Fernando Valley.",
    images: ["/branding/studioscrubz-logo.png"],
  },
};

const commercialSpaces = [
  ["Office cleaning", "Professional cleaning designed for offices, reception areas, workspaces, breakrooms, restrooms, and common areas. One-time or recurring service focuses on accessible surfaces, floors, trash, high-touch areas, and a well-presented workplace."],
  ["Property management", "Flexible cleaning support for managed properties, including leasing offices, common areas, and unit turns. Plans are shaped around the property, turnover schedule, and day-to-day management needs."],
  ["Apartment communities", "Cleaning for hallways, stairwells, laundry rooms, gyms, amenity spaces, leasing areas, and other shared spaces. Coordinate unit-turn cleaning alongside shared-space care within your confirmed property plan."],
  ["Barbershop and salon cleaning", "Cleaning designed around busy personal-care spaces, with attention to floors, stations, mirrors, waiting areas, restrooms, and common surfaces. Routine cleaning addresses everyday hair and debris within the agreed service areas."],
  ["Gym and spa cleaning", "Cleaning focused on floors, mirrors, equipment-area surfaces, restrooms, locker or common areas, and frequently touched surfaces. The plan is adjusted to the facility layout, traffic, and operating schedule."],
  ["Restaurant cleaning", "Cleaning support for customer-facing and back-of-house areas, with attention to floors, surfaces, grease-prone areas, fixtures, restrooms, and high-touch points. The cleaning scope excludes specialized hood, exhaust, and regulated sanitation services."],
  ["Recording studio cleaning", "Cleaning for recording and production facilities, including control rooms, recording areas, lounges, restrooms, and floors. We plan around access and production activity; sensitive audio and production equipment servicing is excluded."],
  ["Tattoo shop and studio cleaning", "Cleaning support for reception areas, floors, restrooms, common surfaces, and general presentation. The confirmed scope complements the studio's own specialized equipment and regulated sanitation procedures rather than replacing them."],
  ["Warehouses and appropriate light industrial spaces", "Practical cleaning for suitable warehouse and light industrial areas, covering accessible floors, common areas, offices, restrooms, and general surface dust or debris. Service is confirmed after reviewing site conditions, operations, and safety requirements."],
] as const;

export default function CommercialPage(){return <>
  <PageHero eyebrow="Commercial cleaning" title="Commercial Cleaning and Janitorial Services for Your Facility." copy="StudioScrubz provides one-time and recurring commercial cleaning and janitorial services for businesses and managed properties across Los Angeles County and the San Fernando Valley. Each plan reflects the facility type, cleanable areas, traffic, access, operating schedule, priorities, and service frequency." cta="Request a Commercial Walkthrough"/>
  <section className="px-5 py-20 sm:px-8 sm:py-28"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="Spaces we support" title="Commercial facility cleaning without the one-size-fits-all plan." copy="For business owners, office managers, facility contacts, property and community managers, and operators who need a clear scope for one-time cleaning or recurring janitorial service. We shape each plan around the space, cleaning frequency, access, scheduling, and day-to-day facility needs."/><div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">{commercialSpaces.map(([space,copy])=><article id={space === "Property management" ? "property-management" : undefined} key={space} className="rounded-[1.6rem] border border-[#143d1a]/10 bg-[#f4f7f1] p-6"><h2 className="text-xl font-extrabold text-[#143d1a]">{space}</h2><p className="mt-3 text-sm leading-6 text-neutral-600">{copy}</p></article>)}</div><FeatureList items={["Recurring janitorial service","One-time and detail cleaning","Property and unit turns","Common-area cleaning","Flexible service frequency","Facility walkthroughs"]}/></div></section>
  <section className="bg-[#143d1a] px-5 py-20 text-white sm:px-8 sm:py-24"><div className="mx-auto max-w-7xl"><p className="text-xs font-extrabold uppercase tracking-[.2em] text-[#e5cd7d]">Commercial walkthroughs</p><h2 className="mt-4 max-w-4xl text-4xl font-extrabold tracking-[-.045em] sm:text-5xl">Let's walk the property before we price the clean.</h2><p className="mt-6 max-w-3xl text-lg leading-8 text-white/70">Walk through your facility with us to confirm cleanable areas, layout, traffic, access, priorities, and service frequency. We review operating considerations with your facility contact, then prepare a cleaning proposal with a clear scope for recurring service or a one-time project.</p><div className="mt-8"><EstimateCta label="Request a Commercial Walkthrough" className="bg-[#d4af37] text-[#143d1a] hover:bg-[#e5cd7d]"/></div><p className="mt-5 max-w-4xl text-sm leading-6 text-white/60">Ideal for offices, apartment communities, property managers, gyms, restaurants, barbershops and salons, recording studios, and other appropriate commercial spaces.</p></div></section>
  <section className="px-5 py-20 sm:px-8 sm:py-24"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="Service area" title="Commercial cleaning across Los Angeles and the San Fernando Valley." copy="StudioScrubz serves commercial facilities across Los Angeles County, with a strong focus on the San Fernando Valley, including Winnetka, Canoga Park, Woodland Hills, Reseda, Chatsworth, Northridge, Van Nuys, Encino, and Tarzana. Availability in surrounding areas depends on the facility, location, cleaning scope, service frequency, and scheduling."/></div></section>
  <RelatedServices links={[["Property Management Cleaning", "/property-management"], ["Property Porter Services", "/property-porter-services"], ["Post-Construction Cleaning", "/post-construction"], ["Pressure Washing", "/pressure-washing"]]}/><ContactBand title="Bring clarity to your cleaning plan."/>
</>}


