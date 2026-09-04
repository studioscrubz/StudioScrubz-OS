"use client";

import Link from "next/link";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { useAuth } from "@/components/auth/AuthProvider";
import { hasPermission } from "@/lib/auth/permissions";
export default function Page(){const{profile}=useAuth(),canManageSettings=hasPermission(profile,"settings.manage");return <><header className="border-b pb-7"><h1 className="text-3xl font-extrabold text-[#143d1a]">Settings</h1><p className="mt-3 text-neutral-600">Configure StudioScrubz services, pricing, and business defaults.</p></header><div className="mt-7 grid gap-5 md:grid-cols-2">{canManageSettings&&<><Link href="/settings/services" className="rounded-2xl border bg-white p-6"><h2 className="text-xl font-extrabold text-[#143d1a]">Service Catalog</h2><p className="mt-2 text-sm text-neutral-500">Manage services, price tiers, add-ons, and recurring rates.</p></Link><Link href="/settings/business" className="rounded-2xl border bg-white p-6"><h2 className="text-xl font-extrabold text-[#143d1a]">Business Settings</h2><p className="mt-2 text-sm text-neutral-500">Manage company and document defaults.</p></Link></>}<AppearanceSettings/></div></>}
