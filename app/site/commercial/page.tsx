import type { Metadata } from "next";
import { ContactBand, EstimateCta, PageHero, RelatedServices, SectionHeading } from "@/components/site/SiteSections";
import { ServicePageJsonLd } from "@/components/site/SeoJsonLd";

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
  ["Commercial high dusting", "Specialty dust removal for elevated, accessible commercial surfaces such as exposed beams, ceiling corners, vents and grilles, ledges, light fixtures, and overhead piping exteriors. Available as an assessed add-on or standalone project, subject to ceiling height, equipment access, surface condition, and site safety. No energized equipment, hazardous dust, or inaccessible elevated work."],
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

export default function CommercialPage(){return <><ServicePageJsonLd name="Commercial Cleaning and Janitorial Services" path="/commercial" description="One-time and recurring commercial cleaning and janitorial services for offices, restaurants, studios, and other facilities across Los Angeles County and the San Fernando Valley."/>
  <PageHero eyebrow="Commercial cleaning" title="Commercial Cleaning and Janitorial Services for Your Facility." copy="StudioScrubz provides one-time and recurring commercial cleaning and janitorial services for businesses and managed properties across Los Angeles County and the San Fernando Valley. Each plan reflects the facility type, cleanable areas, traffic, access, operating schedule, priorities, and service frequency." cta="Request a Commercial Walkthrough"/>
  <section className="px-5 py-20 sm:px-8 sm:py-28"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="Spaces we support" title="Commercial facility cleaning without the one-size-fits-all plan." copy="For business owners, office managers, facility contacts, property and community managers, and operators who need a clear scope for one-time cleaning or recurring janitorial service. We shape each plan around the space, cleaning frequency, access, scheduling, and day-to-day facility needs."/><div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">{commercialSpaces.map(([space,copy])=><article id={space === "Property management" ? "property-management" : undefined} key={space} className="rounded-[1.6rem] border border-[#143d1a]/10 bg-[#f4f7f1] p-6"><h2 className="text-xl font-extrabold text-[#143d1a]">{space}</h2><p className="mt-3 text-sm leading-6 text-neutral-600">{copy}</p></article>)}</div><aside aria-label="Commercial service highlights" className="mt-8 rounded-[1.6rem] border border-[#143d1a]/10 bg-[#f4f7f1] p-6"><h2 className="text-xl font-extrabold text-[#143d1a]">Service Highlights</h2><ul className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 text-sm leading-6 text-neutral-700">{["Recurring janitorial service","Commercial high dusting by assessment","One-time and detail cleaning","Property and unit turns","Common-area cleaning","Flexible service frequency","Facility walkthroughs"].map(item=><li key={item} className="flex gap-2"><span aria-hidden="true" className="font-bold text-[#d4af37]">✦</span><span>{item}</span></li>)}</ul></aside></div></section>
  <div className="px-5 pb-20 pt-4 sm:px-8 sm:pb-24 sm:pt-6"><div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-2 lg:items-stretch">
  <section aria-labelledby="commercial-project-title" className="min-w-0">
    <div className="h-full overflow-hidden rounded-[2rem] border border-[#143d1a]/10 bg-[#f4f7f1]">
      <div className="flex h-full flex-col gap-6 p-6 sm:p-8">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[.2em] text-[#34734a]">Featured Commercial Project</p>
          <h2 id="commercial-project-title" className="mt-4 text-2xl font-extrabold leading-tight tracking-[-.035em] text-[#143d1a] sm:text-3xl">Starbucks — Commercial High-Dusting Services</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px] sm:items-center">
          <dl className="grid gap-4 text-sm grid-cols-1">
            <div><dt className="font-bold text-neutral-500">Locations Serviced</dt><dd className="mt-1 text-lg font-extrabold text-[#143d1a]">2</dd></div>
            <div><dt className="font-bold text-neutral-500">Service Type</dt><dd className="mt-1 font-bold text-[#143d1a]">Commercial High Dusting</dd></div>
            <div><dt className="font-bold text-neutral-500">Project Arrangement</dt><dd className="mt-1 font-bold text-[#143d1a]">LJ Facility Services Subcontract</dd></div>
          </dl>
        <div className="flex min-h-40 flex-col items-center justify-center rounded-[1.6rem] bg-white px-4 py-5">
          <img src="https://upload.wikimedia.org/wikipedia/en/d/d3/Starbucks_Corporation_Logo_2011.svg" width="185" height="185" alt="Starbucks logo" loading="lazy" decoding="async" className="aspect-square w-full max-w-[185px] object-contain" />
        </div>
          </div>
          <p className="mt-7 max-w-3xl text-base leading-8 text-neutral-700">StudioScrubz successfully completed high-dusting assignments at two Starbucks locations, addressing accessible elevated surfaces, ceiling vents, fixtures, and other designated areas in accordance with the approved scope of work.</p>
          <p className="mt-4 max-w-3xl text-base leading-8 text-neutral-700">Our experience supporting commercial facility service providers demonstrates our ability to deliver specialized cleaning services in active business environments.</p>
          <p className="mt-5 text-xs leading-5 text-neutral-500">This work was completed as a facility services subcontract. Reference to Starbucks identifies the serviced locations and does not imply endorsement or a direct contract with Starbucks.</p>
        </div>
      </div>
    </div>
  </section>
  <section aria-labelledby="wam-project-title" className="min-w-0">
    <div className="h-full overflow-hidden rounded-[2rem] border border-[#143d1a]/10 bg-white shadow-[0_12px_40px_rgba(20,61,26,.06)]">
      <div className="flex h-full flex-col gap-6 p-6 sm:p-8">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[.2em] text-[#34734a]">Featured Commercial Project</p>
          <h2 id="wam-project-title" className="mt-4 text-2xl font-extrabold leading-tight tracking-[-.035em] text-[#143d1a] sm:text-3xl">Women&apos;s Audio Mission Academy — Commercial Cleaning</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px] sm:items-center">
          <dl className="grid gap-4 text-sm grid-cols-1">
            <div><dt className="font-bold text-neutral-500">Service Type</dt><dd className="mt-1 font-bold text-[#143d1a]">Commercial Cleaning</dd></div>
            <div><dt className="font-bold text-neutral-500">Specialty Detail</dt><dd className="mt-1 font-bold text-[#143d1a]">Refrigerator Detailing</dd></div>
          </dl>
        <div className="flex min-h-40 flex-col items-center justify-center rounded-[1.6rem] bg-[#f4f7f1] px-4 py-5">
          <div aria-label="Women’s Audio Mission Academy project" className="flex size-40 flex-col items-center justify-center rounded-full border-[10px] border-[#e93431] bg-white px-4 text-center shadow-[inset_0_0_0_5px_#141414]"><span className="text-[10px] font-black uppercase tracking-[.12em] text-[#141414]">Women&apos;s Audio Mission</span><span className="mt-2 text-4xl font-black tracking-[-.08em] text-[#e93431]">WAM</span><span className="mt-2 text-xs font-black uppercase tracking-[.18em] text-[#141414]">Academy</span></div>
          
        </div>
          </div>
          <p className="mt-7 max-w-3xl text-base leading-8 text-neutral-700">StudioScrubz provided commercial cleaning services for Women&apos;s Audio Mission Academy, including detailed refrigerator cleaning as part of the service scope.</p>
          <p className="mt-4 max-w-3xl text-base leading-8 text-neutral-700">From everyday facility upkeep to focused detail work, our commercial cleaning services are tailored to the needs of each space.</p>
          <p className="mt-5 text-xs leading-5 text-neutral-500">StudioScrubz provided these services directly to Women&apos;s Audio Mission Academy. Project reference does not imply a public endorsement.</p>
        </div>
      </div>
    </div>
  </section>
  </div></div>
  <section className="bg-[#143d1a] px-5 py-20 text-white sm:px-8 sm:py-24"><div className="mx-auto max-w-7xl"><p className="text-xs font-extrabold uppercase tracking-[.2em] text-[#e5cd7d]">Commercial walkthroughs</p><h2 className="mt-4 max-w-4xl text-4xl font-extrabold tracking-[-.045em] sm:text-5xl">Let&apos;s walk the property before we price the clean.</h2><p className="mt-6 max-w-3xl text-lg leading-8 text-white/70">Walk through your facility with us to confirm cleanable areas, layout, traffic, access, priorities, and service frequency. We review operating considerations with your facility contact, then prepare a cleaning proposal with a clear scope for recurring service or a one-time project.</p><div className="mt-8"><EstimateCta label="Request a Commercial Walkthrough" className="bg-[#d4af37] text-[#143d1a] hover:bg-[#e5cd7d]"/></div><p className="mt-5 max-w-4xl text-sm leading-6 text-white/60">Ideal for offices, apartment communities, property managers, gyms, restaurants, barbershops and salons, recording studios, and other appropriate commercial spaces.</p></div></section>
  <section className="px-5 py-20 sm:px-8 sm:py-24"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="Service area" title="Commercial cleaning across Los Angeles and the San Fernando Valley." copy="StudioScrubz serves commercial facilities across Los Angeles County, with a strong focus on the San Fernando Valley, including Winnetka, Canoga Park, Woodland Hills, Reseda, Chatsworth, Northridge, Van Nuys, Encino, and Tarzana. Availability in surrounding areas depends on the facility, location, cleaning scope, service frequency, and scheduling."/></div></section>
  <section className="px-5 py-16 sm:px-8"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="Janitorial service planning" title="Recurring commercial cleaning starts with a clear facility scope." copy="Offices, managed buildings, gyms, and other facilities have different cleaning needs. We use the walkthrough to define service areas, frequency, access, and operational priorities."/><div className="mt-8 grid gap-6 md:grid-cols-2"><div><h3 className="text-xl font-extrabold text-[#143d1a]">Can commercial cleaning be scheduled regularly?</h3><p className="mt-3 leading-7 text-neutral-600">Yes. Recurring janitorial plans are available, with the visit frequency and cleaning checklist confirmed for the facility. One-time detail cleaning can be scoped separately.</p></div><div><h3 className="text-xl font-extrabold text-[#143d1a]">What affects a commercial cleaning proposal?</h3><p className="mt-3 leading-7 text-neutral-600">Cleanable square footage, facility type, traffic, restrooms, floors, elevated dusting needs and safe access, high-touch areas, supplies, access windows, and requested service frequency help determine the proposed scope and pricing.</p></div></div></div></section>
  <RelatedServices links={[["Property Management Cleaning", "/property-management"], ["Property Porter Services", "/property-porter-services"], ["Post-Construction Cleaning", "/post-construction"], ["Pressure Washing", "/pressure-washing"]]}/><ContactBand title="Bring clarity to your cleaning plan."/>
</>}


