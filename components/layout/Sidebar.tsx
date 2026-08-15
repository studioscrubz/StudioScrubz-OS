"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { StudioScrubzLogo } from "@/components/branding/StudioScrubzLogo";
import { useAuth } from "@/components/auth/AuthProvider";
import { hasPermission, type Permission } from "@/lib/auth/permissions";

type NavLink = { label: string; href: string; marker: string; permission: Permission };
type NavGroup = { label: string; marker: string; permission?: Permission; children: NavLink[] };

const navItems: Array<NavLink | NavGroup> = [
  {
    label: "Dashboard",
    marker: "D",
    children: [
      { label: "Dashboard", href: "/", marker: "", permission: "dashboard.view" },
      { label: "Attention Center", href: "/attention", marker: "", permission: "attention.view" },
      { label: "Schedule", href: "/schedule", marker: "", permission: "schedule.view" },
    ],
  },
  {
    label: "Estimates",
    marker: "E",
    children: [
      { label: "Estimate Calculator", href: "/estimates", marker: "", permission: "estimates.create" },
      { label: "Open Estimates", href: "/open-estimates", marker: "", permission: "estimates.view" },
    ],
  },
  { label: "Walkthroughs", href: "/walkthroughs", marker: "W", permission: "walkthroughs.view" },
  {
    label: "Proposals",
    marker: "P",
    children: [
      { label: "Proposal Calculator", href: "/proposals", marker: "", permission: "proposals.create" },
      { label: "Open Proposals", href: "/open-proposals", marker: "", permission: "proposals.view" },
      { label: "Service Agreements", href: "/agreements", marker: "", permission: "agreements.view" },
    ],
  },
  { label: "Jobs", href: "/jobs", marker: "J", permission: "jobs.view" },
  { label: "Clients", href: "/clients", marker: "C", permission: "clients.view" },
  { label: "Properties", href: "/properties", marker: "P", permission: "properties.view" },
  {
    label: "Employees",
    marker: "E",
    children: [
      { label: "Employee Directory", href: "/employees", marker: "", permission: "employees.directory_view" },
      { label: "Scrub Technicians", href: "/employees/scrub-technicians", marker: "", permission: "employees.view" },
      { label: "Sales", href: "/employees/sales", marker: "", permission: "employees.view" },
      { label: "Administration / Management", href: "/employees/administration", marker: "", permission: "employees.view" },
      { label: "Time Clock", href: "/time-clock", marker: "", permission: "timeClock.view" },
    ],
  },
  {
    label: "Finances",
    marker: "F",
    children: [
      { label: "Revenue", href: "/revenue", marker: "", permission: "finances.view" },
      { label: "Expenses", href: "/expenses", marker: "", permission: "expenses.view" },
      { label: "Vehicles", href: "/vehicles", marker: "", permission: "vehicles.view" },
      { label: "Payroll Preparation", href: "/payroll-prep", marker: "", permission: "payrollPrep.view" },
      { label: "Invoices", href: "/invoices", marker: "", permission: "invoices.view" },
    ],
  },
  {
    label: "User Management",
    marker: "U",
    children: [
      { label: "Users", href: "/users", marker: "", permission: "users.manage" },
      { label: "Archives", href: "/archives", marker: "", permission: "archives.view" },
    ],
  },
  {
    label: "Settings",
    marker: "S",
    permission: "settings.manage",
    children: [
      { label: "Service Catalog", href: "/settings/services", marker: "", permission: "settings.manage" },
      { label: "Business Settings", href: "/settings/business", marker: "", permission: "settings.manage" },
    ],
  },
];

function isGroup(item: NavLink | NavGroup): item is NavGroup {
  return "children" in item;
}

export function Sidebar({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const auth = useAuth();
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const visibleItems = navItems.reduce<Array<NavLink | NavGroup>>((items, item) => {
    if (!isGroup(item)) return hasPermission(auth.profile, item.permission) ? [...items, item] : items;
    if (item.permission && !hasPermission(auth.profile, item.permission)) return items;
    const children = item.children.filter((child) => hasPermission(auth.profile, child.permission));
    return children.length ? [...items, { ...item, children }] : items;
  }, []);
  const initiallyOpen = Object.fromEntries(
    visibleItems.filter(isGroup).map((group) => [group.label, group.children.some((item) => item.href === pathname)]),
  );
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(initiallyOpen);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#143d1a] text-white shadow-2xl shadow-[#07190a]/25 lg:shadow-none">
      <div className="relative flex items-start justify-between border-b border-white/10 px-6 py-5">
        <div className="flex-1 text-center">
          <StudioScrubzLogo size={112} priority className="mx-auto drop-shadow-[0_8px_18px_rgba(0,0,0,.24)]" />
          <p className="mt-1 text-xs font-bold uppercase tracking-[0.28em] text-[#d4af37]">Operations System</p>
          <div className="mt-5 border-l-2 border-[#d4af37] pl-3 text-xs leading-relaxed text-white/65">
            <p className="font-bold text-white/90">{auth.profile?.role ?? "StudioScrubz User"}</p>
            <p>Operations</p>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close navigation" className="grid size-9 place-items-center rounded-lg text-xl text-white/70 hover:bg-white/10 lg:hidden">×</button>
      </div>

      <nav aria-label="Primary navigation" className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {visibleItems.map((item) => {
            if (isGroup(item)) {
              const active = item.children.some((child) => child.href === pathname);
              const open = active || (openGroups[item.label] ?? false);
              return (
                <li key={item.label}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpenGroups((current) => ({ ...current, [item.label]: !open }))}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition ${active ? "bg-white/10 text-white" : "text-white/72 hover:bg-white/[.07] hover:text-white"}`}
                  >
                    <NavMarker value={item.marker} />
                    <span className="flex-1">{item.label}</span>
                    <span aria-hidden className={`text-xs text-white/45 transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
                  </button>
                  {open && (
                    <ul className="mb-2 ml-[27px] mt-1 space-y-0.5 border-l border-white/15 pl-3">
                      {item.children.map((child) => <NavItem key={child.href} item={child} active={child.href === pathname} onNavigate={onClose} />)}
                    </ul>
                  )}
                </li>
              );
            }
            return <NavItem key={item.href} item={item} active={item.href === pathname} onNavigate={onClose} />;
          })}
        </ul>
      </nav>

      <div className="border-t border-white/10 p-3">
        {signOutError && <p role="alert" className="mb-2 rounded-lg bg-red-950/40 px-3 py-2 text-xs text-red-100">{signOutError}</p>}
        <div className="mb-2 px-3 text-xs text-white/65"><p className="font-bold text-white">{auth.profile?.display_name || auth.profile?.email || "StudioScrubz User"}</p><p>{auth.profile?.role}</p></div>
        <button type="button" onClick={() => { setSignOutError(null); void auth.signOut().then(() => router.replace("/login")).catch((error: unknown) => { console.error("Sign out failed", error); setSignOutError(error instanceof Error ? error.message : "Sign out failed. Please try again."); }); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold text-white/65 transition hover:bg-white/[.07] hover:text-white">
          <NavMarker value="↗" />
          Sign Out
        </button>
      </div>
    </div>
  );
}

function NavMarker({ value }: { value: string }) {
  return <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-md border border-white/10 bg-white/[.06] text-[10px] font-extrabold text-[#d4af37]">{value}</span>;
}

function NavItem({ item, active, onNavigate }: { item: NavLink; active: boolean; onNavigate: () => void }) {
  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${active ? "bg-[#d4af37] text-[#143d1a] shadow-sm" : "text-white/72 hover:bg-white/[.07] hover:text-white"}`}
      >
        {item.marker && <NavMarker value={item.marker} />}
        <span>{item.label}</span>
      </Link>
    </li>
  );
}
