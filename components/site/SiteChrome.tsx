"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { StudioScrubzLogo } from "@/components/branding/StudioScrubzLogo";
import { ESTIMATE_URL, siteNavigation } from "./siteData";

export function SiteHeader({ phone }: { phone: string | null }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!open) return; const close = () => setOpen(false); window.addEventListener("resize", close); return () => window.removeEventListener("resize", close); }, [open]);
  return <header className="sticky top-0 z-50 border-b border-[#143d1a]/10 bg-[#fbfcf9]/95 backdrop-blur-xl">
    <div className="mx-auto flex min-h-20 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
      <Link href="/" className="flex items-center gap-3" aria-label="StudioScrubz home"><StudioScrubzLogo size={58} priority/><span><b className="block text-lg tracking-[-.03em] text-[#143d1a]">StudioScrubz</b><span className="block text-[10px] font-bold uppercase tracking-[.2em] text-[#9a7a17]">No mess. No stress.</span></span></Link>
      <nav className="hidden items-center gap-5 xl:flex" aria-label="Primary navigation">{siteNavigation.map(([label,href])=><Link key={href} href={href} className="text-sm font-bold text-[#29472d] transition hover:text-[#9a7a17]">{label}</Link>)}</nav>
      <div className="hidden items-center gap-3 sm:flex"><ContactLink phone={phone}/><a href={ESTIMATE_URL} className="rounded-full bg-[#143d1a] px-5 py-3 text-sm font-extrabold text-white shadow-sm transition hover:bg-[#0d2b12]">Get an Estimate</a></div>
      <button type="button" aria-expanded={open} aria-controls="mobile-navigation" aria-label="Toggle navigation" onClick={()=>setOpen(value=>!value)} className="grid size-12 place-items-center rounded-full border border-[#143d1a]/15 bg-white text-2xl text-[#143d1a] xl:hidden">{open?"×":"☰"}</button>
    </div>
    {open&&<nav id="mobile-navigation" className="border-t border-[#143d1a]/10 bg-white px-5 py-5 xl:hidden" aria-label="Mobile navigation"><div className="mx-auto grid max-w-7xl gap-1">{siteNavigation.map(([label,href])=><Link key={href} href={href} onClick={()=>setOpen(false)} className="rounded-xl px-4 py-3 text-base font-bold text-[#143d1a] hover:bg-[#f0f4ed]">{label}</Link>)}<a href={ESTIMATE_URL} className="mt-3 rounded-xl bg-[#143d1a] px-4 py-3 text-center font-extrabold text-white">Get an Estimate</a></div></nav>}
  </header>;
}

function ContactLink({ phone }: { phone: string | null }) { return phone ? <a href={`tel:${phone.replace(/[^+\d]/g,"")}`} className="text-sm font-bold text-[#143d1a]">Call {phone}</a> : <Link href="/contact" className="text-sm font-bold text-[#143d1a]">Contact</Link>; }

export function SiteFooter({ businessName, phone, email }: { businessName: string; phone: string | null; email: string | null }) {
  return <footer className="bg-[#0d2b12] text-white"><div className="mx-auto grid max-w-7xl gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.3fr_1fr_1fr]"><div><StudioScrubzLogo size={82} className="rounded-full bg-white/95 p-1"/><p className="mt-5 text-2xl font-extrabold">{businessName}</p><p className="mt-2 font-semibold text-[#e5cd7d]">No mess. No stress.</p><p className="mt-4 max-w-sm text-sm leading-6 text-white/65">Residential and commercial cleaning support across the San Fernando Valley, Greater Los Angeles, the High Desert, and surrounding service areas.</p></div><div><h2 className="font-extrabold text-[#e5cd7d]">Explore</h2><nav className="mt-4 grid gap-3 text-sm text-white/75">{siteNavigation.slice(1).map(([label,href])=><Link key={href} href={href} className="hover:text-white">{label}</Link>)}</nav></div><div><h2 className="font-extrabold text-[#e5cd7d]">Start a conversation</h2><div className="mt-4 grid gap-3 text-sm text-white/75">{phone&&<a href={`tel:${phone.replace(/[^+\d]/g,"")}`} className="hover:text-white">{phone}</a>}{email&&<a href={`mailto:${email}`} className="break-all hover:text-white">{email}</a>}<a href={ESTIMATE_URL} className="mt-3 inline-flex w-fit rounded-full bg-[#d4af37] px-5 py-3 font-extrabold text-[#143d1a]">Request Estimate</a></div></div></div><div className="border-t border-white/10 px-5 py-5 text-center text-xs text-white/45">© {new Date().getFullYear()} {businessName}. All rights reserved.</div></footer>;
}
