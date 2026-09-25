import type { Metadata } from "next";
import { EstimateCta, FeatureList, PageHero, RelatedServices, SectionHeading } from "@/components/site/SiteSections";
import { ServicePageJsonLd } from "@/components/site/SeoJsonLd";

export const metadata: Metadata = {
  title: { absolute: "Property Porter Services Los Angeles | StudioScrubz" },
  description: "Recurring property porter services for managed apartment and multifamily communities across Los Angeles County and the San Fernando Valley, with common-area upkeep, visual condition checks, photo documentation, and property issue reporting.",
  alternates: { canonical: "https://studioscrubz.com/property-porter-services" },
  openGraph: {
    title: "Property Porter Services Los Angeles | StudioScrubz",
    description: "Recurring property porter services for managed apartment and multifamily communities across Los Angeles County and the San Fernando Valley, with common-area upkeep, visual condition checks, photo documentation, and property issue reporting.",
    url: "https://studioscrubz.com/property-porter-services",
    siteName: "StudioScrubz",
    type: "website",
    images: [{ url: "/branding/studioscrubz-logo.png", width: 500, height: 500, alt: "StudioScrubz" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Property Porter Services Los Angeles | StudioScrubz",
    description: "Recurring property porter services for managed apartment and multifamily communities across Los Angeles County and the San Fernando Valley, with common-area upkeep, visual condition checks, photo documentation, and property issue reporting.",
    images: ["/branding/studioscrubz-logo.png"],
  },
};

const steps = [
  ["Clean", "Complete scheduled upkeep in the agreed common areas, keeping everyday presentation in focus."],
  ["Check", "Make visual observations of property conditions while working through the service areas."],
  ["Document", "Use photo documentation to give management context for observed conditions and issues."],
  ["Report", "Share observable property conditions and issues with the designated property contact for review and follow-up."],
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
  "Property issue reporting",
  "Pre-tour and pre-inspection presentation checks",
] as const;

export default function PropertyPorterServicesPage() {
  return <>
    <ServicePageJsonLd name="Property Porter Services" path="/property-porter-services" description="Recurring property porter services for managed apartment and multifamily communities across Los Angeles County and the San Fernando Valley, with common-area upkeep, visual condition checks, photo documentation, and property issue reporting."/>
    <PageHero eyebrow="Property Porter Services" title="Property Porter Services with Consistent Eyes on Your Property." copy="StudioScrubz provides recurring scheduled property support for property managers, apartment communities, multifamily properties, and other appropriate managed properties across Los Angeles County and the San Fernando Valley. Agreed porter visits can combine common-area upkeep with visual condition checks, photo documentation, and property issue reporting that helps management stay informed." cta="Request a Porter Service Walkthrough"/>

    <section className="px-5 py-20 sm:px-8 sm:py-28">
      <div className="mx-auto max-w-7xl">
        <SectionHeading eyebrow="Ongoing property support" title="Scheduled upkeep with management in the loop." copy="StudioScrubz Property Porter Services provide recurring property support and consistent eyes on agreed common areas. For apartment communities, multifamily properties, and other appropriate managed properties, scheduled visits can pair common-area upkeep with visual condition checks, documentation, and property issue reporting."/>
        <p className="mt-6 max-w-3xl leading-7 text-neutral-600">Apartment and multifamily porter services provide broader property-support visibility than an ordinary cleaning visit. Cleaning may be part of the confirmed scope, while observations and photo documentation help management understand observable conditions and decide what needs attention.</p>
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
        <p className="mt-6 max-w-3xl text-sm leading-6 text-neutral-500">Condition and presentation checks are limited to visual observations in the agreed service areas and do not guarantee that every issue will be identified. This service does not include formal, code, safety, or regulatory inspections; repairs; licensed maintenance; engineering; security services; or pool maintenance. Pool-area work is limited to tidying surrounding spaces. Reported conditions are referred to management for appropriate review and follow-up.</p>
      </div>
    </section>

    <section className="bg-[#eef3ea] px-5 py-20 sm:px-8 sm:py-28">
      <div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-2">
        <SectionHeading eyebrow="For property management" title="More consistent presentation. Clearer visibility." copy="Recurring common-area upkeep helps keep shared spaces presentable, while scheduled visual observations give your team useful context between management site visits."/>
        <FeatureList items={["Consistent property presentation", "Regular eyes on common areas", "Additional visibility into observable property issues", "Photos that give reported issues context", "Presentation support before tours and inspections", "More consistent upkeep between larger cleaning visits"]}/>
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

    <section className="px-5 py-20 sm:px-8 sm:py-24">
      <div className="mx-auto max-w-7xl">
        <SectionHeading eyebrow="Service area" title="Property Porter Services across Los Angeles and the San Fernando Valley." copy="StudioScrubz supports managed properties across Los Angeles County, with a strong focus on the San Fernando Valley, including Winnetka, Canoga Park, Woodland Hills, Reseda, Chatsworth, Northridge, Van Nuys, Encino, and Tarzana. Availability in surrounding areas depends on the property, requested scope, visit frequency, location, and scheduling."/>
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
