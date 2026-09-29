"use client";

import { useEffect, useState } from "react";
import type { ScrubTechRosterStatus } from "@/components/time/DashboardActiveEmployeesMonitor";

export function ActiveStaffPanel({ staff, showPresence }: { staff: ScrubTechRosterStatus[]; showPresence: boolean }) {
  const now = useCurrentTime(showPresence && staff.some((row) => Boolean(row.joined_at)));
  return <section className="mt-4 rounded-2xl border border-[#143d1a]/10 bg-white px-4 py-3 shadow-sm">
    <h2 className="font-extrabold text-[#143d1a]">Active Scrub Technicians</h2>
    <p className="mt-0.5 text-xs text-neutral-500">Current active technician roster.{showPresence && " Presence is not payroll time."}</p>
    {staff.length === 0 && <p className="mt-3 text-sm text-neutral-500">No Active Scrub Technicians.</p>}
    <div className="mt-2 divide-y divide-neutral-100">{staff.map((row) => {
      const onJob = row.availability === "On Job / Unavailable";
      const available = row.availability === "Available";
      return <div key={row.employee_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-1 last:pb-1">
        <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${!showPresence ? "bg-[#143d1a]" : onJob ? "bg-amber-500" : available ? "bg-emerald-500" : "bg-neutral-400"}`}/>
        <p className="min-w-0 flex-1 truncate text-sm font-bold text-[#143d1a]">{row.employee_name}</p>
        {showPresence && <p className={`text-xs font-bold ${onJob ? "text-amber-700" : available ? "text-emerald-700" : "text-neutral-500"}`}>{row.availability}</p>}
        {showPresence && onJob && row.joined_at && <p className="w-full pl-[22px] text-xs text-neutral-500">Job {row.job_number} · joined {displayTime(row.joined_at)} · {compactElapsed(now - Date.parse(row.joined_at))}</p>}
      </div>;
    })}</div>
  </section>;
}

function useCurrentTime(ticking:boolean){const[now,setNow]=useState(()=>Date.now());useEffect(()=>{if(!ticking)return;const id=window.setInterval(()=>setNow(Date.now()),30000);return()=>window.clearInterval(id)},[ticking]);return now}
function compactElapsed(ms:number){const minutes=Math.max(0,Math.floor(ms/60000));const hours=Math.floor(minutes/60);return hours?`${hours}h ${minutes%60}m`:`${minutes}m`}
function displayTime(value:string){return new Date(value).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}
