import Image from "next/image";
import { SectionHeading } from "./SiteSections";

const comparisons = [
  {
    title: "Kitchen reset",
    before: "/images/projects/kitchen-before.webp",
    after: "/images/projects/kitchen-after.webp",
    beforeAlt: "Kitchen before StudioScrubz cleaning",
    afterAlt: "Kitchen after StudioScrubz cleaning",
  },
  {
    title: "Living room reset",
    before: "/images/projects/living-room-before.webp",
    after: "/images/projects/living-room-after.webp",
    beforeAlt: "Living room before StudioScrubz cleaning",
    afterAlt: "Living room after StudioScrubz cleaning",
  },
] as const;

const projectPhotos = [
  ["/images/projects/bathroom-vanity.webp", "Clean residential bathroom vanity completed by StudioScrubz"],
  ["/images/projects/clean-kitchen.webp", "StudioScrubz kitchen cleaning result"],
  ["/images/projects/move-out-kitchen.webp", "Move-out kitchen cleaning completed by StudioScrubz"],
  ["/images/projects/move-out-room-1.webp", "Clean room after a StudioScrubz move-out service"],
  ["/images/projects/move-out-room-2.webp", "Move-out room cleaning result by StudioScrubz"],
  ["/images/projects/shower-detail.webp", "Detailed shower cleaning by StudioScrubz"],
  ["/images/projects/bathroom-modern.webp", "Modern bathroom cleaned by StudioScrubz"],
  ["/images/projects/bathroom-tub.webp", "Clean bathroom tub completed by StudioScrubz"],
] as const;

export function ProjectResults() {
  return (
    <section id="results" className="scroll-mt-24 overflow-hidden bg-[#0d2b12] px-5 py-20 text-white sm:px-8 sm:py-28">
      <div className="mx-auto max-w-7xl">
        <div className="[&_h2]:text-white [&_p:last-child]:text-white/70">
          <SectionHeading
            eyebrow="Real StudioScrubz work"
            title="Real homes. Real results."
            copy="No stock photos here. These are real spaces cleaned by StudioScrubz."
          />
        </div>

        <div className="mt-12 grid gap-8 xl:grid-cols-2">
          {comparisons.map((comparison) => (
            <article key={comparison.title} className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/5 p-4 shadow-[0_24px_70px_rgba(0,0,0,.18)] sm:p-6">
              <h3 className="px-1 pb-4 text-xl font-extrabold text-[#e5cd7d]">{comparison.title}</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <ComparisonPhoto label="Before" src={comparison.before} alt={comparison.beforeAlt} />
                <ComparisonPhoto label="After" src={comparison.after} alt={comparison.afterAlt} />
              </div>
            </article>
          ))}
        </div>

        <div className="mt-16 flex items-end justify-between gap-6">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[.22em] text-[#e5cd7d]">Project gallery</p>
            <h3 className="mt-3 text-3xl font-extrabold tracking-[-.04em] sm:text-4xl">Details that make a space feel ready.</h3>
          </div>
          <p className="hidden max-w-sm text-right text-sm leading-6 text-white/60 md:block">Residential, detail, and move-out cleaning photographed in real customer spaces.</p>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
          {projectPhotos.map(([src, alt], index) => (
            <figure key={src} className={`relative overflow-hidden rounded-[1.4rem] bg-white/10 ${index === 2 || index === 5 ? "aspect-[4/5] lg:row-span-2 lg:aspect-auto" : "aspect-[4/5]"}`}>
              <Image
                src={src}
                alt={alt}
                fill
                loading="lazy"
                sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 50vw"
                className="object-cover transition duration-500 hover:scale-[1.02]"
              />
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

function ComparisonPhoto({ label, src, alt }: { label: "Before" | "After"; src: string; alt: string }) {
  return (
    <figure className="overflow-hidden rounded-[1.35rem] bg-black/20">
      <div className="relative aspect-[3/4]">
        <Image
          src={src}
          alt={alt}
          fill
          loading="lazy"
          sizes="(min-width: 1280px) 25vw, (min-width: 640px) 50vw, 100vw"
          className="object-contain"
        />
        <figcaption className={`absolute left-3 top-3 rounded-full px-3 py-1.5 text-xs font-black uppercase tracking-[.18em] shadow-lg ${label === "After" ? "bg-[#d4af37] text-[#143d1a]" : "bg-white/90 text-[#143d1a]"}`}>
          {label}
        </figcaption>
      </div>
    </figure>
  );
}
