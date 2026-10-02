import type { UserProfile, UserRole } from "@/types/auth";

export const PERMISSIONS = [
  "porterVisits.view", "porterVisits.manage",
  "propertyServicePlans.manage",
  "marketingMaterials.send",
  "jobApplications.manage",
  "prospects.view", "prospects.manage",
  "walkthroughs.field",
  "dashboard.view", "clients.view", "clients.create", "clients.edit", "clients.archive",
  "properties.view", "properties.create", "properties.edit", "properties.archive",
  "estimates.view", "estimates.create", "estimates.edit",
  "walkthroughs.view", "walkthroughs.create", "walkthroughs.edit",
  "proposals.view", "proposals.create", "proposals.approve", "proposals.send",
  "jobs.view", "jobs.create", "jobs.edit", "jobs.schedule", "jobs.complete", "jobs.archive",
  "schedule.view", "schedule.edit",
  "employees.directory_view", "employees.scrubTechRosterView", "employees.view", "employees.manage",
  "crews.view", "crews.manage", "timeClock.view", "timeClock.manageAll",
  "payrollPrep.view", "agreements.view", "agreements.manage", "agreements.financialSummary",
  "invoices.view", "invoices.create", "invoices.edit", "invoices.send", "invoices.recordPayment",
  "finances.view", "expenses.view", "expenses.manage", "vehicles.view", "vehicles.manage",
  "archives.view", "archives.restore", "archives.delete", "users.manage", "settings.manage", "appearance.view",
  "communications.view", "communications.create", "communications.archive",
  "attention.view", "reports.view",
  "messages.view", "messages.send", "messages.announce",
  "leadRep.portal", "leadRep.leads.viewOwn", "leadRep.commissions.viewOwn", "leadRep.payouts.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const operationalAdmin: Permission[] = [
  "porterVisits.view", "porterVisits.manage",
  "propertyServicePlans.manage",
  "marketingMaterials.send",
  "jobApplications.manage",
  "prospects.view", "prospects.manage",
  "dashboard.view", "clients.view", "clients.create", "clients.edit", "clients.archive",
  "properties.view", "properties.create", "properties.edit", "properties.archive",
  "estimates.view", "estimates.create", "estimates.edit", "walkthroughs.view",
  "walkthroughs.create", "walkthroughs.edit", "proposals.view", "proposals.create",
  "proposals.send", "jobs.view", "jobs.create", "jobs.edit", "jobs.schedule",
  "jobs.complete", "jobs.archive", "schedule.view", "schedule.edit",
  "employees.directory_view", "employees.scrubTechRosterView", "employees.view", "employees.manage",
  "crews.view", "crews.manage", "timeClock.view", "timeClock.manageAll",
  "agreements.view", "agreements.manage", "agreements.financialSummary", "invoices.view", "invoices.create",
  "invoices.edit", "invoices.send", "invoices.recordPayment",
  "archives.view", "archives.restore",
  "communications.view", "communications.create", "communications.archive",
  "attention.view", "reports.view",
  "messages.view", "messages.send", "messages.announce",
  "leadRep.payouts.manage",
];

const crewLeadPermissions: Permission[] = [
  "porterVisits.view",
  "walkthroughs.field",
  "dashboard.view",
  "jobs.view", "jobs.edit", "jobs.complete",
  "schedule.view",
  "employees.directory_view", "employees.scrubTechRosterView",
  "timeClock.view",
  "crews.view",
  "clients.view",
  "properties.view",
  "vehicles.view",
  "attention.view",
  "messages.view", "messages.send",
  "appearance.view",
];

export const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = {
  "Master Admin": new Set(PERMISSIONS),

  Administrator: new Set(operationalAdmin),

  Manager: new Set([
    ...crewLeadPermissions,
    "porterVisits.view", "porterVisits.manage",
    "propertyServicePlans.manage",
    "marketingMaterials.send",
    "jobApplications.manage",
    "prospects.view", "prospects.manage",
    "dashboard.view",
    "clients.view", "clients.edit",
    "properties.view", "properties.edit",
    "jobs.view", "jobs.create", "jobs.edit", "jobs.schedule", "jobs.complete", "jobs.archive",
    "schedule.view", "schedule.edit",
    "employees.directory_view", "employees.scrubTechRosterView", "employees.view",
    "crews.view", "crews.manage",
    "timeClock.view", "timeClock.manageAll",
    "agreements.view", "agreements.manage", "agreements.financialSummary",
    "invoices.view", "invoices.send",
    "communications.view", "communications.create", "communications.archive",
    "attention.view", "reports.view",
    "messages.view", "messages.send",
    "appearance.view",
  ]),

  Sales: new Set([
    "prospects.view", "prospects.manage",
    "marketingMaterials.send",
    "dashboard.view",
    "clients.view", "clients.create", "clients.edit",
    "properties.view", "properties.create", "properties.edit",
    "estimates.view", "estimates.create", "estimates.edit",
    "walkthroughs.view", "walkthroughs.create", "walkthroughs.edit",
    "proposals.view", "proposals.create", "proposals.send",
    "schedule.view",
    "agreements.view",
    "timeClock.view",
    "employees.directory_view", "employees.scrubTechRosterView",
    "communications.view", "communications.create",
    "attention.view",
    "messages.view", "messages.send",
    "appearance.view",
  ]),

  "Lead Representative": new Set([
    "leadRep.portal", "leadRep.leads.viewOwn", "leadRep.commissions.viewOwn",
  ]),

  "Crew Lead": new Set(crewLeadPermissions),

  "Scrub Technician": new Set([
    "porterVisits.view",
    "dashboard.view",
    "jobs.view",
    "schedule.view",
    "employees.directory_view", "employees.scrubTechRosterView",
    "timeClock.view",
    "clients.view",
    "properties.view",
    "vehicles.view",
    "attention.view",
    "messages.view", "messages.send",
    "appearance.view",
  ]),
};

export function hasPermission(
  profile: UserProfile | null,
  permission: Permission,
): boolean {
  if (["leadRep.portal", "leadRep.leads.viewOwn", "leadRep.commissions.viewOwn"].includes(permission)) {
    return profile?.is_active === true && profile.role === "Lead Representative";
  }

  if (permission === "walkthroughs.field") {
    return (
      profile?.is_active === true &&
      (profile.role === "Master Admin" || (
        Boolean(profile.employee_id) &&
        ["Manager", "Crew Lead"].includes(profile.role)
      ))
    );
  }

  return (
    profile?.is_active === true &&
    ROLE_PERMISSIONS[profile.role]?.has(permission) === true
  );
}

export function isMasterAdmin(profile: UserProfile | null): boolean {
  return profile?.is_active === true && profile.role === "Master Admin";
}

export const canAccessFinances = (profile: UserProfile | null) =>
  hasPermission(profile, "finances.view");

export const canAccessPayrollPrep = (profile: UserProfile | null) =>
  hasPermission(profile, "payrollPrep.view");

export const canAccessArchives = (profile: UserProfile | null) =>
  hasPermission(profile, "archives.view");

export const canPermanentlyDelete = (profile: UserProfile | null) =>
  hasPermission(profile, "archives.delete");

export const canManageSystem = (profile: UserProfile | null) =>
  hasPermission(profile, "dashboard.view");

export const canManageWalkthroughPhotos = (profile: UserProfile | null) =>
  profile?.is_active === true &&
  ["Master Admin", "Administrator", "Sales"].includes(profile.role);

export const canManageProposalPricingPhotos = (profile: UserProfile | null) =>
  profile?.is_active === true &&
  ["Master Admin", "Administrator", "Sales"].includes(profile.role);

export const canViewInvoiceFinishedPhotos = (profile: UserProfile | null) =>
  profile?.is_active === true &&
  ["Master Admin", "Administrator", "Manager"].includes(profile.role);

export const canManageInvoicePhotoVisibility = (profile: UserProfile | null) =>
  profile?.is_active === true &&
  ["Master Admin", "Administrator"].includes(profile.role);

const ROUTE_PERMISSIONS: Array<[string, Permission]> = [
  ["/lead-commission-payouts", "leadRep.payouts.manage"],
  ["/lead-rep/commissions", "leadRep.commissions.viewOwn"],
  ["/lead-rep/leads", "leadRep.leads.viewOwn"],
  ["/lead-rep", "leadRep.portal"],
  ["/properties/porter-routes", "porterVisits.view"],
  ["/properties/service-reports", "porterVisits.manage"],
  ["/properties/porter-visits", "porterVisits.view"],
  ["/properties/service-plans", "propertyServicePlans.manage"],
  ["/marketing-materials", "marketingMaterials.send"],
  ["/applications", "jobApplications.manage"],
  ["/lead-generator-applications", "jobApplications.manage"],

  ["/field-walkthroughs", "walkthroughs.field"],
  ["/prospects", "prospects.view"],

  ["/vendor-packets", "estimates.create"],
  ["/attention", "attention.view"],
  ["/messages", "messages.view"],
  ["/job-performance", "reports.view"],

  ["/users", "users.manage"],
  ["/revenue", "finances.view"],
  ["/expenses", "expenses.view"],
  ["/vehicles", "vehicles.view"],
  ["/payroll-prep", "payrollPrep.view"],
  ["/archives", "archives.view"],

  ["/clients", "clients.view"],
  ["/properties", "properties.view"],

  ["/estimates", "estimates.create"],
  ["/open-estimates", "estimates.view"],

  ["/walkthroughs", "walkthroughs.view"],

  ["/proposals", "proposals.create"],
  ["/open-proposals", "proposals.view"],

  ["/jobs", "jobs.view"],
  ["/schedule", "schedule.view"],

  ["/employees/scrub-technicians", "employees.scrubTechRosterView"],
  ["/employees/sales", "employees.view"],
  ["/employees/administration", "employees.view"],
  ["/employees", "employees.directory_view"],
  ["/time-clock", "timeClock.view"],

  ["/agreements", "agreements.view"],
  ["/invoices", "invoices.view"],

  ["/settings/notifications", "attention.view"],
  ["/settings/services", "settings.manage"],
  ["/settings/business", "settings.manage"],
  ["/settings", "appearance.view"],

  ["/", "dashboard.view"],
];

export function permissionForPath(pathname: string): Permission {
  return (
    ROUTE_PERMISSIONS.find(([path]) =>
      path === "/"
        ? pathname === "/"
        : pathname === path || pathname.startsWith(`${path}/`)
    )?.[1] ?? "dashboard.view"
  );
}
