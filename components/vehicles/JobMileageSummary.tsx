"use client";

import { useEffect, useState } from "react";
import { getMileageForJob } from "@/lib/services/mileage";
import { vehicleLabel } from "@/types/vehicle";
import type { MileageWithRelations } from "@/types/mileage";

export function JobMileageSummary({ jobId }: { jobId: string }) {
  const [rows, setRows] = useState<MileageWithRelations[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    void getMileageForJob(jobId).then(setRows).catch((cause) => {
      console.error("Job mileage load failed", cause);
      setError(true);
    });
  }, [jobId]);
  const active = rows.filter((row) => row.status === "Active" && !row.archived_at);
  const total = active.reduce((sum, row) => sum + row.miles, 0);
  return <section className="mt-6"><h3 className="font-extrabold text-[#143d1a]">Mileage</h3>{error ? <p className="mt-2 text-sm text-red-700">Job mileage could not be loaded.</p> : active.length ? <><div className="mt-2 overflow-x-auto"><table className="w-full text-sm"><thead><tr>{["Vehicle", "Driver / Crew", "Date", "Miles", "Purpose", "Potential Deduction"].map((label) => <th key={label} className="p-2 text-left">{label}</th>)}</tr></thead><tbody>{active.map((row) => <tr key={row.id} className="border-t"><td className="p-2">{row.vehicle ? vehicleLabel(row.vehicle) : "Deleted Vehicle"}</td><td className="p-2">{row.employee ? `${row.employee.first_name} ${row.employee.last_name}` : row.crew?.crew_name || "—"}</td><td className="p-2">{row.trip_date}</td><td className="p-2">{row.miles.toFixed(1)}</td><td className="p-2">{row.trip_purpose}</td><td className="p-2">{money(row.deductible_amount)}</td></tr>)}</tbody></table></div><p className="mt-2 font-bold">Job Mileage Total: {total.toFixed(1)} miles</p></> : <p className="mt-2 text-sm text-neutral-500">No mileage is linked to this job.</p>}</section>;
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}
