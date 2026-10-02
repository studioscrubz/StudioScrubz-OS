begin;

-- Sales may read Agreements, but direct Agreement and occurrence writes remain
-- management-only. Narrow workflow RPCs retain their own explicit authorization.
drop policy if exists "Agreement role create" on public.service_agreements;
drop policy if exists "Agreement role update" on public.service_agreements;
create policy "Agreement role create" on public.service_agreements
for insert to authenticated
with check (public.has_any_role(array['Administrator','Manager']));
create policy "Agreement role update" on public.service_agreements
for update to authenticated
using (public.has_any_role(array['Administrator','Manager']))
with check (public.has_any_role(array['Administrator','Manager']));

drop policy if exists "Occurrence role create" on public.service_occurrences;
drop policy if exists "Occurrence role update" on public.service_occurrences;
create policy "Occurrence role create" on public.service_occurrences
for insert to authenticated
with check (public.has_any_role(array['Administrator','Manager']));
create policy "Occurrence role update" on public.service_occurrences
for update to authenticated
using (public.has_any_role(array['Administrator','Manager']))
with check (public.has_any_role(array['Administrator','Manager']));

-- Dedicated non-financial Schedule projection for Sales. This does not grant
-- jobs.view, direct Job SELECT, or any Job mutation authority.
create or replace function public.get_sales_schedule_jobs(
  p_start date default null,
  p_end date default null
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_role('Sales') then
    raise exception 'Sales Schedule access is denied.' using errcode = '42501';
  end if;

  return query
  select jsonb_build_object(
    'id', job.id,
    'job_number', job.job_number,
    'proposal_id', job.proposal_id,
    'service_occurrence_id', job.service_occurrence_id,
    'estimate_id', job.estimate_id,
    'walkthrough_id', job.walkthrough_id,
    'client_id', job.client_id,
    'property_id', job.property_id,
    'division', job.division,
    'client_name', job.client_name,
    'property_name', job.property_name,
    'service_name', job.service_name,
    'frequency', job.frequency,
    'status', job.status,
    'scheduled_date', job.scheduled_date,
    'start_time', job.start_time,
    'estimated_duration', job.estimated_duration,
    'assigned_crew_id', job.assigned_crew_id,
    'assigned_crew_name', job.assigned_crew_name,
    'crew_lead_name', job.crew_lead_name,
    'assigned_team', job.assigned_team,
    'assigned_employee_id', job.assigned_employee_id,
    'assigned_employee_name', job.assigned_employee_name,
    'scope', job.scope,
    'checklist', job.checklist,
    'access_instructions', null,
    'internal_notes', null,
    'completed_at', job.completed_at,
    'created_at', job.created_at,
    'updated_at', job.updated_at,
    'archived_at', job.archived_at,
    'operational_started_at', job.operational_started_at,
    'operational_ended_at', job.operational_ended_at,
    'on_my_way_initiated_at', job.on_my_way_initiated_at,
    'contracted_addons', case when jsonb_typeof(job.pricing_snapshot->'addons') = 'array' then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', addon->>'id',
        'label', addon->>'label',
        'pricingType', addon->>'pricingType',
        'quantity', case when jsonb_typeof(addon->'quantity') = 'number' then (addon->>'quantity')::numeric end,
        'unitName', addon->>'unitName'
      )), '[]'::jsonb)
      from jsonb_array_elements(job.pricing_snapshot->'addons') addon
    ) end
  )
  from public.jobs job
  where job.archived_at is null
    and job.status in ('Ready to Schedule','Scheduled','Crew Assigned','In Progress','Completed','Cancelled')
    and (p_start is null or job.scheduled_date >= p_start)
    and (p_end is null or job.scheduled_date <= p_end)
    and (job.status <> 'Completed' or not public.is_job_financially_handed_off(job.id))
  order by job.created_at desc;
end;
$$;

revoke all on function public.get_sales_schedule_jobs(date,date)
from public, anon, authenticated;
grant execute on function public.get_sales_schedule_jobs(date,date) to authenticated;

notify pgrst, 'reload schema';
commit;
