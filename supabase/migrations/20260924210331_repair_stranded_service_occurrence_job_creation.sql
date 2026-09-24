-- Repair occurrence-to-Job creation when a prior Job was permanently removed
-- and ON DELETE SET NULL left the occurrence in the derived Job Created state.
begin;

create or replace function public.create_job_from_service_occurrence(p_occurrence_id uuid)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_role text;
  occurrence_row public.service_occurrences;
  agreement_row public.service_agreements;
  client_row public.clients;
  property_row public.properties;
  crew_row public.crews;
  proposal_row public.proposals;
  job_row public.jobs;
  team jsonb := '[]'::jsonb;
  job_amount numeric;
  job_pricing_snapshot jsonb;
  job_date date;
  attempt integer;
begin
  if auth.uid() is null or not exists (
    select 1 from public.user_profiles where id = auth.uid() and is_active
  ) then raise exception 'An active authenticated profile is required.'; end if;
  caller_role := public.current_user_role();
  if caller_role not in ('Master Admin','Administrator','Manager') then
    raise exception 'Job creation permission is required.';
  end if;

  select * into occurrence_row from public.service_occurrences
  where id = p_occurrence_id for update;
  if not found then raise exception 'Service occurrence not found.'; end if;

  select * into agreement_row from public.service_agreements
  where id = occurrence_row.agreement_id for update;
  if not found or agreement_row.status <> 'Active' or agreement_row.archived_at is not null then
    raise exception 'Jobs can only be created for an Active Service Agreement.';
  end if;

  if occurrence_row.job_id is not null then
    select * into job_row from public.jobs where id = occurrence_row.job_id and archived_at is null;
    if found then return job_row; end if;
  end if;
  select * into job_row from public.jobs
  where service_occurrence_id = occurrence_row.id and archived_at is null limit 1;
  if found then
    update public.service_occurrences set job_id = job_row.id, status = 'Job Created'
    where id = occurrence_row.id;
    return job_row;
  end if;

  if occurrence_row.status = 'Job Created' then
    if exists (
      select 1 from public.jobs retained_job
      where retained_job.id = occurrence_row.job_id
         or retained_job.service_occurrence_id = occurrence_row.id
    ) then
      raise exception 'This service occurrence has retained Job history and cannot create another Job.';
    end if;
    update public.service_occurrences
    set status = 'Scheduled'
    where id = occurrence_row.id and job_id is null and status = 'Job Created';
  elsif occurrence_row.status <> 'Scheduled' then
    raise exception 'Only a Scheduled occurrence can create a Job.';
  end if;

  if occurrence_row.scheduled_date < agreement_row.start_date
    or (agreement_row.end_date is not null and not agreement_row.auto_renew and occurrence_row.scheduled_date > agreement_row.end_date) then
    raise exception 'Service occurrence falls outside the active Agreement term.';
  end if;

  select * into client_row from public.clients where id = agreement_row.client_id and archived_at is null;
  select * into property_row from public.properties where id = agreement_row.property_id and archived_at is null;
  if client_row.id is null or property_row.id is null then
    raise exception 'The Agreement requires active Client and Property relationships.';
  end if;
  if agreement_row.proposal_id is not null then
    select * into proposal_row from public.proposals where id = agreement_row.proposal_id;
  end if;
  if occurrence_row.assigned_crew_id is not null then
    select * into crew_row from public.crews
    where id = occurrence_row.assigned_crew_id
      and status = 'Active'
      and archived_at is null;
    if not found then
      raise exception 'The occurrence assigned crew is no longer active. Update the occurrence crew before creating the Job.';
    end if;
    select coalesce(jsonb_agg(coalesce(e.preferred_name, nullif(trim(e.first_name || ' ' || e.last_name), '')) order by e.last_name), '[]'::jsonb)
    into team from public.crew_members cm join public.employees e on e.id = cm.employee_id
    where cm.crew_id = crew_row.id;
  end if;
  job_amount := case when agreement_row.billing_type = 'Per Visit' then agreement_row.billing_amount else 0 end;
  job_pricing_snapshot := case when agreement_row.billing_type = 'Per Visit'
    then agreement_row.pricing_snapshot->'accepted_pricing_allocation' else null end;
  if job_pricing_snapshot is not null then
    if not public.is_valid_job_pricing_snapshot(job_pricing_snapshot, agreement_row.billing_amount) then
      raise exception 'The Agreement accepted pricing allocation is invalid or does not match its Per Visit billing amount.';
    end if;
    job_amount := round((job_pricing_snapshot->>'totalAmount')::numeric, 2);
  end if;
  job_date := (now() at time zone coalesce((select timezone from public.business_settings limit 1), 'UTC'))::date;

  for attempt in 1..5 loop
    begin
      insert into public.jobs (
        job_number, proposal_id, estimate_id, walkthrough_id, service_occurrence_id,
        client_id, property_id, division, client_name, property_name, service_name,
        frequency, status, scheduled_date, start_time, estimated_duration,
        assigned_crew_id, assigned_crew_name, crew_lead_name, assigned_team,
        price, pricing_snapshot, deposit, balance, labor_hours, recommended_crew_size, scope,
        checklist, photos, access_instructions, internal_notes, completed_at
      ) values (
        'JOB-' || to_char(job_date, 'YYYYMMDD') || '-' || lpad(floor(random() * 10000)::text, 4, '0'),
        agreement_row.proposal_id, proposal_row.estimate_id, proposal_row.walkthrough_id, occurrence_row.id,
        agreement_row.client_id, agreement_row.property_id, agreement_row.division,
        coalesce(client_row.company_name, nullif(concat_ws(' ', client_row.first_name, client_row.last_name), ''), 'Client'),
        coalesce(property_row.property_name, property_row.address), agreement_row.service_name,
        agreement_row.frequency, case when occurrence_row.assigned_crew_id is null then 'Scheduled' else 'Crew Assigned' end,
        occurrence_row.scheduled_date, occurrence_row.scheduled_start_time, agreement_row.estimated_duration,
        occurrence_row.assigned_crew_id, crew_row.crew_name,
        (select coalesce(e.preferred_name, nullif(trim(e.first_name || ' ' || e.last_name), '')) from public.employees e where e.id = crew_row.crew_lead_id),
        team, job_amount, job_pricing_snapshot, 0, job_amount, 0, greatest(jsonb_array_length(team), 1), agreement_row.scope,
        '[]'::jsonb, '[]'::jsonb, agreement_row.special_instructions, agreement_row.notes, null
      ) returning * into job_row;

      update public.service_occurrences set job_id = job_row.id, status = 'Job Created'
      where id = occurrence_row.id;
      return job_row;
    exception when unique_violation then
      select * into job_row from public.jobs
      where service_occurrence_id = occurrence_row.id and archived_at is null limit 1;
      if found then
        update public.service_occurrences set job_id = job_row.id, status = 'Job Created'
        where id = occurrence_row.id;
        return job_row;
      end if;
    end;
  end loop;
  raise exception 'A unique Job number could not be generated.';
end;
$$;

revoke all on function public.create_job_from_service_occurrence(uuid)
from public, anon, authenticated;
grant execute on function public.create_job_from_service_occurrence(uuid)
to authenticated;

notify pgrst, 'reload schema';
commit;
