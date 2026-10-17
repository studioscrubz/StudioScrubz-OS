"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

export type ResidentialShowcasePhoto = readonly [src: string, alt: string];

export function ResidentialShowcaseCarousel({ photos }: { photos: readonly ResidentialShowcasePhoto[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(0);
  const [offsets, setOffsets] = useState<number[]>(photos.map((_, index) => index));

  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const maximum = Math.max(0, track.scrollWidth - track.clientWidth);
    const next = Array.from(track.children, (child) =>
      Math.min(Math.max(0, (child as HTMLElement).offsetLeft - track.offsetLeft), maximum),
    ).filter((offset, index, values) => index === 0 || Math.abs(offset - values[index - 1]) > 2);
    setOffsets(next.length ? next : [0]);
    setPosition((current) => Math.min(current, Math.max(0, next.length - 1)));
  }, []);

  useEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (trackRef.current) observer.observe(trackRef.current);
    return () => observer.disconnect();
  }, [measure]);

  function goTo(nextPosition: number) {
    const track = trackRef.current;
    if (!track) return;
    const bounded = Math.max(0, Math.min(nextPosition, offsets.length - 1));
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    track.scrollTo({ left: offsets[bounded] ?? 0, behavior: reduceMotion ? "auto" : "smooth" });
    setPosition(bounded);
  }

  function updatePosition() {
    const track = trackRef.current;
    if (!track) return;
    let closest = 0;
    offsets.forEach((offset, index) => {
      if (Math.abs(track.scrollLeft - offset) < Math.abs(track.scrollLeft - offsets[closest])) closest = index;
    });
    setPosition(closest);
  }

  return (
    <div
      className="mt-8"
      role="region"
      aria-roledescription="carousel"
      aria-label="Residential cleaning showcase"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") { event.preventDefault(); goTo(position - 1); }
        if (event.key === "ArrowRight") { event.preventDefault(); goTo(position + 1); }
        if (event.key === "Home") { event.preventDefault(); goTo(0); }
        if (event.key === "End") { event.preventDefault(); goTo(offsets.length - 1); }
      }}
    >
      <div
        ref={trackRef}
        onScroll={updatePosition}
        className="flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-smooth pb-3 [scrollbar-width:none] motion-reduce:scroll-auto [&::-webkit-scrollbar]:hidden"
      >
        {photos.map(([src, alt], index) => (
          <figure
            key={src}
            className="min-w-0 shrink-0 basis-full snap-start overflow-hidden rounded-[1.4rem] border border-white/10 bg-white/5 shadow-[0_18px_45px_rgba(0,0,0,.16)] md:basis-[calc(50%-0.625rem)]"
            aria-label={`Photo ${index + 1} of ${photos.length}`}
          >
            <Image
              src={src}
              alt={alt}
              width={1050}
              height={1400}
              loading="lazy"
              sizes="(min-width: 768px) 50vw, 100vw"
              className="h-auto w-full object-contain"
            />
          </figure>
        ))}
      </div>

      <div className="mt-5 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => goTo(position - 1)}
          disabled={position === 0}
          aria-label="Show previous residential photos"
          className="grid h-11 w-11 place-items-center rounded-full border border-[#D4AF37] bg-[#143D1A] text-2xl font-bold text-[#D4AF37] transition-colors hover:bg-[#D4AF37] hover:text-[#143D1A] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#D4AF37] disabled:cursor-not-allowed disabled:opacity-35 motion-reduce:transition-none"
        >
          <span aria-hidden="true">‹</span>
        </button>

        <div className="flex items-center justify-center gap-2" role="group" aria-label={`Position ${position + 1} of ${offsets.length}`}>
          {offsets.map((_, index) => (
            <button
              key={index}
              type="button"
              onClick={() => goTo(index)}
              aria-label={`Go to carousel position ${index + 1}`}
              aria-current={position === index ? "true" : undefined}
              className={`h-2.5 rounded-full bg-[#D4AF37] transition-[width,opacity] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#D4AF37] motion-reduce:transition-none ${position === index ? "w-8 opacity-100" : "w-2.5 opacity-45 hover:opacity-80"}`}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => goTo(position + 1)}
          disabled={position === offsets.length - 1}
          aria-label="Show next residential photos"
          className="grid h-11 w-11 place-items-center rounded-full border border-[#D4AF37] bg-[#143D1A] text-2xl font-bold text-[#D4AF37] transition-colors hover:bg-[#D4AF37] hover:text-[#143D1A] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#D4AF37] disabled:cursor-not-allowed disabled:opacity-35 motion-reduce:transition-none"
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>
    </div>
  );
}
