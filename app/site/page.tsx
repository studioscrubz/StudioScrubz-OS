import type { Metadata } from "next";
import Link from "next/link";
import { ContactBand, EstimateCta, FeatureList, SectionHeading, ServiceGrid } from "@/components/site/SiteSections";

export const metadata: Metadata = {
  title: { absolute: "StudioScrubz | Residential & Commercial Cleaning" },
  description: "Professional residential cleaning, commercial cleaning, property management cleaning, post-construction cleaning, and pressure washing in the Los Angeles area.",
  alternates: { canonical: "https://studioscrubz.com/" },
  openGraph: {
    title: "StudioScrubz | Residential & Commercial Cleaning",
    description: "Professional cleaning for homes, businesses, properties, and projects across the Los Angeles area.",
    url: "https://studioscrubz.com/",
  },
};

const process = [
  ["01", "Tell us about the space", "Share the property, service, and timing details through our secure Estimate experience."],
  ["02", "Clarify the scope", "We review the information and coordinate a walkthrough when the space or service calls for one."],
  ["03", "Approve the plan", "You receive clear digital pricing and scope before cleaning moves forward."],
] as const;

export default function MarketingHome() {
  return <>
    <section className="relative overflow-hidden px-5 py-20 sm:px-8 sm:py-28 lg:py-36">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(212,175,55,.22),transparent_28%),radial-gradient(circle_at_15%_75%,rgba(20,61,26,.13),transparent_34%)]"/>
      <div className="relative mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[1.15fr_.85fr]">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[.24em] text-[#9a7a17]">Residential · Commercial · Specialty</p>
          <h1 className="mt-6 max-w-4xl text-5xl font-extrabold tracking-[-.06em] text-[#143d1a] sm:text-7xl lg:text-[5.4rem] lg:leading-[.98]">Professional Cleaning. <span className="text-[#9a7a17]">Zero Stress.</span></h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-neutral-600">StudioScrubz provides professional residential and commercial cleaning for homes, workplaces, property turns, post-construction projects, and exterior surfaces.</p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap"><EstimateCta label="Request an Estimate"/><a href="#services" className="inline-flex min-h-12 items-center justify-center rounded-full border border-[#143d1a]/20 bg-white px-6 py-3 text-sm font-extrabold text-[#143d1a]">Explore Services</a></div>
          <p className="mt-8 text-sm font-extrabold uppercase tracking-[.2em] text-[#143d1a]/55">No mess. No stress.</p>
        </div>
        <div className="relative mx-auto w-full max-w-lg" aria-label="StudioScrubz service overview"><div className="aspect-[4/5] rounded-[2.5rem] bg-[#143d1a] p-7 shadow-[0_30px_90px_rgba(13,43,18,.25)]"><div className="flex h-full flex-col justify-between rounded-[1.8rem] border border-white/15 bg-[linear-gradient(145deg,rgba(255,255,255,.12),rgba(255,255,255,.02))] p-7 text-white"><div className="text-6xl text-[#d4af37]">✦</div><div><p className="text-xs font-bold uppercase tracking-[.2em] text-[#e5cd7d]">Clean spaces make room for more</p><p className="mt-4 text-3xl font-extrabold leading-tight">Homes that feel lighter. Businesses that feel ready. Details handled.</p></div><div className="grid grid-cols-2 gap-3 text-xs font-bold"><span className="rounded-full bg-white/10 px-4 py-3">One-time</span><span className="rounded-full bg-white/10 px-4 py-3">Recurring</span><span className="rounded-full bg-white/10 px-4 py-3">Walkthrough-led</span><span className="rounded-full bg-white/10 px-4 py-3">Digital-ready</span></div></div></div></div>
      </div>
    </section>

    <section id="services" className="scroll-mt-24 bg-[#f1f4ee] px-5 py-20 sm:px-8 sm:py-28"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="What we clean" title="Cleaning support for every kind of space." copy="From recurring home upkeep to commercial care and detailed project cleanup, every service starts with a clear understanding of your space."/><ServiceGrid/></div></section>

    <section className="px-5 py-20 sm:px-8 sm:py-28"><div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-2">
      <article className="flex flex-col rounded-[2rem] bg-[#143d1a] p-8 text-white sm:p-12"><p className="text-xs font-extrabold uppercase tracking-[.2em] text-[#e5cd7d]">Commercial cleaning</p><h2 className="mt-4 text-4xl font-extrabold tracking-[-.045em]">A reliable partner for properties and workplaces.</h2><p className="mt-5 flex-1 leading-7 text-white/70">Recurring janitorial service, office cleaning, apartment common areas, unit turns, studios, salons, gyms, commercial facilities, and post-construction projects—all scoped around the real property.</p><div className="mt-8 flex flex-wrap items-center gap-5"><Link href="/commercial" className="font-extrabold text-[#e5cd7d]">Explore Commercial →</Link><EstimateCta label="Schedule a Walkthrough" className="bg-[#d4af37] text-[#143d1a] hover:bg-[#e5cd7d]"/></div></article>
      <article className="flex flex-col rounded-[2rem] border border-[#143d1a]/10 bg-[#fff9e7] p-8 sm:p-12"><p className="text-xs font-extrabold uppercase tracking-[.2em] text-[#9a7a17]">Residential cleaning</p><h2 className="mt-4 text-4xl font-extrabold tracking-[-.045em] text-[#143d1a]">More comfort at home, less cleaning on your list.</h2><p className="mt-5 flex-1 leading-7 text-neutral-600">Choose Standard, Deep, Move-In / Move-Out, or recurring upkeep cleaning, with add-ons and service details tailored to your household.</p><div className="mt-8 flex flex-wrap items-center gap-5"><Link href="/residential" className="font-extrabold text-[#143d1a]">Explore Residential →</Link><EstimateCta label="Request a Home Estimate"/></div></article>
    </div></section>

    <section className="bg-[#eef3ea] px-5 py-20 sm:px-8 sm:py-28"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="How it works" title="A clear path to a cleaner space." copy="One secure request starts the existing StudioScrubz estimate and walkthrough process." centered/><div className="mt-10 grid gap-5 md:grid-cols-3">{process.map(([number,title,copy])=><article key={number} className="rounded-[1.6rem] bg-white p-7 shadow-[0_16px_45px_rgba(20,61,26,.05)]"><span className="text-sm font-black text-[#9a7a17]">{number}</span><h3 className="mt-4 text-xl font-extrabold text-[#143d1a]">{title}</h3><p className="mt-3 text-sm leading-6 text-neutral-600">{copy}</p></article>)}</div><div className="mt-9 text-center"><EstimateCta label="Start Your Estimate"/></div></div></section>

    <section className="px-5 py-20 sm:px-8 sm:py-28"><div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-2 lg:items-center"><div><SectionHeading eyebrow="Why StudioScrubz" title="Clear from walkthrough to clean." copy="We make the process feel organized before the first cloth, mop, or pressure washer comes out."/><FeatureList items={["Detailed walkthrough process","Residential and commercial capability","Clear customer communication","Customizable services and add-ons","Recurring and one-time options","Professional digital estimates and proposals","Secure online payment"]}/></div><div className="rounded-[2rem] bg-[#fff9e7] p-8 sm:p-12"><p className="text-5xl text-[#d4af37]">“</p><h2 className="mt-3 text-3xl font-extrabold tracking-[-.04em] text-[#143d1a]">Care built around the space.</h2><p className="mt-5 leading-7 text-neutral-600">StudioScrubz combines a professional process with approachable communication, whether the work is a home refresh, recurring facility care, or a detailed turnover.</p><Link href="/about" className="mt-7 inline-flex font-extrabold text-[#143d1a]">Meet StudioScrubz →</Link></div></div></section>

    <section className="bg-[#143d1a] px-5 py-20 text-white sm:px-8 sm:py-24"><div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[.9fr_1.1fr] lg:items-center"><div><p className="text-xs font-extrabold uppercase tracking-[.2em] text-[#e5cd7d]">Service area</p><h2 className="mt-4 text-4xl font-extrabold tracking-[-.045em] sm:text-5xl">Local care, thoughtfully coordinated.</h2></div><div><p className="text-lg leading-8 text-white/70">StudioScrubz serves customers across the San Fernando Valley, Greater Los Angeles, the High Desert, and surrounding service areas. Availability depends on the property, service, and schedule.</p><Link href="/contact" className="mt-6 inline-flex font-extrabold text-[#e5cd7d]">Check your service area →</Link></div></div></section>
    <ContactBand/>
  </>;
}
