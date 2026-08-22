-- StudioScrubz OS Backlog V2-004B Phase B: safe-view lockdown.
-- REVIEW ONLY. Run manually only after Phase A has been applied, the RPC-based
-- application has been deployed, and production workflows have been verified.

alter view public.business_settings_public set (security_invoker = true);
alter view public.business_settings_workflow set (security_invoker = true);
alter view public.employee_directory_safe set (security_invoker = true);
alter view public.jobs_operational_safe set (security_invoker = true);
alter view public.time_entries_operational_safe set (security_invoker = true);
alter view public.crew_directory_safe set (security_invoker = true);
alter view public.crew_members_directory_safe set (security_invoker = true);

revoke all on table
  public.business_settings_public,
  public.business_settings_workflow,
  public.employee_directory_safe,
  public.jobs_operational_safe,
  public.time_entries_operational_safe,
  public.crew_directory_safe,
  public.crew_members_directory_safe
from public, anon, authenticated;

notify pgrst, 'reload schema';
