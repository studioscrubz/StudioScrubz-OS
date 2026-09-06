import type { Metadata } from "next";
import Link from "next/link";
import {
  ContactBand,
  EstimateCta,
  FeatureList,
  SectionHeading,
  ServiceGrid,
} from "@/components/site/SiteSections";
import { ProjectResults } from "@/components/site/ProjectResults";

export const metadata: Metadata = {
  title: { absolute: "StudioScrubz | Cleaning Services in Greater Los Angeles" },
  description:
    "Professional residential, commercial, property, post-construction, and exterior cleaning across Greater Los Angeles and the San Fernando Valley.",
  alternates: { canonical: "https://studioscrubz.com/" },
  openGraph: {
    title: "StudioScrubz | Residential & Commercial Cleaning",
    description:
      "Professional cleaning for homes, businesses, properties, and projects across the Los Angeles area.",
    url: "https://studioscrubz.com/",
  },
};

const process = [
  [
    "01",
    "Tell Us What You Need",
    "Choose your service and tell us about your home, business, property, or project.",
  ],
  [
    "02",
    "We Confirm the Scope",
    "We review your property and service needs, using a walkthrough when appropriate to confirm the condition, priorities, access, and cleaning scope.",
  ],
  [
    "03",
    "Review & Schedule",
    "Review the estimate or proposal for your service. Once the scope and details are confirmed, we schedule your cleaning.",
  ],
  [
    "04",
    "We Clean. You Review.",
    "StudioScrubz completes the confirmed cleaning scope and performs a final service review so the space is ready for what comes next.",
  ],
] as const;

const faqItems = [
  [
    "Do I need a walkthrough before booking?",
    "Some services can be estimated from the information you provide, while commercial, post-construction, larger, or more detailed projects may require a walkthrough so we can confirm the condition, scope, access, and service needs before finalizing pricing.",
  ],
  [
    "Do I need to be home or onsite during the cleaning?",
    "Not necessarily. Access arrangements can be confirmed privately before service. If you will not be onsite, StudioScrubz will need the approved access information necessary to complete the confirmed service.",
  ],
  [
    "Do you bring cleaning supplies?",
    "Supply requirements are confirmed with your service details so you know what to expect before the appointment.",
  ],
  [
    "What is the difference between Standard and Deep Cleaning?",
    "Standard Cleaning focuses on routine maintenance of commonly used areas and surfaces. Deep Cleaning includes additional detail work and attention to buildup, baseboards, fixtures, trim, and commonly overlooked areas based on the condition and confirmed scope.",
  ],
  [
    "Do you offer recurring cleaning?",
    "Yes. StudioScrubz offers recurring options for appropriate residential and commercial clients, with frequency and scope based on the property and service needs.",
  ],
  [
    "Do you clean apartment communities and managed properties?",
    "Yes. StudioScrubz supports appropriate apartment communities and managed properties with services that may include common areas, leasing offices, amenity areas, unit turns, and recurring janitorial service based on the confirmed property scope.",
  ],
  [
    "Do you offer post-construction cleaning?",
    "Yes. Post-construction cleaning can include detailed dust removal, surface cleaning, floor care, fixture detailing, light debris or residue removal, and final-readiness cleaning based on project condition and scope.",
  ],
  [
    "How is commercial cleaning priced?",
    "Commercial cleaning is based on factors such as cleanable square footage, facility type, condition, service frequency, traffic, requested scope, and operating needs. A walkthrough may be used to prepare an appropriate proposal.",
  ],
  [
    "Can I add additional services?",
    "Yes. Available add-ons depend on the service and property. Any additional work should be confirmed before service so it can be included in the approved scope.",
  ],
  [
    "How do I get started?",
    "Start through the existing StudioScrubz estimate process. Provide information about the property and requested service, and StudioScrubz will use those details to determine the appropriate next step.",
  ],
] as const;

export default function MarketingHome() {
  return (
    <>
      <section className="relative overflow-hidden px-5 py-16 sm:px-8 sm:py-24 lg:py-28">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_30%,rgba(212,175,55,.16),transparent_30%),radial-gradient(circle_at_80%_75%,rgba(20,61,26,.10),transparent_35%)]" />

        <div className="relative mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[1.05fr_.95fr] lg:gap-16">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[.24em] text-[#9a7a17]">
              PROFESSIONAL CLEANING · LOS ANGELES
            </p>

            <h1 className="mt-6 max-w-4xl text-5xl font-extrabold tracking-[-.06em] text-[#143d1a] sm:text-7xl lg:text-[5.2rem] lg:leading-[.98]">
              Cleaning Built Around{" "}
              <span className="text-[#9a7a17]">Your Space.</span>
            </h1>

            <p className="mt-7 max-w-2xl text-lg leading-8 text-neutral-600 sm:text-xl">
              Professional cleaning for homes, businesses, managed properties,
              and construction projects across Los Angeles and the San Fernando Valley.
            </p>

            <p className="mt-5 max-w-2xl text-sm font-bold leading-7 text-[#143d1a]/70 sm:text-base">
              Commercial Cleaning · Property Management · Post-Construction ·
              Residential · Pressure Washing
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <EstimateCta label="Get My Free Estimate" />

              <a
                href="#services"
                className="inline-flex min-h-12 items-center justify-center rounded-full border border-[#143d1a]/20 bg-white px-6 py-3 text-sm font-extrabold text-[#143d1a] transition hover:bg-[#f1f4ee]"
              >
                Explore Services
              </a>
            </div>

            <p className="mt-8 text-sm font-extrabold uppercase tracking-[.2em] text-[#143d1a]/55">
              No Mess. No Stress.
            </p>
          </div>

          <div className="relative mx-auto w-full max-w-xl">
            <div className="overflow-hidden rounded-[2.25rem] bg-[#143d1a] shadow-[0_30px_90px_rgba(13,43,18,.22)]">
              <img
                src="/site/home-hero.jpg"
                alt="Professionally cleaned kitchen by StudioScrubz"
                className="aspect-[4/3] h-full w-full object-cover sm:aspect-[5/4] lg:aspect-[4/5]"
              />
            </div>

            <div className="absolute -bottom-5 left-5 right-5 rounded-2xl border border-white/30 bg-white/95 px-5 py-4 shadow-xl backdrop-blur sm:left-8 sm:right-auto sm:max-w-sm">
              <p className="text-xs font-extrabold uppercase tracking-[.18em] text-[#9a7a17]">
                Real StudioScrubz Work
              </p>
              <p className="mt-1 font-extrabold text-[#143d1a]">
                Professional results from a space we actually cleaned.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section
        id="services"
        className="scroll-mt-24 bg-[#f1f4ee] px-5 py-20 sm:px-8 sm:py-28"
      >
        <div className="mx-auto max-w-7xl">
          <SectionHeading
            eyebrow="What we clean"
            title="Professional cleaning for the spaces that keep life and business moving."
            copy="From homes and businesses to managed properties and construction projects, we plan each service around the space, its use, and the cleaning it needs."
          />
          <ServiceGrid />
        </div>
      </section>

      <ProjectResults />

      <section className="px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-2">
          <article className="flex flex-col rounded-[2rem] bg-[#143d1a] p-8 text-white sm:p-12">
            <p className="text-xs font-extrabold uppercase tracking-[.2em] text-[#e5cd7d]">
              Commercial cleaning
            </p>

            <h2 className="mt-4 text-4xl font-extrabold tracking-[-.045em]">
              Professional cleaning for workplaces, properties, and projects.
            </h2>

            <p className="mt-5 flex-1 leading-7 text-white/70">
              Cleaning for offices, apartment communities, managed properties,
              common areas, unit turns, commercial facilities, recording and
              production facilities, and post-construction projects. From recurring
              janitorial care to project cleanup, we confirm the scope around your
              property and operating needs.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-5">
              <Link
                href="/commercial"
                className="font-extrabold text-[#e5cd7d]"
              >
                Explore Commercial →
              </Link>

              <EstimateCta
                label="Schedule a Walkthrough"
                className="bg-[#d4af37] text-[#143d1a] hover:bg-[#e5cd7d]"
              />
            </div>
          </article>

          <article className="flex flex-col rounded-[2rem] border border-[#143d1a]/10 bg-[#fff9e7] p-8 sm:p-12">
            <p className="text-xs font-extrabold uppercase tracking-[.2em] text-[#9a7a17]">
              Residential cleaning
            </p>

            <h2 className="mt-4 text-4xl font-extrabold tracking-[-.045em] text-[#143d1a]">
              More comfort at home, less cleaning on your list.
            </h2>

            <p className="mt-5 flex-1 leading-7 text-neutral-600">
              Choose Standard, Deep, Move-In / Move-Out, or recurring upkeep
              cleaning, with add-ons and service details tailored to your
              household.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-5">
              <Link
                href="/residential"
                className="font-extrabold text-[#143d1a]"
              >
                Explore Residential →
              </Link>

              <EstimateCta label="Request a Home Estimate" />
            </div>
          </article>
        </div>
      </section>

      <section className="bg-[#eef3ea] px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto max-w-7xl">
          <SectionHeading
            eyebrow="How it works"
            title="A cleaner space in four simple steps."
            copy="A clear process takes you from service request to a completed clean."
            centered
          />

          <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {process.map(([number, title, copy]) => (
              <article
                key={number}
                className="rounded-[1.6rem] bg-white p-7 shadow-[0_16px_45px_rgba(20,61,26,.05)]"
              >
                <span className="text-sm font-black text-[#9a7a17]">
                  {number}
                </span>
                <h3 className="mt-4 text-xl font-extrabold text-[#143d1a]">
                  {title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-neutral-600">
                  {copy}
                </p>
              </article>
            ))}
          </div>

          <div className="mt-9 text-center">
            <EstimateCta label="Start Your Estimate" />
          </div>
        </div>
      </section>

      <section className="px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-2 lg:items-center">
          <div>
            <SectionHeading
              eyebrow="Why StudioScrubz"
              title="Clear from walkthrough to clean."
              copy="A professional process keeps expectations clear before, during, and after your service."
            />

            <FeatureList
              items={[
                "Clear service scope",
                "Professional estimates and proposals",
                "Walkthrough-based project planning",
                "Residential and commercial capability",
                "One-time and recurring service options",
                "Professional customer communication",
                "Secure online payment",
                "Final service review",
                "Customizable add-on services",
              ]}
            />
          </div>

          <div className="rounded-[2rem] bg-[#fff9e7] p-8 sm:p-12">
            <p className="text-5xl text-[#d4af37]">“</p>

            <h2 className="mt-3 text-3xl font-extrabold tracking-[-.04em] text-[#143d1a]">
              Care built around the space.
            </h2>

            <p className="mt-5 leading-7 text-neutral-600">
              StudioScrubz combines a clearly confirmed scope with approachable
              communication, whether the work is a home refresh, recurring
              facility care, or a detailed turnover.
            </p>

            <Link
              href="/about"
              className="mt-7 inline-flex font-extrabold text-[#143d1a]"
            >
              Meet StudioScrubz →
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-[#eef3ea] px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto max-w-5xl">
          <SectionHeading
            eyebrow="Frequently asked questions"
            title="Helpful answers before your first clean."
            copy="Learn how estimates, walkthroughs, service scope, and scheduling work with StudioScrubz."
            centered
          />

          <div className="mt-10 grid gap-3">
            {faqItems.map(([question, answer]) => (
              <details
                key={question}
                className="group rounded-2xl border border-[#143d1a]/10 bg-white px-5 py-1 shadow-[0_10px_30px_rgba(20,61,26,.04)] open:pb-5"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-5 py-5 font-extrabold text-[#143d1a] marker:content-none">
                  <span>{question}</span>
                  <span
                    aria-hidden="true"
                    className="text-xl text-[#9a7a17] transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>

                <p className="max-w-4xl pr-8 text-sm leading-6 text-neutral-600">
                  {answer}
                </p>
              </details>
            ))}
          </div>

          <div className="mt-9 text-center">
            <EstimateCta label="Start Your Estimate" />
          </div>
        </div>
      </section>

      <section className="bg-[#143d1a] px-5 py-20 text-white sm:px-8 sm:py-24">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[.9fr_1.1fr] lg:items-center">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[.2em] text-[#e5cd7d]">
              Service area
            </p>

            <h2 className="mt-4 text-4xl font-extrabold tracking-[-.045em] sm:text-5xl">
              Local care, thoughtfully coordinated.
            </h2>
          </div>

          <div>
            <p className="text-lg leading-8 text-white/70">
              StudioScrubz serves customers across the San Fernando Valley,
              Greater Los Angeles, the High Desert, and surrounding service
              areas. Availability depends on the property, service, and
              schedule.
            </p>

            <Link
              href="/contact"
              className="mt-6 inline-flex font-extrabold text-[#e5cd7d]"
            >
              Check your service area →
            </Link>
          </div>
        </div>
      </section>

      <ContactBand />
    </>
  );
}
