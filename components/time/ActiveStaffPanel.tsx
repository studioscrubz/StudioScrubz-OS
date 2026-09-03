"use client";

import { useEffect, useState } from "react";
import type { ActiveStaffStatus } from "@/types/workSession";

export function ActiveStaffPanel({ staff }: { staff: ActiveStaffStatus[] }) {
  const now = useCurrentTime(staff.some((row) => Boolean(row.joined_at)));
  return <section className="mt-6 rounded-2xl border border-[#143d1a]/10 bg-white p-5 shadow-sm">
    <h2 className="font-extrabold text-[#143d1a]">Active Techs</h2>
    <p className="mt-1 text-xs text-neutral-500">Platform presence and active Job participation. Presence time is not payroll time.</p>
    {staff.length === 0 && <p className="mt-4 text-sm text-neutral-500">No staff members are currently Active.</p>}
    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{staff.map((row) => {
      const onJob = row.availability === "On Job / Unavailable";
      return <div key={row.id} className={`rounded-xl border p-4 ${onJob ? "border-amber-200 bg-amber-50/60" : "border-emerald-200 bg-emerald-50/60"}`}>
        <p className="font-bold text-[#143d1a]">{row.employee_name}</p>
        <p className={`mt-1 text-sm font-extrabold ${onJob ? "text-amber-700" : "text-emerald-700"}`}>● {row.availability.toUpperCase()}</p>
        {onJob && row.joined_at ? <><p className="mt-2 text-xs text-neutral-600">Joined: {displayTime(row.joined_at)}</p><p className="text-xs text-neutral-600">Time on this Job: {compactElapsed(now - Date.parse(row.joined_at))}</p><p className="mt-1 text-xs font-bold text-[#143d1a]">Job {row.job_number}</p></> : <p className="mt-2 text-xs text-neutral-600">Available for assignment</p>}
      </div>;
    })}</div>
  </section>;
}

function useCurrentTime(ticking:boolean){const[now,setNow]=useState(()=>Date.now());useEffect(()=>{if(!ticking)return;const id=window.setInterval(()=>setNow(Date.now()),30000);return()=>window.clearInterval(id)},[ticking]);return now}
function compactElapsed(ms:number){const minutes=Math.max(0,Math.floor(ms/60000));const hours=Math.floor(minutes/60);return hours?`${hours}h ${minutes%60}m`:`${minutes}m`}
function displayTime(value:string){return new Date(value).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}
