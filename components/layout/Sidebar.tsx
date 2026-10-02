"use client";



import Link from "next/link";

import { usePathname } from "next/navigation";

import { useRouter } from "next/navigation";

import { useState } from "react";

import { useEffect } from "react";

import { StudioScrubzLogo } from "@/components/branding/StudioScrubzLogo";

import { useAuth } from "@/components/auth/AuthProvider";

import { hasPermission, type Permission } from "@/lib/auth/permissions";

import { getAttentionSummary } from "@/lib/services/attention";

import { useAttentionRefresh } from "@/components/attention/useAttentionRefresh";

import { getUnreadDirectMessageCount } from "@/lib/services/messaging";

import { useOperationalRealtime } from "@/components/realtime/OperationalRealtimeProvider";



type NavLink = {

  label: string;

  href: string;

  marker: string;

  permission: Permission;

};



type NavGroup = {

  label: string;

  marker: string;

  permission?: Permission;

  children: NavLink[];

};



const navItems: Array<NavLink | NavGroup> = [

  {

    label: "Home",

    href: "/lead-rep",

    marker: "H",

    permission: "leadRep.portal",

  },

  {

    label: "My Leads",

    href: "/lead-rep/leads",

    marker: "L",

    permission: "leadRep.leads.viewOwn",

  },

  {

    label: "Dashboard",

    href: "/",

    marker: "D",

    permission: "dashboard.view",

  },

  {

    label: "Schedule",

    href: "/schedule",

    marker: "S",

    permission: "schedule.view",

  },

  {

    label: "Estimates",

    marker: "E",

    children: [

      {

        label: "Estimate Calculator",

        href: "/estimates",

        marker: "",

        permission: "estimates.create",

      },

      {

        label: "Open Estimates",

        href: "/open-estimates",

        marker: "",

        permission: "estimates.view",

      },

    ],

  },

  {

    label: "Sales Assessments",

    marker: "S",

    children: [

      {

        label: "Assessments",

        href: "/walkthroughs",

        marker: "S",

        permission: "walkthroughs.view",

      },

      {

        label: "Assigned Walkthroughs",

        href: "/field-walkthroughs",

        marker: "W",

        permission: "walkthroughs.field",

      },

      {

        label: "Prospects",

        href: "/prospects",

        marker: "P",

        permission: "prospects.view",

      },

    ],

  },

  {

    label: "Proposals",

    marker: "P",

    children: [

      {

        label: "Proposal Calculator",

        href: "/proposals",

        marker: "",

        permission: "proposals.create",

      },

      {

        label: "Open Proposals",

        href: "/open-proposals",

        marker: "",

        permission: "proposals.view",

      },

    ],

  },

  {

    label: "Jobs",

    marker: "J",

    children: [

      {

        label: "Jobs",

        href: "/jobs",

        marker: "J",

        permission: "jobs.view",

      },

      {

        label: "Job Performance",

        href: "/job-performance",

        marker: "R",

        permission: "reports.view",

      },

    ],

  },

  {

    label: "Porter Hub",

    marker: "P",

    children: [

      {

        label: "Property Service Plans",

        href: "/properties/service-plans",

        marker: "",

        permission: "propertyServicePlans.manage",

      },

      {

        label: "Porter Visits",

        href: "/properties/porter-visits",

        marker: "",

        permission: "porterVisits.view",

      },

      {

        label: "Porter Routes",

        href: "/properties/porter-routes",

        marker: "",

        permission: "porterVisits.view",

      },

      {

        label: "Property Service Reports",

        href: "/properties/service-reports",

        marker: "",

        permission: "porterVisits.manage",

      },

    ],

  },

  {

    label: "Invoices",

    href: "/invoices",

    marker: "I",

    permission: "invoices.view",

  },

  {

    label: "Accounts",

    marker: "A",

    children: [

      {

        label: "Service Agreements",

        href: "/agreements",

        marker: "A",

        permission: "agreements.view",

      },

      {

        label: "Clients",

        href: "/clients",

        marker: "C",

        permission: "clients.view",

      },

      {

        label: "Properties",

        href: "/properties",

        marker: "P",

        permission: "properties.view",

      },

    ],

  },

  {

    label: "Marketing Materials",

    marker: "M",

    children: [

      {

        label: "Marketing Materials",

        href: "/marketing-materials",

        marker: "",

        permission: "marketingMaterials.send",

      },

      {

        label: "Vendor Packets",

        href: "/vendor-packets",

        marker: "V",

        permission: "estimates.create",

      },

    ],

  },

  {

    label: "Employees",

    marker: "E",

    children: [

      {

        label: "Employee Directory",

        href: "/employees",

        marker: "",

        permission: "employees.directory_view",

      },

      {

        label: "Scrub Technicians",

        href: "/employees/scrub-technicians",

        marker: "",

        permission: "employees.scrubTechRosterView",

      },

      {

        label: "Sales",

        href: "/employees/sales",

        marker: "",

        permission: "employees.view",

      },

      {

        label: "Administration / Management",

        href: "/employees/administration",

        marker: "",

        permission: "employees.view",

      },

      {

        label: "Applications",

        href: "/applications",

        marker: "",

        permission: "jobApplications.manage",

      },

      {

        label: "Time Clock",

        href: "/time-clock",

        marker: "",

        permission: "timeClock.view",

      },

    ],

  },

  {

    label: "Finances",

    marker: "F",

    children: [

      {

        label: "Revenue",

        href: "/revenue",

        marker: "",

        permission: "finances.view",

      },

      {

        label: "Expenses",

        href: "/expenses",

        marker: "",

        permission: "expenses.view",

      },

      {

        label: "Vehicles",

        href: "/vehicles",

        marker: "",

        permission: "vehicles.view",

      },

      {

        label: "Payroll Preparation",

        href: "/payroll-prep",

        marker: "",

        permission: "payrollPrep.view",

      },

    ],

  },

  {

    label: "User Management",

    marker: "U",

    children: [

      {

        label: "Users",

        href: "/users",

        marker: "",

        permission: "users.manage",

      },

      {

        label: "Archives",

        href: "/archives",

        marker: "",

        permission: "archives.view",

      },

    ],

  },

  {

    label: "Settings",

    marker: "S",

    children: [

      {

        label: "Appearance",

        href: "/settings",

        marker: "",

        permission: "appearance.view",

      },

      {

        label: "Notifications",

        href: "/settings/notifications",

        marker: "",

        permission: "attention.view",

      },

      {

        label: "Service Catalog",

        href: "/settings/services",

        marker: "",

        permission: "settings.manage",

      },

      {

        label: "Business Settings",

        href: "/settings/business",

        marker: "",

        permission: "settings.manage",

      },

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

  const [attentionCount, setAttentionCount] = useState(0);

  const [messageCount, setMessageCount] = useState(0);



  async function loadAttentionCount() {

    if (!hasPermission(auth.profile, "attention.view")) {

      return setAttentionCount(0);

    }



    setAttentionCount((await getAttentionSummary()).total);

  }



  useEffect(() => {

    let active = true;



    if (!hasPermission(auth.profile, "attention.view")) return;



    void getAttentionSummary()

      .then((summary) => {

        if (active) setAttentionCount(summary.total);

      })

      .catch((cause) =>

        console.error("Attention badge load failed", cause),

      );



    return () => {

      active = false;

    };

  }, [auth.profile]);



  useAttentionRefresh(loadAttentionCount);



  async function loadMessageCount() {

    if (!auth.user || !hasPermission(auth.profile, "messages.view")) {

      return setMessageCount(0);

    }



    try {

      setMessageCount(await getUnreadDirectMessageCount(auth.user.id));

    } catch (error) {

      console.error("Messages badge load failed", error);

    }

  }



  useOperationalRealtime(

    ["conversations", "conversation_members", "messages", "message_read_states"],

    loadMessageCount,

  );



  useEffect(() => {

    const timer = window.setTimeout(() => {

      void loadMessageCount();

    }, 0);



    return () => window.clearTimeout(timer);

  }, [auth.profile, auth.user]);



  const visibleItems = navItems.reduce<Array<NavLink | NavGroup>>(

    (items, item) => {

      if (!isGroup(item)) {

        return hasPermission(auth.profile, item.permission)

          ? [...items, item]

          : items;

      }



      if (

        item.permission &&

        !hasPermission(auth.profile, item.permission)

      ) {

        return items;

      }



      const children = item.children.filter((child) =>

        hasPermission(auth.profile, child.permission),

      );



      return children.length

        ? [...items, { ...item, children }]

        : items;

    },

    [],

  );



  const initiallyOpen = Object.fromEntries(

    visibleItems

      .filter(isGroup)

      .map((group) => [

        group.label,

        group.children.some((item) => item.href === pathname),

      ]),

  );



  const [openGroups, setOpenGroups] =

    useState<Record<string, boolean>>(initiallyOpen);



  return (

    <div className="flex h-full flex-col overflow-hidden bg-[#143d1a] text-white shadow-2xl shadow-[#07190a]/25 lg:shadow-none">

      <div className="relative flex items-start justify-between border-b border-white/10 px-6 py-5">

        {hasPermission(auth.profile, "attention.view") && (

          <Link

            href="/attention"

            onClick={onClose}

            aria-label="Attention Center"

            title="Attention Center"

            className={`absolute left-3 top-3 grid size-10 place-items-center rounded-lg transition ${

              pathname === "/attention"

                ? "bg-[#d4af37] text-[#143d1a]"

                : "text-white/75 hover:bg-white/10 hover:text-white"

            }`}

          >

            <svg

              aria-hidden="true"

              viewBox="0 0 24 24"

              fill="none"

              stroke="currentColor"

              strokeWidth="1.8"

              className="size-5"

            >

              <path

                strokeLinecap="round"

                strokeLinejoin="round"

                d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"

              />

              <path

                strokeLinecap="round"

                strokeLinejoin="round"

                d="M10 21h4"

              />

            </svg>



            {Boolean(attentionCount) && (

              <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-[#d4af37] px-1 text-center text-[10px] font-extrabold leading-5 text-[#143d1a]">

                {attentionCount}

              </span>

            )}

          </Link>

        )}



        {hasPermission(auth.profile, "messages.view") && (

          <Link

            href="/messages"

            onClick={onClose}

            aria-label="Messages"

            title="Messages"

            className={`absolute right-3 top-3 grid size-10 place-items-center rounded-lg transition ${

              pathname === "/messages"

                ? "bg-[#d4af37] text-[#143d1a]"

                : "text-white/75 hover:bg-white/10 hover:text-white"

            }`}

          >

            <svg

              aria-hidden="true"

              viewBox="0 0 24 24"

              fill="none"

              stroke="currentColor"

              strokeWidth="1.8"

              className="size-5"

            >

              <path

                strokeLinecap="round"

                strokeLinejoin="round"

                d="M7.5 18.75 3 21v-4.5A8.25 8.25 0 1 1 7.5 18.75Z"

              />

            </svg>



            {Boolean(messageCount) && (

              <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-[#d4af37] px-1 text-center text-[10px] font-extrabold leading-5 text-[#143d1a]">

                {messageCount}

              </span>

            )}

          </Link>

        )}



        <div className="flex-1 text-center">

          <StudioScrubzLogo

            size={112}

            priority

            className="mx-auto drop-shadow-[0_8px_18px_rgba(0,0,0,.24)]"

          />



          <p className="mt-1 text-xs font-bold uppercase tracking-[0.28em] text-[#d4af37]">

            Operations System

          </p>



          <div className="mt-5 border-l-2 border-[#d4af37] pl-3 text-xs leading-relaxed text-white/65">

            <p className="font-bold text-white/90">

              {auth.profile?.role ?? "StudioScrubz User"}

            </p>

            <p>Operations</p>

          </div>

        </div>



        <button

          type="button"

          onClick={onClose}

          aria-label="Close navigation"

          className="absolute right-3 top-14 grid size-9 place-items-center rounded-lg text-xl text-white/70 hover:bg-white/10 lg:hidden"

        >

          ×

        </button>

      </div>



      <nav

        aria-label="Primary navigation"

        className="flex-1 overflow-y-auto px-3 py-4"

      >

        <ul className="space-y-1">

          {visibleItems.map((item) => {

            if (isGroup(item)) {

              const active = item.children.some(

                (child) => child.href === pathname,

              );



              const open =

                active || (openGroups[item.label] ?? false);



              return (

                <li key={item.label}>

                  <button

                    type="button"

                    aria-expanded={open}

                    onClick={() =>

                      setOpenGroups((current) => ({

                        ...current,

                        [item.label]: !open,

                      }))

                    }

                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition ${

                      active

                        ? "bg-white/10 text-white"

                        : "text-white/72 hover:bg-white/[.07] hover:text-white"

                    }`}

                  >

                    <NavMarker value={item.marker} />

                    <span className="flex-1">{item.label}</span>



                    <span

                      aria-hidden

                      className={`text-xs text-white/45 transition-transform ${

                        open ? "rotate-180" : ""

                      }`}

                    >

                      ⌄

                    </span>

                  </button>



                  {open && (

                    <ul className="mb-2 ml-[27px] mt-1 space-y-0.5 border-l border-white/15 pl-3">

                      {item.children.map((child) => (

                        <NavItem

                          key={child.href}

                          item={child}

                          active={child.href === pathname}

                          onNavigate={onClose}

                        />

                      ))}

                    </ul>

                  )}

                </li>

              );

            }



            return (

              <NavItem

                key={item.href}

                item={item}

                active={item.href === pathname}

                onNavigate={onClose}

              />

            );

          })}

        </ul>

      </nav>



      <div className="border-t border-white/10 p-3">

        {signOutError && (

          <p

            role="alert"

            className="mb-2 rounded-lg bg-red-950/40 px-3 py-2 text-xs text-red-100"

          >

            {signOutError}

          </p>

        )}



        <div className="mb-2 px-3 text-xs text-white/65">

          <p className="font-bold text-white">

            {auth.profile?.display_name ||

              auth.profile?.email ||

              "StudioScrubz User"}

          </p>

          <p>{auth.profile?.role}</p>

        </div>



        <button

          type="button"

          onClick={() => {

            setSignOutError(null);



            void auth

              .signOut()

              .then(() => router.replace("/login"))

              .catch((error: unknown) => {

                console.error("Sign out failed", error);



                setSignOutError(

                  error instanceof Error

                    ? error.message

                    : "Sign out failed. Please try again.",

                );

              });

          }}

          className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold text-white/65 transition hover:bg-white/[.07] hover:text-white"

        >

          <NavMarker value="↗" />

          Sign Out

        </button>

      </div>

    </div>

  );

}



function NavMarker({ value }: { value: string }) {

  return (

    <span

      aria-hidden

      className="grid size-7 shrink-0 place-items-center rounded-md border border-white/10 bg-white/[.06] text-[10px] font-extrabold text-[#d4af37]"

    >

      {value}

    </span>

  );

}



function NavItem({

  item,

  active,

  onNavigate,

}: {

  item: NavLink;

  active: boolean;

  onNavigate: () => void;

}) {

  return (

    <li>

      <Link

        href={item.href}

        onClick={onNavigate}

        aria-current={active ? "page" : undefined}

        className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${

          active

            ? "bg-[#d4af37] text-[#143d1a] shadow-sm"

            : "text-white/72 hover:bg-white/[.07] hover:text-white"

        }`}

      >

        {item.marker && <NavMarker value={item.marker} />}

        <span>{item.label}</span>

      </Link>

    </li>

  );

}
