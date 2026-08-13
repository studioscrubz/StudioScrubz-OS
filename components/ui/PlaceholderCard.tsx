import type { ReactNode } from "react";

export function PlaceholderCard({ children }: { children: ReactNode }) {
  return (
    <section className="min-h-64 rounded-2xl border border-[#143d1a]/10 bg-white p-6 shadow-[0_12px_34px_rgba(20,61,26,0.05)] sm:p-8">
      <div className="flex h-full min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-[#143d1a]/20 bg-[#f8faf7] px-5 text-center">
        <span aria-hidden className="mb-5 block h-1 w-10 rounded-full bg-[#d4af37]" />
        <p className="max-w-md text-sm font-semibold leading-6 text-[#143d1a]/70">{children}</p>
      </div>
    </section>
  );
}
