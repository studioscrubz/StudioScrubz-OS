import type { Metadata } from "next";
import { ContactBand, EstimateCta, FeatureList, PageHero, RelatedServices, SectionHeading } from "@/components/site/SiteSections";

export const metadata: Metadata = {
  title: { absolute: "Airbnb Cleaning Services Los Angeles | StudioScrubz" },
  description: "Airbnb and short-term rental turnover cleaning for guest-ready homes across Los Angeles County and the San Fernando Valley, with recurring and deep-clean options.",
  alternates: { canonical: "https://studioscrubz.com/airbnb-cleaning" },
  openGraph: {
    title: "Airbnb Cleaning Services Los Angeles | StudioScrubz",
    description: "Between-guest turnover cleaning for Airbnb, vacation rental, and short-term rental properties across Los Angeles County and the San Fernando Valley.",
    url: "https://studioscrubz.com/airbnb-cleaning",
  },
};

const turnoverSteps = [
  ["Kitchen reset", "Cleaning accessible counters, sinks, appliance exteriors, floors, and other agreed kitchen surfaces so the space is ready for the next guest."],
  ["Bathroom care", "Cleaning agreed bathroom surfaces, fixtures, mirrors, floors, and high-touch areas between reservations."],
  ["Bedroom reset", "Surface and floor cleaning, a visual room reset, and bed or linen changes when linens are provided and that work is included in the service."],
  ["Guest-area readiness", "Trash removal within normal cleaning scope, floor and accessible surface cleaning, and a visual presentation check across living areas and confirmed guest spaces."],
  ["Host-provided restocking", "Restocking host-provided consumables when specifically included, with supplies, locations, quantities, and expectations confirmed in advance."],
  ["Recurring turnover support", "Plan ongoing cleaning around your rental calendar, with timing, access windows, and property-specific checklist requirements confirmed before scheduling."],
] as const;

export default function AirbnbCleaningPage() {
  return <>
    <PageHero eyebrow="Airbnb & turnover cleaning" title="Turnover Cleaning Built Around Your Property." copy="Guest-ready cleaning for hosts and short-term rental operators, coordinated around your property?s confirmed turnover needs. StudioScrubz serves Los Angeles County and the San Fernando Valley with a clear plan for each rental?s presentation and reset." cta="Request a Turnover Estimate"/>
    <section className="px-5 py-20 sm:px-8 sm:py-28"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="Between every stay" title="A repeatable reset for the next arrival." copy="Short-term rental cleaning is coordinated around the property, checkout condition, access window, guest-facing priorities, and confirmed turnover checklist. The goal is a clean, orderly space that is visually ready for the next reservation."/><div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">{turnoverSteps.map(([title,copy])=><article key={title} className="rounded-[1.6rem] border border-[#143d1a]/10 bg-[#f4f7f1] p-7"><h2 className="text-2xl font-extrabold text-[#143d1a]">{title}</h2><p className="mt-3 leading-7 text-neutral-600">{copy}</p></article>)}</div></div></section>
    <section className="bg-[#eef3ea] px-5 py-20 sm:px-8 sm:py-28"><div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-2"><SectionHeading eyebrow="A plan for your rental" title="Turnover service and deeper cleaning serve different needs." copy="Recurring turnovers focus on the agreed between-guest reset. Deep cleaning can be scheduled separately when the rental needs additional detail, buildup removal, or attention beyond the standard turnover checklist."/><div><FeatureList items={["Between-guest turnover cleaning","Kitchen and bathroom reset","Bedroom and guest-area reset","Laundry when included in the service","Host-provided restocking when included","Separate deep-cleaning options"]}/><p className="mt-6 text-sm leading-6 text-neutral-500">Timing, access, laundry and linen handling, restocking, and special turnover requirements must be confirmed in the service plan. Laundry and restocking are included only when agreed; restocking uses host-provided supplies.</p></div></div></section>
    <section className="bg-[#143d1a] px-5 py-20 text-white sm:px-8 sm:py-24"><div className="mx-auto max-w-7xl"><p className="text-xs font-extrabold uppercase tracking-[.2em] text-[#e5cd7d]">For hosts and rental managers</p><h2 className="mt-4 max-w-4xl text-4xl font-extrabold tracking-[-.045em] sm:text-5xl">Coordinate cleaning around the property and booking rhythm.</h2><p className="mt-6 max-w-3xl text-lg leading-8 text-white/70">Share the rental layout, access process, turnover window, linen or laundry arrangement, host-provided supplies, and property checklist. We confirm the scope and provide a professional estimate before coordinating the schedule. Clear communication and a final service review keep the cleaning aligned with your confirmed plan.</p><div className="mt-8"><EstimateCta label="Request a Turnover Estimate" className="bg-[#d4af37] text-[#143d1a] hover:bg-[#e5cd7d]"/></div></div></section>
    <RelatedServices links={[["Residential Cleaning", "/residential"], ["Property Management Cleaning", "/property-management"], ["Contact StudioScrubz", "/contact"]]}/>
    <ContactBand title="Make the next turnover easier to coordinate." copy="Tell us about your rental, booking schedule, access window, and guest-ready priorities."/>
  </>;
}
