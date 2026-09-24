"use client";

import { useEffect, useState } from "react";
import type { ActiveStaffStatus } from "@/types/workSession";

export function ActiveStaffPanel({ staff }: { staff: ActiveStaffStatus[] }) {
  const now = useCurrentTime(staff.some((row) => Boolean(row.joined_at)));
  return <section className="mt-4 rounded-2xl border border-[#143d1a]/10 bg-white px-4 py-3 shadow-sm">
    <h2 className="font-extrabold text-[#143d1a]">Active Techs</h2>
    <p className="mt-0.5 text-xs text-neutral-500">Presence is not payroll time.</p>
    {staff.length === 0 && <p className="mt-3 text-sm text-neutral-500">No staff members are currently Active.</p>}
    <div className="mt-2 divide-y divide-neutral-100">{staff.map((row) => {
      const onJob = row.availability === "On Job / Unavailable";
      return <div key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-1 last:pb-1">
        <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${onJob ? "bg-amber-500" : "bg-emerald-500"}`}/>
        <p className="min-w-0 flex-1 truncate text-sm font-bold text-[#143d1a]">{row.employee_name}</p>
        <p className={`text-xs font-bold ${onJob ? "text-amber-700" : "text-emerald-700"}`}>{onJob ? "On Job / Unavailable" : "Available"}</p>
        {onJob && row.joined_at && <p className="w-full pl-[22px] text-xs text-neutral-500">Job {row.job_number} · joined {displayTime(row.joined_at)} · {compactElapsed(now - Date.parse(row.joined_at))}</p>}
      </div>;
    })}</div>
  </section>;
}

function useCurrentTime(ticking:boolean){const[now,setNow]=useState(()=>Date.now());useEffect(()=>{if(!ticking)return;const id=window.setInterval(()=>setNow(Date.now()),30000);return()=>window.clearInterval(id)},[ticking]);return now}
function compactElapsed(ms:number){const minutes=Math.max(0,Math.floor(ms/60000));const hours=Math.floor(minutes/60);return hours?`${hours}h ${minutes%60}m`:`${minutes}m`}
function displayTime(value:string){return new Date(value).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}
