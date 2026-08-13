"use client";
import type { ReactNode } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { canAccessArchives, canAccessFinances, canAccessPayrollPrep } from "@/lib/auth/permissions";

export function SensitiveRoute({ area, children }: { area: "finances" | "payroll" | "archives"; children: ReactNode }) {
  const { profile } = useAuth();
  const allowed = area === "finances" ? canAccessFinances(profile) : area === "payroll" ? canAccessPayrollPrep(profile) : canAccessArchives(profile);
  if (!allowed) return <section className="rounded-2xl border bg-white p-10 text-center"><h1 className="text-2xl font-extrabold text-[#143d1a]">Unauthorized</h1><p className="mt-3 text-neutral-600">You do not have permission to access this workspace.</p></section>;
  return <>{children}</>;
}
