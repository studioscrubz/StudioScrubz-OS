import type { Metadata } from "next";
import { EstimateCta, FeatureList, PageHero, RelatedServices, SectionHeading } from "@/components/site/SiteSections";

export const metadata: Metadata = {
  title: { absolute: "Property Porter Services Los Angeles | StudioScrubz" },
  description: "Recurring property and apartment porter services across the San Fernando Valley and Los Angeles area. Common-area upkeep, condition checks, photo documentation, and issue reporting.",
  alternates: { canonical: "https://studioscrubz.com/property-porter-services" },
  openGraph: {
    title: "Property Porter Services Los Angeles | StudioScrubz",
    description: "Scheduled property upkeep and consistent eyes on your property, with service plans shaped around management’s needs.",
    url: "https://studioscrubz.com/property-porter-services",
  },
};

const steps = [
  ["Clean", "Complete scheduled upkeep in the agreed common areas, keeping everyday presentation in focus."],
  ["Check", "Make visual observations of property conditions while working through the service areas."],
  ["Document", "Use photo documentation to give management context for observed conditions and issues."],
  ["Report", "Share maintenance and safety concerns with the designated property contact for review and follow-up."],
] as const;

const responsibilities = [
  "Common-area upkeep",
  "Grounds and litter patrol",
  "Trash-area maintenance and tidying, limited to cleaning",
  "Entryway and walkway upkeep",
  "Laundry and mail-area upkeep",
  "High-touch surface cleaning",
  "Pool-area tidying — not licensed pool maintenance",
  "Property condition checks through visual observations",
  "Photo documentation",
  "Maintenance issue reporting",
  "Safety issue reporting",
  "Pre-tour and pre-inspection presentation checks",
] as const;

export default function PropertyPorterServicesPage() {
  return <>
    <PageHero eyebrow="Property Porter Services" title="Reliable property upkeep. Consistent eyes on your property." copy="We don’t just clean your property. We help you stay on top of it." cta="Request a Porter Service Walkthrough"/>

    <section className="px-5 py-20 sm:px-8 sm:py-28">
      <div className="mx-auto max-w-7xl">
        <SectionHeading eyebrow="Ongoing property support" title="Everyday upkeep with management in the loop." copy="StudioScrubz Property Porter Services combines scheduled property upkeep with consistent eyes on common areas. For apartment communities and managed commercial properties across the San Fernando Valley and Los Angeles area, our visits pair property management cleaning with visual condition checks, documentation, and issue reporting."/>
        <p className="mt-6 max-w-3xl leading-7 text-neutral-600">Apartment porter services support the spaces residents, visitors, and onsite teams share. The focus is recurring care between larger cleaning visits, with observations that help management decide what needs attention.</p>
      </div>
    </section>

    <section className="bg-[#eef3ea] px-5 py-20 sm:px-8 sm:py-28">
      <div className="mx-auto max-w-7xl">
        <SectionHeading eyebrow="How it works" title="Clean → Check → Document → Report" copy="A clear routine for upkeep and communication, with service areas and reporting expectations agreed before work begins."/>
        <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {steps.map(([title, copy], index) => <article key={title} className="rounded-[1.6rem] border border-[#143d1a]/10 bg-white p-7">
            <span className="grid size-11 place-items-center rounded-full bg-[#edf4e9] text-sm font-black text-[#9a7a17]">0{index + 1}</span>
            <h3 className="mt-6 text-2xl font-extrabold text-[#143d1a]">{title}</h3>
            <p className="mt-3 leading-7 text-neutral-600">{copy}</p>
          </article>)}
        </div>
      </div>
    </section>

    <section className="px-5 py-20 sm:px-8 sm:py-28">
      <div className="mx-auto max-w-7xl">
        <SectionHeading eyebrow="Service areas and responsibilities" title="Care for the spaces that shape your property’s presentation." copy="Your confirmed scope can include the following responsibilities, based on access, property conditions, and service priorities."/>
        <FeatureList items={responsibilities}/>
        <p className="mt-6 max-w-3xl text-sm leading-6 text-neutral-500">Condition and presentation checks are visual observations. This service does not include repairs, licensed maintenance, security services, licensed property inspections, or pool maintenance. Pool-area work is limited to tidying surrounding spaces. Reported concerns are referred to management for appropriate follow-up.</p>
      </div>
    </section>

    <section className="bg-[#eef3ea] px-5 py-20 sm:px-8 sm:py-28">
      <div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-2">
        <SectionHeading eyebrow="For property management" title="More consistent presentation. Clearer visibility." copy="Recurring common area cleaning helps keep shared spaces presentable, while regular observations give your team useful context between site visits."/>
        <FeatureList items={["Consistent property presentation", "Regular eyes on common areas", "Earlier visibility into maintenance and safety concerns", "Photos that give reported issues context", "Presentation support before tours and inspections", "More consistent upkeep between larger cleaning visits"]}/>
      </div>
    </section>

    <section className="px-5 py-20 sm:px-8 sm:py-28">
      <div className="mx-auto max-w-7xl">
        <SectionHeading eyebrow="Recurring service plans" title="A schedule shaped around your property." copy="Porter plans are customized based on property size, condition, service areas, frequency, and reporting needs. A walkthrough helps define the scope and schedule before a tailored proposal is prepared."/>
        <FeatureList items={["Daily", "Multiple days per week", "Weekly", "Custom recurring schedule"]}/>
      </div>
    </section>

    <section className="bg-[#eef3ea] px-5 py-20 sm:px-8 sm:py-28">
      <div className="mx-auto max-w-7xl">
        <SectionHeading eyebrow="Why StudioScrubz" title="A clear scope. A practical routine. Useful communication." copy="We build the porter plan around your property’s priorities: which areas need care, how often we visit, and how observations reach your team. Cleaning, documentation, and reporting work together to support your management process."/>
      </div>
    </section>

    <section className="bg-[#143d1a] px-5 py-20 text-white sm:px-8 sm:py-24">
      <div className="mx-auto max-w-7xl">
        <p className="text-xs font-extrabold uppercase tracking-[.2em] text-[#e5cd7d]">No mess. No stress.</p>
        <h2 className="mt-4 max-w-4xl text-4xl font-extrabold tracking-[-.045em] sm:text-5xl">Let’s walk your property and define the plan.</h2>
        <p className="mt-6 max-w-3xl text-lg leading-8 text-white/70">Use our estimate request to tell us about your property and mention Property Porter Services. Share your service areas, preferred frequency, and reporting needs so we can discuss the appropriate next step.</p>
        <div className="mt-8"><EstimateCta label="Request a Porter Service Walkthrough" className="bg-[#d4af37] text-[#143d1a] hover:bg-[#e5cd7d]"/></div>
      </div>
    </section>
    <div className="pt-16"><RelatedServices links={[["Property Management Cleaning", "/property-management"], ["Commercial Cleaning", "/commercial"]]}/></div>
  </>;
}
