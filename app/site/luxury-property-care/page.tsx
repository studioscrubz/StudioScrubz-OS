import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  EstimateCta,
  FeatureList,
  RelatedServices,
  SectionHeading,
} from "@/components/site/SiteSections";

export const metadata: Metadata = {
  title: {
    absolute: "Luxury Property Care & Private Porter Services | StudioScrubz",
  },
  description:
    "Discreet luxury property care and private porter services for estates, luxury homes, condos, second residences, and high-profile clients across Greater Los Angeles and the San Fernando Valley.",
  alternates: {
    canonical: "https://studioscrubz.com/luxury-property-care",
  },
  openGraph: {
    title: "Luxury Property Care & Private Porter Services | StudioScrubz",
    description:
      "Private property care, recurring residence upkeep, property checks, restocking, vendor coordination, and documented service for luxury homes and estates.",
    url: "https://studioscrubz.com/luxury-property-care",
  },
};

const process = [
  [
    "Clean",
    "Provide scheduled light upkeep and presentation care for the approved areas of your residence.",
  ],
  [
    "Check",
    "Make visual observations for presentation concerns, supply needs, access issues, or visible conditions that may need attention.",
  ],
  [
    "Document",
    "Create professional visit notes and approved photo documentation when appropriate.",
  ],
  [
    "Report",
    "Provide clear updates so you or your designated property contact know what was completed and what may require follow-up.",
  ],
] as const;

const clients = [
  "Private residences",
  "Luxury estates",
  "Luxury condos and penthouses",
  "Second homes",
  "High-profile clients",
  "Estate and property managers",
] as const;

const services = [
  "Scheduled property walkthroughs",
  "Light interior and common-area upkeep",
  "Entry and exterior presentation checks",
  "Patio and outdoor living-area tidying",
  "Trash and bin management",
  "Supply and household restocking",
  "Package coordination",
  "Vendor access coordination",
  "Pre-arrival property preparation",
  "Post-event reset support",
  "Guest-ready presentation",
  "Seasonal or extended-absence property checks",
  "Property condition observations",
  "Visit documentation and reporting",
] as const;

const specialtyServices = [
  "Deep Cleaning",
  "Pressure Washing",
  "Carpet Cleaning",
  "Exterior Window Cleaning",
  "Post-Construction Cleaning",
  "Move-In / Move-Out Cleaning",
  "Appliance Interior Cleaning",
  "Detailed Kitchen Cleaning",
  "Event Cleaning / Reset",
  "Other specialty projects",
] as const;

const privacyItems = [
  "Professional, discreet service",
  "Consistent assigned personnel when scheduling allows",
  "Controlled property-access procedures",
  "Client-specific service instructions",
  "No unauthorized photography",
  "No unauthorized social-media posting",
  "Confidential handling of property information",
  "Clear communication and documented visit records",
  "NDAs can be accommodated when required by the client",
] as const;

const howItWorks = [
  "Private Property Assessment",
  "Customized Property Care Plan",
  "Scheduled Recurring Service",
  "Visit Documentation & Reporting",
  "Ongoing Adjustments as Property Needs Change",
] as const;

export default function LuxuryPropertyCarePage() {
  return (
    <>
      <section className="bg-[#eef3ea] px-5 py-16 sm:px-8 sm:py-20 lg:py-24">
        <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-2">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[.2em] text-[#9a7a17]">
              Luxury Property Care
            </p>

            <h1 className="mt-5 text-5xl font-extrabold tracking-[-.055em] text-[#143d1a] sm:text-6xl lg:text-7xl">
              Your property cared for, even when you&apos;re not there.
            </h1>

            <p className="mt-7 max-w-2xl text-lg leading-8 text-neutral-600">
              Private porter and property support services for luxury
              residences, private estates, second homes, luxury condos, and
              high-profile clients. StudioScrubz combines discreet upkeep,
              property observations, restocking, coordination, and documented
              reporting into one customized recurring service.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/contact"
                className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#143d1a] px-6 py-3 text-center text-sm font-extrabold text-white transition hover:bg-[#0d2b12]"
              >
                Request a Private Property Assessment
              </Link>

              <Link
                href="/contact"
                className="inline-flex min-h-12 items-center justify-center rounded-full border border-[#143d1a]/20 bg-white px-6 py-3 text-center text-sm font-extrabold text-[#143d1a] transition hover:bg-white/70"
              >
                Contact StudioScrubz
              </Link>
            </div>
          </div>

          <div>
            <div className="relative aspect-[4/3] overflow-hidden rounded-[2rem] border border-[#143d1a]/10 bg-white shadow-sm">
              <Image
                src="/site/luxury-property-care.png"
                alt="Luxury modern living room overlooking an infinity pool and Los Angeles skyline"
                fill
                priority
                sizes="(min-width: 1024px) 50vw, 100vw"
                className="object-cover"
              />
            </div>

            <p className="mt-3 px-2 text-xs leading-5 text-neutral-500">
              <span className="font-semibold text-[#143d1a]">
                Privacy Notice:
              </span>{" "}
              Luxury Property Care is a private, discreet service. To protect
              our clients&apos; privacy, images shown are representative and
              are not photographs of actual StudioScrubz client properties.
            </p>
          </div>
        </div>
      </section>

      <section className="px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto max-w-7xl">
          <SectionHeading
            eyebrow="Who we serve"
            title="Private property care for exceptional residences."
            copy="Our service is designed for clients who want their property consistently cared for, presented, and observed whether they are home every day or away for extended periods."
          />
          <FeatureList items={clients} />
        </div>
      </section>

      <section className="bg-[#eef3ea] px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto max-w-7xl">
          <SectionHeading
            eyebrow="Our approach"
            title="Clean → Check → Document → Report"
            copy="A simple property-care routine built around presentation, communication, and visibility."
          />

          <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {process.map(([title, copy], index) => (
              <article
                key={title}
                className="rounded-[1.6rem] border border-[#143d1a]/10 bg-white p-7"
              >
                <span className="grid size-11 place-items-center rounded-full bg-[#edf4e9] text-sm font-black text-[#9a7a17]">
                  0{index + 1}
                </span>

                <h3 className="mt-6 text-2xl font-extrabold text-[#143d1a]">
                  {title}
                </h3>

                <p className="mt-3 leading-7 text-neutral-600">{copy}</p>
              </article>
            ))}
          </div>

          <p className="mt-8 max-w-4xl text-sm leading-6 text-neutral-500">
            Property checks are limited to visual observations made during
            scheduled service. StudioScrubz is not acting as a licensed
            property inspector, contractor, security company, or property
            management firm unless separately contracted and authorized.
          </p>
        </div>
      </section>

      <section className="px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto max-w-7xl">
          <SectionHeading
            eyebrow="Private property porter services"
            title="Customized support built around your residence."
            copy="Every property is different. Your plan can combine recurring presentation care with practical support based on your schedule, access requirements, and household priorities."
          />
          <FeatureList items={services} />
        </div>
      </section>

      <section className="bg-[#eef3ea] px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto max-w-7xl">
          <SectionHeading
            eyebrow="Specialty services"
            title="Additional cleaning when the property needs more."
            copy="Specialty work can be added separately to your property-care plan and is priced based on scope."
          />
          <FeatureList items={specialtyServices} />
        </div>
      </section>

      <section className="px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-2">
          <SectionHeading
            eyebrow="Privacy & discretion"
            title="Professional care with respect for your home and privacy."
            copy="For private residences and high-profile clients, how service is delivered matters just as much as the work itself. We build access, communication, and documentation procedures around the client's requirements."
          />
          <FeatureList items={privacyItems} />
        </div>
      </section>

      <section className="bg-[#eef3ea] px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto max-w-7xl">
          <SectionHeading
            eyebrow="How service works"
            title="A property-care plan designed around your needs."
            copy="The private property assessment helps us understand the residence, service areas, visit frequency, expected porter coverage, access requirements, property complexity, and any specialty-service needs before we prepare your plan."
          />
          <FeatureList items={howItWorks} />
        </div>
      </section>

      <section className="bg-[#143d1a] px-5 py-20 text-white sm:px-8 sm:py-24">
        <div className="mx-auto max-w-7xl">
          <p className="text-xs font-extrabold uppercase tracking-[.2em] text-[#e5cd7d]">
            No mess. No stress.
          </p>

          <h2 className="mt-4 max-w-4xl text-4xl font-extrabold tracking-[-.045em] sm:text-5xl">
            Your property. Professionally cared for.
          </h2>

          <p className="mt-6 max-w-3xl text-lg leading-8 text-white/70">
            Whether you&apos;re home every day, travel frequently, maintain a
            second residence, or manage a private estate, StudioScrubz can
            create a property-care plan around your schedule, standards, and
            privacy.
          </p>

          <div className="mt-8">
            <EstimateCta
              label="Request a Private Property Assessment"
              className="bg-[#d4af37] text-[#143d1a] hover:bg-[#e5cd7d]"
            />
          </div>
        </div>
      </section>

      <div className="pt-16">
        <RelatedServices
          links={[
            ["Property Porter Services", "/property-porter-services"],
            ["Residential Cleaning", "/residential"],
            ["Property Management Cleaning", "/property-management"],
          ]}
        />
      </div>
    </>
  );
}