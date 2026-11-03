-- Preserve proposal-backed person-hours on new jobs before the immutable
-- start-time budget snapshot is frozen. Direct Jobs require entered person-hours
-- in the app service; legacy agreements without a proposal remain unaltered.
-- Never backfill existing or completed jobs, or infer labor from clock time.
create or replace function private.capture_new_job_labor_from_proposal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_labor_text text;
  v_crew_text text;
  v_duration_text text;
begin
  if new.proposal_id is null or coalesce(new.labor_hours, 0) > 0 then
    return new;
  end if;

  select p.result into v_result
  from public.proposals p where p.id = new.proposal_id;
  if not found then
    raise exception 'The linked Proposal is unavailable for this Job.';
  end if;

  v_labor_text := v_result->>'laborHours';
  if coalesce(v_labor_text,'') !~ '^([0-9]+)(\\.[0-9]+)?$'
     or length(v_labor_text) > 18 or v_labor_text::numeric <= 0 then
    raise exception 'The linked Proposal needs valid positive total person-hours before creating this Job.';
  end if;
  new.labor_hours := v_labor_text::numeric;

  v_crew_text := coalesce(v_result->>'crewRecommendation', v_result->>'crewSize');
  if coalesce(new.recommended_crew_size,0) <= 1
     and coalesce(v_crew_text,'') ~ '^[0-9]+$'
     and length(v_crew_text) <= 6
     and v_crew_text::integer between 1 and 100 then
    new.recommended_crew_size := v_crew_text::integer;
  end if;

  v_duration_text := v_result->>'estimatedDuration';
  if new.estimated_duration is null
     and coalesce(v_duration_text,'') ~ '^([0-9]+)(\\.[0-9]+)?$'
     and length(v_duration_text) <= 18
     and v_duration_text::numeric > 0 then
    new.estimated_duration := v_duration_text::numeric;
  end if;

  return new;
end;
$$;

revoke all on function private.capture_new_job_labor_from_proposal()
from public, anon, authenticated;

drop trigger if exists jobs_capture_new_job_labor_from_proposal on public.jobs;
create trigger jobs_capture_new_job_labor_from_proposal
before insert on public.jobs
for each row
execute function private.capture_new_job_labor_from_proposal();
