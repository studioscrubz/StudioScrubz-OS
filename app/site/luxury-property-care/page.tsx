import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Eyebrow, FeatureList, RelatedServices, SectionHeading } from "@/components/site/SiteSections";

const title = "Luxury Property Care & Private Porter Services | StudioScrubz";
const description = "StudioScrubz provides discreet luxury property care, private porter services, recurring residence upkeep, property checks, restocking, vendor coordination, and documented service for estates, luxury homes, condos, and second residences.";
export const metadata: Metadata = {
  title: { absolute: title }, description,
  alternates: { canonical: "https://studioscrubz.com/luxury-property-care" },
  openGraph: { title, description, url: "https://studioscrubz.com/luxury-property-care" },
};

const audiences = ["Private Residences", "Luxury Estates", "Luxury Condos & Penthouses", "Second Homes", "High-Profile Clients", "Estate & Property Managers"];
const process = [
  ["Clean", "Routine light upkeep and presentation care for approved areas."],
  ["Check", "Visual property-condition checks for visible issues, access concerns, supply needs, or anything requiring attention."],
  ["Document", "Professional visit documentation and approved photo records where appropriate."],
  ["Report", "Clear property updates so you or your property manager know what was completed and what may need attention."],
];
const services = ["Scheduled property walkthroughs", "Light interior/common-area upkeep", "Entry and exterior presentation checks", "Patio and outdoor living area tidying", "Trash and bin management", "Supply and household restocking", "Package coordination", "Vendor access coordination", "Pre-arrival property preparation", "Post-event reset support", "Guest-ready presentation", "Seasonal or extended-absence property checks", "Property condition observations", "Visit documentation and reporting"];
const specialty = ["Deep Cleaning", "Pressure Washing", "Carpet Cleaning", "Exterior Window Cleaning", "Post-Construction Cleaning", "Move-In / Move-Out Cleaning", "Appliance Interior Cleaning", "Detailed Kitchen Cleaning", "Event Cleaning / Reset", "Other specialty projects"];
const privacy = ["Professional, discreet service", "Consistent assigned personnel when scheduling allows", "Controlled property-access procedures", "Client-specific instructions", "No unauthorized photography", "No unauthorized social-media posting", "Confidential handling of property information", "Clear communication and visit records"];
const stages = [
  ["Private Property Assessment", "Review the property, priorities, scope, visit frequency, expected porter hours, access requirements, complexity, and specialty-service needs."],
  ["Customized Property Care Plan", "Agree on included areas, recurring responsibilities, access procedures, and communication preferences."],
  ["Scheduled Recurring Service", "Arrange visits around your residence, travel plans, and preferred schedule."],
  ["Visit Documentation & Reporting", "Receive a record of completed care and observable conditions, with photos only where authorized."],
  ["Ongoing Adjustments as Property Needs Change", "Review the plan as occupancy, seasons, and property priorities change."],
];
const button = "inline-flex min-h-12 items-center justify-center rounded-full px-6 py-3 text-center text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#9a7a17]";

export default function LuxuryPropertyCarePage() {
  return <>
    <section className="bg-[#eef3ea] px-5 py-20 sm:px-8 sm:py-28">
      <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-2">
        <div className="min-w-0">
          <Eyebrow>Private Porter &amp; Property Support Services</Eyebrow>
          <h1 className="mt-5 text-5xl font-extrabold tracking-[-.055em] text-[#143d1a] sm:text-7xl">Luxury Property Care</h1>
          <p className="mt-7 text-2xl font-semibold leading-snug text-[#143d1a]">Your property cared for, even when you&apos;re not there.</p>
          <p className="mt-5 leading-8 text-neutral-600">StudioScrubz provides discreet, scheduled property care for luxury residences, private estates, second homes, luxury condos, and high-profile clients. We combine light property upkeep, presentation checks, restocking, vendor coordination, and documented property reporting into one recurring service.</p>
          <div className="mt-8 flex flex-wrap gap-3"><Link href="/contact" className={`${button} bg-[#143d1a] text-white hover:bg-[#0d2b12]`}>Request a Private Property Assessment</Link><Link href="/contact" className={`${button} border border-[#143d1a]/20 bg-white text-[#143d1a]`}>Contact StudioScrubz</Link></div>
        </div>
        <div className="relative aspect-square overflow-hidden rounded-[2rem] border border-[#143d1a]/10">
          <Image src="/site/details-ready-living-room.jpg" alt="Sunlit living and dining room with neatly arranged seating and clear floors" fill sizes="(min-width: 1280px) 600px, (min-width: 1024px) 50vw, 100vw" preload className="object-cover"/>
        </div>
      </div>
    </section>

    <section className="px-5 py-20 sm:px-8 sm:py-28"><div className="mx-auto max-w-7xl">
      <SectionHeading eyebrow="Who we serve" title="A considered approach to private property care." copy="Recurring private residence services across Los Angeles and the San Fernando Valley, shaped around the way you use your home and the people entrusted with its care."/>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{audiences.map(name => <article key={name} className="rounded-[1.6rem] border border-[#143d1a]/10 bg-white p-7"><h3 className="text-xl font-extrabold text-[#143d1a]">{name}</h3></article>)}</div>
    </div></section>

    <section className="bg-[#eef3ea] px-5 py-20 sm:px-8 sm:py-28"><div className="mx-auto max-w-7xl">
      <SectionHeading eyebrow="Our service routine" title="Clean → Check → Document → Report" copy="A recurring layer of property support that keeps presentation and communication connected."/>
      <div className="mt-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">{process.map(([name, copy], i) => <article key={name} className="rounded-[1.6rem] border border-[#143d1a]/10 bg-white p-7"><span className="text-sm font-bold text-[#9a7a17]">0{i + 1}</span><h3 className="mt-5 text-2xl font-extrabold text-[#143d1a]">{name}</h3><p className="mt-3 leading-7 text-neutral-600">{copy}</p></article>)}</div>
      <p className="mt-7 max-w-4xl text-sm leading-6 text-neutral-600">StudioScrubz reports observable conditions. This service does not constitute licensed inspections, contracting, security services, or property management. Any separately authorized services require an appropriate agreement and applicable qualifications.</p>
    </div></section>

    <section className="px-5 py-20 sm:px-8 sm:py-28"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="Private property porter services" title="The details that keep your residence ready." copy="Customize your recurring plan around the residence and your needs. Approved responsibilities, supply purchases, package handling, and vendor access arrangements are agreed in advance."/><FeatureList items={services}/></div></section>

    <section className="bg-[#143d1a] px-5 py-20 text-white sm:px-8 sm:py-28"><div className="mx-auto max-w-7xl">
      <p className="text-xs font-extrabold uppercase tracking-[.22em] text-[#e5cd7d]">Privacy &amp; discretion</p>
      <h2 className="mt-4 max-w-3xl text-3xl font-extrabold tracking-[-.045em] sm:text-5xl">Your home. Your instructions. Your privacy.</h2>
      <p className="mt-5 max-w-3xl text-lg leading-8 text-white/80">Property access and documentation should follow your preferences. We establish clear instructions for approved areas, contacts, and records before recurring service begins.</p>
      <ul className="mt-10 grid gap-4 sm:grid-cols-2">{privacy.map(item => <li key={item} className="rounded-2xl border border-white/20 p-5 text-base font-semibold">{item}</li>)}</ul>
    </div></section>

    <section className="px-5 py-20 sm:px-8 sm:py-28"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="Specialty services" title="Additional projects, clearly scoped." copy="Estate cleaning services and specialty projects can be arranged separately. Deep or detailed luxury home cleaning, equipment-intensive work, and event resets are not automatically included in the monthly property-care plan."/><FeatureList items={specialty}/></div></section>

    <section className="bg-[#eef3ea] px-5 py-20 sm:px-8 sm:py-28"><div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-2">
      <SectionHeading eyebrow="How service works" title="A plan that fits your property and your life." copy="From second home property care to an occupied private estate, the assessment defines the scope and recurring schedule. Each plan is customized; specialty work is considered separately."/>
      <ol className="space-y-5">{stages.map(([name, copy], i) => <li key={name} className="rounded-[1.6rem] border border-[#143d1a]/10 bg-white p-6"><p className="text-xs font-bold text-[#9a7a17]">0{i + 1}</p><h3 className="mt-2 text-xl font-extrabold text-[#143d1a]">{name}</h3><p className="mt-3 leading-7 text-neutral-600">{copy}</p></li>)}</ol>
    </div></section>

    <section className="px-5 py-20 sm:px-8 sm:py-28"><div className="mx-auto max-w-7xl rounded-[2rem] bg-[#143d1a] p-8 text-white sm:p-12">
      <p className="text-xs font-extrabold uppercase tracking-[.2em] text-[#e5cd7d]">No mess. No stress.</p><h2 className="mt-4 max-w-3xl text-4xl font-extrabold tracking-[-.045em] sm:text-5xl">Your Property. Professionally Cared For.</h2>
      <p className="mt-6 max-w-3xl text-lg leading-8 text-white/80">Whether you&apos;re home every day, travel frequently, maintain a second residence, or manage a private estate, StudioScrubz can create a property-care plan built around your schedule, standards, and privacy.</p>
      <p className="mt-4 max-w-3xl text-sm leading-6 text-white/80">Contact us and mention Luxury Property Care to discuss your residence, preferred schedule, and assessment needs.</p>
      <Link href="/contact" className={`${button} mt-8 bg-[#d4af37] text-[#143d1a] hover:bg-[#e5cd7d]`}>Request a Private Property Assessment</Link>
    </div></section>
    <RelatedServices links={[["Residential Cleaning", "/residential"], ["Property Porter Services", "/property-porter-services"], ["Property Management Cleaning", "/property-management"]]}/>
  </>;
}
