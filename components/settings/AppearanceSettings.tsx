"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

export function AppearanceSettings() {
  const [theme,setTheme]=useState<Theme>("light");
  useEffect(()=>{setTheme(document.documentElement.dataset.theme==="dark"?"dark":"light")},[]);
  function choose(next:Theme){setTheme(next);document.documentElement.dataset.theme=next;try{localStorage.setItem("studioscrubz-theme",next)}catch{}}
  return <section className="rounded-2xl border bg-white p-6"><h2 className="text-xl font-extrabold text-[#143d1a]">Appearance</h2><p className="mt-2 text-sm text-neutral-500">Choose how StudioScrubz OS appears in this browser.</p><div className="mt-5 grid grid-cols-2 gap-3" role="group" aria-label="Appearance"><ThemeButton label="Light" active={theme==="light"} choose={()=>choose("light")}/><ThemeButton label="Dark" active={theme==="dark"} choose={()=>choose("dark")}/></div></section>;
}

function ThemeButton({label,active,choose}:{label:"Light"|"Dark";active:boolean;choose:()=>void}){return <button type="button" aria-pressed={active} onClick={choose} className={`rounded-xl border px-4 py-3 text-sm font-extrabold transition ${active?"border-[#d4af37] bg-[#143d1a] text-white":"bg-white text-neutral-600"}`}>{label}</button>}
