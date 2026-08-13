"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BrandMark } from "./AppShell";

type NavLink = { label: string; href: string; marker: string };
type NavGroup = { label: string; marker: string; children: NavLink[] };

const navItems: Array<NavLink | NavGroup> = [
  { label: "Dashboard", href: "/", marker: "D" },
  { label: "Clients", href: "/clients", marker: "C" },
  { label: "Properties", href: "/properties", marker: "P" },
  { label: "Walkthroughs", href: "/walkthroughs", marker: "W" },
  {
    label: "Estimates",
    marker: "E",
    children: [
      { label: "Estimate Calculator", href: "/estimates", marker: "" },
      { label: "Open Estimates", href: "/open-estimates", marker: "" },
    ],
  },
  {
    label: "Proposals",
    marker: "P",
    children: [
      { label: "Proposal Calculator", href: "/proposals", marker: "" },
      { label: "Open Proposals", href: "/open-proposals", marker: "" },
    ],
  },
  { label: "Jobs", href: "/jobs", marker: "J" },
  { label: "Service Agreements", href: "/agreements", marker: "A" },
  { label: "Schedule", href: "/schedule", marker: "S" },
  {
    label: "Employees",
    marker: "E",
    children: [
      { label: "Employee Directory", href: "/employees", marker: "" },
      { label: "Scrub Technicians", href: "/employees/scrub-technicians", marker: "" },
      { label: "Sales", href: "/employees/sales", marker: "" },
      { label: "Administration / Management", href: "/employees/administration", marker: "" },
      { label: "Time Clock", href: "/time-clock", marker: "" },
      { label: "Payroll Preparation", href: "/payroll-prep", marker: "" },
    ],
  },
  { label: "Invoices", href: "/invoices", marker: "I" },
  {
    label: "Finances",
    marker: "F",
    children: [
      { label: "Revenue", href: "/revenue", marker: "" },
      { label: "Expenses", href: "/expenses", marker: "" },
      { label: "Vehicles", href: "/vehicles", marker: "" },
    ],
  },
  { label: "Archives", href: "/archives", marker: "A" },
  { label: "Settings", href: "/settings", marker: "S" },
];

function isGroup(item: NavLink | NavGroup): item is NavGroup {
  return "children" in item;
}

export function Sidebar({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();
  const initiallyOpen = Object.fromEntries(
    navItems.filter(isGroup).map((group) => [group.label, group.children.some((item) => item.href === pathname)]),
  );
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(initiallyOpen);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#143d1a] text-white shadow-2xl shadow-[#07190a]/25 lg:shadow-none">
      <div className="flex items-start justify-between border-b border-white/10 px-6 py-6">
        <div>
          <div className="flex items-center gap-3">
            <BrandMark />
            <div>
              <p className="text-lg font-extrabold leading-tight tracking-[-0.03em]">StudioScrubz</p>
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#d4af37]">OS</p>
            </div>
          </div>
          <div className="mt-5 border-l-2 border-[#d4af37] pl-3 text-xs leading-relaxed text-white/65">
            <p className="font-bold text-white/90">Master Admin</p>
            <p>Operations</p>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close navigation" className="grid size-9 place-items-center rounded-lg text-xl text-white/70 hover:bg-white/10 lg:hidden">×</button>
      </div>

      <nav aria-label="Primary navigation" className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {navItems.map((item) => {
            if (isGroup(item)) {
              const active = item.children.some((child) => child.href === pathname);
              const open = openGroups[item.label] ?? false;
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
        <button type="button" className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold text-white/65 transition hover:bg-white/[.07] hover:text-white">
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
