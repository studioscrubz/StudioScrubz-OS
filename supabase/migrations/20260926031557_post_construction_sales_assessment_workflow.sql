-- Forward-only Post-Construction sales-assessment workflow extension.
-- Reuses walkthroughs as the authoritative Assessment, its immutable pricing
-- review snapshot, assessment_photo_access, operational photos, and Proposals.
begin;

alter table public.assessment_photo_access
  add column token_value text;

alter table public.assessment_photo_access
  add constraint assessment_photo_access_token_value_length
  check (token_value is null or length(token_value) between 40 and 200) not valid;
alter table public.assessment_photo_access
  validate constraint assessment_photo_access_token_value_length;

alter table public.walkthroughs
  add column sales_stage text not null default 'New';

alter table public.walkthroughs
  add constraint walkthroughs_sales_stage_check check (
    sales_stage = any (array[
      'New', 'Qualification', 'Contacting', 'Assessment Method Required',
      'Walkthrough Scheduled', 'Awaiting Customer Photos',
      'Assessment In Progress', 'Pricing Review', 'Proposal Ready',
      'Proposal Created', 'Closed / Not Proceeding'
    ])
  ) not valid;

update public.walkthroughs w
set sales_stage = case
  when w.archived_at is not null or w.status = 'Archived' then 'Closed / Not Proceeding'
  when exists (select 1 from public.proposals p where p.walkthrough_id = w.id and p.archived_at is null) then 'Proposal Created'
  when w.pricing_review is not null then 'Proposal Ready'
  when w.status = 'Completed' then 'Pricing Review'
  when w.measurements->>'assessmentMethod' = 'Customer Photo Submission'
    and nullif(w.measurements->>'photoSubmittedAt', '') is null then 'Awaiting Customer Photos'
  when w.walkthrough_date is not null and w.walkthrough_time is not null then 'Walkthrough Scheduled'
  when nullif(w.measurements->>'assessmentMethod', '') is null then 'Assessment Method Required'
  else 'Qualification'
end
where coalesce(w.measurements->>'serviceType', '') ~* 'post[- ]construction';

alter table public.walkthroughs validate constraint walkthroughs_sales_stage_check;

create index walkthroughs_post_construction_stage_idx
  on public.walkthroughs (sales_stage, updated_at desc)
  where archived_at is null
    and coalesce(measurements->>'serviceType', '') ~* 'post[- ]construction';

-- A Walkthrough/Assessment can have only one active Proposal. This matches the
-- application idempotency contract and leaves archived historical rows intact.
create unique index proposals_one_active_per_walkthrough
  on public.proposals (walkthrough_id)
  where walkthrough_id is not null and archived_at is null;

create table public.assessment_history (
  id uuid primary key default gen_random_uuid(),
  walkthrough_id uuid not null references public.walkthroughs(id) on delete restrict,
  event_type text not null,
  from_stage text,
  to_stage text,
  changed_fields text[] not null default '{}'::text[],
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  changed_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index assessment_history_walkthrough_created_idx
  on public.assessment_history (walkthrough_id, created_at desc);

alter table public.assessment_history enable row level security;
revoke all on table public.assessment_history from public, anon, authenticated;
grant select on table public.assessment_history to authenticated;

create policy "Assessment history sales read"
on public.assessment_history for select to authenticated
using (
  auth.uid() is not null
  and public.has_any_role(array['Master Admin', 'Administrator', 'Manager', 'Sales'])
  and exists (
    select 1 from public.walkthroughs w where w.id = walkthrough_id
  )
);

create function public.enforce_post_construction_assessment_gate()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  method text;
begin
  if coalesce(new.measurements->>'serviceType', '') !~* 'post[- ]construction' then
    return new;
  end if;
  method := new.measurements->>'assessmentMethod';
  if method in ('On-Site Walkthrough', 'In-Person Walkthrough')
    and new.status in ('Scheduled', 'Completed', 'Proposal Ready')
    and (new.walkthrough_date is null or new.walkthrough_time is null) then
    raise exception 'An on-site walkthrough must be scheduled before it can begin.';
  end if;
  if new.status in ('Completed', 'Proposal Ready') then
    if method not in ('On-Site Walkthrough', 'In-Person Walkthrough', 'Customer Photo Submission') then
      raise exception 'Select exactly one Assessment method before completion.';
    end if;
    if jsonb_typeof(new.measurements->'postConstructionAssessment') <> 'object' then
      raise exception 'Complete the structured Post-Construction assessment before Pricing Review.';
    end if;
    if method = 'Customer Photo Submission' and (
      nullif(new.measurements->>'photoSubmittedAt', '') is null
      or jsonb_array_length(coalesce(new.photos, '[]'::jsonb)) = 0
    ) then
      raise exception 'Customer photos must be received before Pricing Review.';
    end if;
  end if;
  if new.status = 'Proposal Ready' and new.pricing_review is null then
    raise exception 'Approved Pricing Review is required before Proposal creation.';
  end if;
  return new;
end;
$function$;

revoke all on function public.enforce_post_construction_assessment_gate()
from public, anon, authenticated;

create trigger walkthroughs_enforce_post_construction_assessment_gate
before insert or update of status, measurements, walkthrough_date,
  walkthrough_time, photos, pricing_review
on public.walkthroughs
for each row execute function public.enforce_post_construction_assessment_gate();

create function public.audit_sales_assessment_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  changed text[] := '{}'::text[];
begin
  if old.sales_stage is distinct from new.sales_stage then changed := array_append(changed, 'sales_stage'); end if;
  if old.measurements is distinct from new.measurements then changed := array_append(changed, 'measurements'); end if;
  if old.scope is distinct from new.scope then changed := array_append(changed, 'scope'); end if;
  if old.recommendations is distinct from new.recommendations then changed := array_append(changed, 'recommendations'); end if;
  if old.walkthrough_date is distinct from new.walkthrough_date or old.walkthrough_time is distinct from new.walkthrough_time then changed := array_append(changed, 'schedule'); end if;
  if old.assigned_employee_id is distinct from new.assigned_employee_id then changed := array_append(changed, 'assignment'); end if;
  if old.status is distinct from new.status then changed := array_append(changed, 'status'); end if;
  if old.pricing_review is distinct from new.pricing_review then changed := array_append(changed, 'pricing_review'); end if;
  if cardinality(changed) > 0 and coalesce(new.measurements->>'serviceType', '') ~* 'post[- ]construction' then
    insert into public.assessment_history (
      walkthrough_id, event_type, from_stage, to_stage, changed_fields,
      snapshot, changed_by_user_id
    ) values (
      new.id,
      case when old.sales_stage is distinct from new.sales_stage then 'Stage Changed' else 'Assessment Updated' end,
      old.sales_stage,
      new.sales_stage,
      changed,
      jsonb_build_object(
        'salesStage', new.sales_stage,
        'status', new.status,
        'assessmentMethod', new.measurements->'assessmentMethod',
        'measurements', new.measurements,
        'scope', new.scope,
        'recommendations', new.recommendations,
        'walkthroughDate', new.walkthrough_date,
        'walkthroughTime', new.walkthrough_time,
        'assignedEmployeeId', new.assigned_employee_id,
        'pricingReview', new.pricing_review
      ),
      auth.uid()
    );
  end if;
  return new;
end;
$function$;

revoke all on function public.audit_sales_assessment_change() from public, anon, authenticated;

create trigger walkthroughs_audit_post_construction_assessment
after update of sales_stage, measurements, scope, recommendations,
  walkthrough_date, walkthrough_time, assigned_employee_id, status, pricing_review
on public.walkthroughs
for each row execute function public.audit_sales_assessment_change();

create function public.transition_post_construction_assessment(
  p_walkthrough_id uuid,
  p_stage text
)
returns public.walkthroughs
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_row public.walkthroughs;
  result_row public.walkthroughs;
  method text;
begin
  if auth.uid() is null
    or not public.has_any_role(array['Master Admin', 'Administrator', 'Manager', 'Sales']) then
    raise exception 'Post-Construction assessment access denied.' using errcode = '42501';
  end if;

  select * into current_row
  from public.walkthroughs
  where id = p_walkthrough_id
  for update;

  if not found or current_row.archived_at is not null
    or coalesce(current_row.measurements->>'serviceType', '') !~* 'post[- ]construction' then
    raise exception 'Active Post-Construction assessment not found.';
  end if;

  if p_stage not in (
    'New', 'Qualification', 'Contacting', 'Assessment Method Required',
    'Walkthrough Scheduled', 'Awaiting Customer Photos',
    'Assessment In Progress', 'Pricing Review', 'Proposal Ready',
    'Proposal Created', 'Closed / Not Proceeding'
  ) then raise exception 'Invalid Post-Construction sales stage.'; end if;

  method := current_row.measurements->>'assessmentMethod';
  if p_stage in ('Walkthrough Scheduled', 'Assessment In Progress', 'Pricing Review')
    and method in ('On-Site Walkthrough', 'In-Person Walkthrough')
    and (current_row.walkthrough_date is null or current_row.walkthrough_time is null) then
    raise exception 'An on-site walkthrough must be scheduled before it can begin.';
  end if;
  if p_stage = 'Awaiting Customer Photos' and method <> 'Customer Photo Submission' then
    raise exception 'Customer photo submission must be the active assessment method.';
  end if;
  if p_stage in ('Pricing Review', 'Proposal Ready', 'Proposal Created') then
    if current_row.status <> 'Completed' then raise exception 'Complete the Assessment before Pricing Review.'; end if;
    if jsonb_typeof(current_row.measurements->'postConstructionAssessment') <> 'object' then
      raise exception 'Complete the structured Post-Construction assessment before Pricing Review.';
    end if;
    if method = 'Customer Photo Submission' and (
      nullif(current_row.measurements->>'photoSubmittedAt', '') is null
      or jsonb_array_length(coalesce(current_row.photos, '[]'::jsonb)) = 0
    ) then raise exception 'Customer photos must be received before Pricing Review.'; end if;
  end if;
  if p_stage in ('Proposal Ready', 'Proposal Created') and current_row.pricing_review is null then
    raise exception 'Approved Pricing Review is required before Proposal creation.';
  end if;
  if p_stage = 'Proposal Created' and not exists (
    select 1 from public.proposals p
    where p.walkthrough_id = current_row.id and p.archived_at is null
  ) then raise exception 'An active Proposal is required for the Proposal Created stage.'; end if;

  if current_row.sales_stage = p_stage then return current_row; end if;
  update public.walkthroughs set sales_stage = p_stage where id = current_row.id returning * into result_row;
  return result_row;
end;
$function$;

revoke all on function public.transition_post_construction_assessment(uuid, text)
from public, anon, authenticated;
grant execute on function public.transition_post_construction_assessment(uuid, text)
to authenticated;

create function public.mark_post_construction_proposal_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.walkthrough_id is not null then
    update public.walkthroughs w
    set sales_stage = 'Proposal Created'
    where w.id = new.walkthrough_id
      and w.pricing_review is not null
      and coalesce(w.measurements->>'serviceType', '') ~* 'post[- ]construction';
  end if;
  return new;
end;
$function$;

revoke all on function public.mark_post_construction_proposal_created()
from public, anon, authenticated;

create trigger proposals_mark_post_construction_assessment_created
after insert on public.proposals
for each row execute function public.mark_post_construction_proposal_created();

-- Manager joins the existing sales-operational boundary without receiving any
-- new table privilege; RLS and existing role helpers remain authoritative.
alter policy "Sales pipeline boundary" on public.estimates
  using (public.has_any_role(array['Master Admin','Administrator','Manager','Sales']))
  with check (public.has_any_role(array['Master Admin','Administrator','Manager','Sales']));
alter policy "Sales pipeline boundary" on public.walkthroughs
  using (public.has_any_role(array['Master Admin','Administrator','Manager','Sales']))
  with check (public.has_any_role(array['Master Admin','Administrator','Manager','Sales']));
alter policy "Sales pipeline boundary" on public.proposals
  using (public.has_any_role(array['Master Admin','Administrator','Manager','Sales']))
  with check (public.has_any_role(array['Master Admin','Administrator','Manager','Sales']));
alter policy "Sales pipeline boundary" on public.proposal_history
  using (public.has_any_role(array['Master Admin','Administrator','Manager','Sales']))
  with check (public.has_any_role(array['Master Admin','Administrator','Manager','Sales']));

notify pgrst, 'reload schema';
commit;
