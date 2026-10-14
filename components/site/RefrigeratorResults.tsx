import Image from "next/image";
import { EstimateCta, SectionHeading } from "./SiteSections";

const comparisons = [
  {
    title: "Freezer",
    before: "/images/projects/refrigerator-deep-clean/freezer-before.webp",
    after: "/images/projects/refrigerator-deep-clean/freezer-after.webp",
    beforeAlt: "Freezer interior before a StudioScrubz deep cleaning",
    afterAlt: "Freezer interior after a StudioScrubz deep cleaning",
  },
  {
    title: "Refrigerator Interior",
    before: "/images/projects/refrigerator-deep-clean/refrigerator-interior-before.webp",
    after: "/images/projects/refrigerator-deep-clean/refrigerator-interior-after.webp",
    beforeAlt: "Soiled refrigerator interior before a StudioScrubz deep cleaning",
    afterAlt: "Clean refrigerator shelves and drawers after a StudioScrubz deep cleaning",
  },
  {
    title: "Stainless-Steel Exterior",
    before: "/images/projects/refrigerator-deep-clean/stainless-exterior-before.webp",
    after: "/images/projects/refrigerator-deep-clean/stainless-exterior-after.webp",
    beforeAlt: "Marked stainless-steel refrigerator exterior before cleaning",
    afterAlt: "Polished stainless-steel refrigerator exterior after StudioScrubz cleaning",
  },
] as const;

export function RefrigeratorResults() {
  return (
    <section id="refrigerator-deep-cleaning-results" className="scroll-mt-24 overflow-hidden bg-[#0d2b12] px-5 py-20 text-white sm:px-8 sm:py-28">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-8 lg:grid-cols-[1fr_.55fr] lg:items-end">
          <div className="[&_h2]:text-white [&_p:last-child]:text-white/70">
            <SectionHeading
              eyebrow="Real StudioScrubz work"
              title="Refrigerator Deep Cleaning — Real StudioScrubz Results"
              copy="A real residential deep-cleaning job, photographed before and after. Every image is shown as captured, without artificial enhancement."
            />
          </div>
          <p className="max-w-xl text-sm leading-6 text-white/65 lg:justify-self-end lg:text-right">
            Side-by-side views preserve each photo&apos;s original framing so the cleaning result stays clear and honest.
          </p>
        </div>

        <div className="mt-12 grid gap-7 xl:grid-cols-3">
          {comparisons.map((comparison) => (
            <article key={comparison.title} className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/[.06] p-4 shadow-[0_24px_70px_rgba(0,0,0,.2)] sm:p-5">
              <div className="flex items-center justify-between gap-4 px-1 pb-4">
                <h3 className="text-xl font-extrabold text-white">{comparison.title}</h3>
                <span className="text-xs font-extrabold uppercase tracking-[.18em] text-[#e5cd7d]">Deep clean</span>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                <ResultPhoto label="Before" src={comparison.before} alt={comparison.beforeAlt} />
                <ResultPhoto label="After" src={comparison.after} alt={comparison.afterAlt} />
              </div>
            </article>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-6 rounded-[2rem] border border-[#d4af37]/25 bg-[#143d1a] p-7 shadow-[0_24px_70px_rgba(0,0,0,.18)] sm:flex-row sm:items-center sm:justify-between sm:p-9">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[.2em] text-[#e5cd7d]">Ready for your reset?</p>
            <h3 className="mt-2 text-3xl font-extrabold tracking-[-.04em] text-white sm:text-4xl">See the Difference. Feel the Clean.</h3>
          </div>
          <EstimateCta label="Request a Free Estimate" className="shrink-0 bg-[#d4af37] text-[#143d1a] hover:bg-[#e5cd7d]" />
        </div>
      </div>
    </section>
  );
}

function ResultPhoto({ label, src, alt }: { label: "Before" | "After"; src: string; alt: string }) {
  return (
    <figure className="overflow-hidden rounded-[1.35rem] bg-black/25">
      <div className="relative aspect-[3/4]">
        <Image
          src={src}
          alt={alt}
          fill
          loading="lazy"
          sizes="(min-width: 1280px) 17vw, (min-width: 640px) 42vw, 43vw"
          className="object-contain"
        />
        <figcaption className={`absolute left-2.5 top-2.5 rounded-full px-3 py-1.5 text-[.68rem] font-black uppercase tracking-[.16em] shadow-lg sm:left-3 sm:top-3 sm:text-xs ${label === "After" ? "bg-[#d4af37] text-[#143d1a]" : "bg-white/95 text-[#143d1a]"}`}>
          {label}
        </figcaption>
      </div>
    </figure>
  );
}
