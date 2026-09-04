"use client";

import { useState, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { StudioScrubzLogo } from "@/components/branding/StudioScrubzLogo";

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="workspace-shell min-h-screen bg-[var(--canvas)] text-[var(--ink)] lg:grid lg:grid-cols-[272px_1fr]">
      <a
        href="#main-content"
        className="fixed left-4 top-4 z-[60] -translate-y-24 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--brand-green)] shadow-lg transition-transform focus:translate-y-0"
      >
        Skip to content
      </a>

      <div className="pwa-mobile-header sticky top-0 z-30 flex h-16 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-5 backdrop-blur lg:hidden">
        <div className="flex items-center gap-3">
          <StudioScrubzLogo size={40} priority />
          <span className="text-sm font-extrabold tracking-tight text-[var(--brand-green)]">StudioScrubz OS</span>
        </div>
        <button
          type="button"
          aria-label="Open navigation"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen(true)}
          className="grid size-10 place-items-center rounded-lg border border-[var(--border)] text-[var(--brand-green)]"
        >
          <span aria-hidden className="text-xl leading-none">☰</span>
        </button>
      </div>

      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-[#07190a]/55 backdrop-blur-[2px] lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={`pwa-sidebar fixed inset-y-0 left-0 z-50 w-[min(86vw,304px)] transition-transform duration-300 lg:sticky lg:top-0 lg:h-screen lg:w-auto lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar onClose={() => setMobileOpen(false)} />
      </aside>

      <main id="main-content" className="pwa-main min-w-0 px-5 py-7 sm:px-8 sm:py-9 lg:px-10 lg:py-10 xl:px-14">
        <div className="mx-auto max-w-[1320px]">{children}</div>
      </main>
    </div>
  );
}
