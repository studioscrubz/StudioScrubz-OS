import type { UserProfile, UserRole } from "@/types/auth";

export const PERMISSIONS = [
  "dashboard.view", "clients.view", "clients.create", "clients.edit", "clients.archive",
  "properties.view", "properties.create", "properties.edit", "properties.archive",
  "estimates.view", "estimates.create", "estimates.edit",
  "walkthroughs.view", "walkthroughs.create", "walkthroughs.edit",
  "proposals.view", "proposals.create", "proposals.approve", "proposals.send",
  "jobs.view", "jobs.create", "jobs.edit", "jobs.schedule", "jobs.complete", "jobs.archive",
  "schedule.view", "schedule.edit", "employees.directory_view", "employees.view", "employees.manage",
  "crews.view", "crews.manage", "timeClock.view", "timeClock.manageAll",
  "payrollPrep.view", "agreements.view", "agreements.manage",
  "invoices.view", "invoices.create", "invoices.edit", "invoices.recordPayment",
  "finances.view", "expenses.view", "expenses.manage", "vehicles.view", "vehicles.manage",
  "archives.view", "archives.restore", "archives.delete", "users.manage", "settings.manage",
  "communications.view", "communications.create", "communications.archive",
  "attention.view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const operationalAdmin: Permission[] = [
  "dashboard.view", "clients.view", "clients.create", "clients.edit", "clients.archive",
  "properties.view", "properties.create", "properties.edit", "properties.archive",
  "estimates.view", "estimates.create", "estimates.edit", "walkthroughs.view",
  "walkthroughs.create", "walkthroughs.edit", "proposals.view", "proposals.create",
  "proposals.send", "jobs.view", "jobs.create", "jobs.edit", "jobs.schedule",
  "jobs.complete", "jobs.archive", "schedule.view", "schedule.edit", "employees.directory_view", "employees.view", "employees.manage",
  "crews.view", "crews.manage", "timeClock.view", "timeClock.manageAll",
  "agreements.view", "agreements.manage", "invoices.view", "invoices.create",
  "invoices.edit", "archives.view", "archives.restore", "communications.view",
  "communications.create", "communications.archive", "attention.view",
];

export const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = {
  "Master Admin": new Set(PERMISSIONS),
  Administrator: new Set(operationalAdmin),
  Manager: new Set([
    "dashboard.view", "clients.view", "clients.edit", "properties.view", "properties.edit",
    "estimates.view", "estimates.create", "estimates.edit", "walkthroughs.view",
    "walkthroughs.create", "walkthroughs.edit", "proposals.view", "proposals.create",
    "jobs.view", "jobs.create", "jobs.edit", "jobs.schedule", "jobs.complete", "jobs.archive",
    "schedule.view", "schedule.edit", "employees.directory_view", "employees.view", "crews.view", "crews.manage",
    "timeClock.view", "timeClock.manageAll", "agreements.view", "agreements.manage",
    "invoices.view", "communications.view", "communications.create", "communications.archive", "attention.view",
  ]),
  Sales: new Set([
    "dashboard.view", "clients.view", "clients.create", "clients.edit", "properties.view",
    "properties.create", "properties.edit", "estimates.view", "estimates.create",
    "estimates.edit", "walkthroughs.view", "walkthroughs.create", "walkthroughs.edit",
    "proposals.view", "proposals.create", "proposals.send", "agreements.view",
    "agreements.manage", "timeClock.view", "employees.directory_view", "communications.view", "communications.create", "attention.view",
  ]),
  "Crew Lead": new Set([
    "dashboard.view", "jobs.view", "jobs.edit", "jobs.complete", "schedule.view",
    "timeClock.view", "crews.view", "clients.view", "properties.view", "vehicles.view", "attention.view",
  ]),
  "Scrub Technician": new Set([
    "dashboard.view", "jobs.view", "schedule.view", "timeClock.view", "clients.view",
    "properties.view", "vehicles.view", "attention.view",
  ]),
};

export function hasPermission(profile: UserProfile | null, permission: Permission): boolean {
  return profile?.is_active === true && ROLE_PERMISSIONS[profile.role]?.has(permission) === true;
}

export function isMasterAdmin(profile: UserProfile | null): boolean {
  return profile?.is_active === true && profile.role === "Master Admin";
}

export const canAccessFinances = (profile: UserProfile | null) => hasPermission(profile, "finances.view");
export const canAccessPayrollPrep = (profile: UserProfile | null) => hasPermission(profile, "payrollPrep.view");
export const canAccessArchives = (profile: UserProfile | null) => hasPermission(profile, "archives.view");
export const canPermanentlyDelete = (profile: UserProfile | null) => hasPermission(profile, "archives.delete");
export const canManageSystem = (profile: UserProfile | null) => hasPermission(profile, "dashboard.view");

const ROUTE_PERMISSIONS: Array<[string, Permission]> = [
  ["/attention", "attention.view"],
  ["/users", "users.manage"], ["/revenue", "finances.view"], ["/expenses", "expenses.view"],
  ["/vehicles", "vehicles.view"], ["/payroll-prep", "payrollPrep.view"],
  ["/archives", "archives.view"], ["/clients", "clients.view"],
  ["/properties", "properties.view"], ["/estimates", "estimates.create"],
  ["/open-estimates", "estimates.view"], ["/walkthroughs", "walkthroughs.view"],
  ["/proposals", "proposals.create"], ["/open-proposals", "proposals.view"],
  ["/jobs", "jobs.view"], ["/schedule", "schedule.view"],
  ["/employees/scrub-technicians", "employees.view"], ["/employees/sales", "employees.view"],
  ["/employees/administration", "employees.view"], ["/employees", "employees.directory_view"], ["/time-clock", "timeClock.view"],
  ["/agreements", "agreements.view"], ["/invoices", "invoices.view"],
  ["/settings", "settings.manage"], ["/", "dashboard.view"],
];

export function permissionForPath(pathname: string): Permission {
  return ROUTE_PERMISSIONS.find(([path]) => path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(`${path}/`))?.[1] ?? "dashboard.view";
}
