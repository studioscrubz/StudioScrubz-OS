"use client";

import { useEffect, useState } from "react";
import { getMileageForJob, MILEAGE_CHANGED_EVENT } from "@/lib/services/mileage";
import { vehicleLabel } from "@/types/vehicle";
import { useAuth } from "@/components/auth/AuthProvider";
import { getGpsMileageForJob } from "@/lib/services/gpsMileage";
import { GPS_DISTANCE_NOTICE, type GpsMileageSummary } from "@/types/gpsMileage";

export function JobMileageSummary({ jobId }: { jobId: string }) {
  const { profile, loading } = useAuth();
  const role = profile?.role;
  const [rows, setRows] = useState<Array<GpsMileageSummary & { note?: string | null }>>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (loading || !role) return;
    let disposed = false;
    let revision = 0;
    const refresh = () => {
      const request = ++revision;
      const query = role === "Master Admin"
        ? getMileageForJob(jobId).then(entries => entries.filter(row => row.status === "Active" && !row.archived_at).map(row => ({ id: row.id, trip_date: row.trip_date, miles: row.miles, trip_purpose: row.trip_purpose, vehicle_label: row.vehicle ? vehicleLabel(row.vehicle) : "Deleted Vehicle", employee_name: row.employee ? `${row.employee.first_name} ${row.employee.last_name}` : row.crew?.crew_name || "—", deductible_amount: row.deductible_amount, note: row.notes })))
        : getGpsMileageForJob(jobId).then(entries => entries.map(row => ({ ...row, note: GPS_DISTANCE_NOTICE })));
      void query.then((nextRows) => {
        if (disposed || request !== revision) return;
        setRows(nextRows);
        setError(false);
      }).catch((cause) => {
        if (disposed || request !== revision) return;
        console.error("Job mileage load failed", cause);
        setError(true);
      });
    };
    window.addEventListener(MILEAGE_CHANGED_EVENT, refresh);
    refresh();
    return () => {
      disposed = true;
      window.removeEventListener(MILEAGE_CHANGED_EVENT, refresh);
    };
  }, [jobId, role, loading]);
  const active = rows;
  const total = active.reduce((sum, row) => sum + row.miles, 0);
  return <section className="mt-6"><h3 className="font-extrabold text-[#143d1a]">Mileage</h3>{error ? <p className="mt-2 text-sm text-red-700">Job mileage could not be loaded.</p> : active.length ? <><div className="mt-2 overflow-x-auto"><table className="w-full text-sm"><thead><tr>{["Vehicle", "Driver / Crew", "Date", "Miles", "Purpose", "Potential Deduction"].map((label) => <th key={label} className="p-2 text-left">{label}</th>)}</tr></thead><tbody>{active.map((row) => <tr key={row.id} className="border-t"><td className="p-2">{row.vehicle_label}</td><td className="p-2">{row.employee_name}</td><td className="p-2">{row.trip_date}</td><td className="p-2">{row.miles.toFixed(1)}</td><td className="p-2">{row.trip_purpose}{row.note === GPS_DISTANCE_NOTICE && <p className="text-xs text-neutral-500">{GPS_DISTANCE_NOTICE}</p>}</td><td className="p-2">{money(row.deductible_amount)}</td></tr>)}</tbody></table></div><p className="mt-2 font-bold">Job Mileage Total: {total.toFixed(1)} miles</p></> : <p className="mt-2 text-sm text-neutral-500">No mileage is linked to this job.</p>}</section>;
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}
