begin;

-- Keep the operational Job surface assignment-scoped while exposing the
-- on-my-way timestamp already consumed by get_operational_jobs(date,date).
-- Append the column so CREATE OR REPLACE preserves the existing view contract.
create or replace view public.jobs_operational_safe
with (security_barrier=true, security_invoker=true) as
select job.id,job.job_number,job.proposal_id,job.service_occurrence_id,job.estimate_id,job.walkthrough_id,
  job.client_id,job.property_id,job.division,job.client_name,job.property_name,job.service_name,job.frequency,
  job.status,job.scheduled_date,job.start_time,job.estimated_duration,job.assigned_crew_id,
  job.assigned_crew_name,job.crew_lead_name,job.assigned_team,job.scope,job.checklist,
  job.access_instructions,job.internal_notes,job.completed_at,job.created_at,job.updated_at,job.archived_at,
  job.operational_started_at,job.operational_ended_at,
  case when jsonb_typeof(job.pricing_snapshot->'addons')='array' then (
    select coalesce(jsonb_agg(jsonb_build_object('id',addon->>'id','label',addon->>'label',
      'pricingType',addon->>'pricingType','quantity',case when jsonb_typeof(addon->'quantity')='number' then (addon->>'quantity')::numeric end,
      'unitName',addon->>'unitName')),'[]'::jsonb)
    from jsonb_array_elements(job.pricing_snapshot->'addons') addon) end as contracted_addons,
  job.assigned_employee_id,job.assigned_employee_name,job.on_my_way_initiated_at
from public.jobs job
where public.can_access_job_assignment(job.assigned_employee_id,job.assigned_crew_id);

revoke all on public.jobs_operational_safe from public, anon, authenticated;
grant select on public.jobs_operational_safe to authenticated;

notify pgrst,'reload schema';
commit;
