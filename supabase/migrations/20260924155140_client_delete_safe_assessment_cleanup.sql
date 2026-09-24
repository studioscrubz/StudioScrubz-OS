begin;

create or replace function private.prevent_client_delete_with_service_plan()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_plan_count integer;
begin
  select count(*)
  into v_plan_count
  from public.property_service_plans plan
  where plan.client_id = old.id;

  if v_plan_count > 0 then
    raise exception using
      errcode = '23503',
      message = 'This Client cannot be permanently deleted because it has a Property Service Plan. Permanently delete the eligible archived Service Plan first, or keep the Client archived.';
  end if;

  return old;
end;
$$;

revoke all on function private.prevent_client_delete_with_service_plan()
from public, anon, authenticated;

drop trigger if exists clients_prevent_service_plan_delete on public.clients;
create trigger clients_prevent_service_plan_delete
before delete on public.clients
for each row execute function private.prevent_client_delete_with_service_plan();

-- Assessments are walkthrough rows. Clean up only subordinate assessment data;
-- retained sales, operational, and financial records always win.
create or replace function private.cleanup_client_assessments_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_retained_types text[] := '{}'::text[];
begin
  if auth.uid() is null or not public.is_master_admin() then
    raise exception 'Master Admin authorization is required for permanent deletion.' using errcode = '42501';
  end if;

  if old.archived_at is null then
    raise exception 'The Client must be archived before it can be permanently deleted.';
  end if;

  -- Serialize the assessment set with the controlled Client delete transaction.
  perform 1
  from public.walkthroughs assessment
  where assessment.client_id = old.id
  for update;

  if exists (
    select 1 from public.proposals proposal
    join public.walkthroughs assessment on assessment.id = proposal.walkthrough_id
    where assessment.client_id = old.id
  ) then v_retained_types := array_append(v_retained_types, 'Proposal'); end if;

  if exists (
    select 1 from public.service_agreements agreement
    join public.proposals proposal on proposal.id = agreement.proposal_id
    join public.walkthroughs assessment on assessment.id = proposal.walkthrough_id
    where assessment.client_id = old.id
  ) then v_retained_types := array_append(v_retained_types, 'Agreement'); end if;

  if exists (
    select 1 from public.jobs job
    join public.walkthroughs assessment on assessment.id = job.walkthrough_id
    where assessment.client_id = old.id
  ) then v_retained_types := array_append(v_retained_types, 'Job'); end if;

  if exists (
    select 1
    from public.invoices invoice
    left join public.proposals proposal on proposal.id = invoice.proposal_id
    left join public.jobs job on job.id = invoice.job_id
    join public.walkthroughs assessment
      on assessment.id = proposal.walkthrough_id or assessment.id = job.walkthrough_id
    where assessment.client_id = old.id
  ) then v_retained_types := array_append(v_retained_types, 'Invoice'); end if;

  if exists (
    select 1
    from public.payments payment
    left join public.invoices invoice on invoice.id = payment.invoice_id
    left join public.jobs job on job.id = payment.job_id
    left join public.proposals proposal on proposal.id = invoice.proposal_id
    join public.walkthroughs assessment
      on assessment.id = proposal.walkthrough_id
      or assessment.id = job.walkthrough_id
      or assessment.id = (select linked_job.walkthrough_id from public.jobs linked_job where linked_job.id = invoice.job_id)
    where assessment.client_id = old.id
  ) then v_retained_types := array_append(v_retained_types, 'Payment'); end if;

  if exists (
    select 1
    from public.walkthroughs assessment
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(assessment.photos) = 'array' then assessment.photos else '[]'::jsonb end
    ) photo
    where assessment.client_id = old.id
      and (
        exists (select 1 from public.invoice_job_photos snapshot where snapshot.storage_path = photo->>'storagePath')
        or exists (
          select 1 from public.proposals proposal,
            lateral jsonb_array_elements(case when jsonb_typeof(proposal.photos) = 'array' then proposal.photos else '[]'::jsonb end) proposal_photo
          where proposal_photo->>'storagePath' = photo->>'storagePath'
        )
      )
  ) then v_retained_types := array_append(v_retained_types, 'retained photo snapshot'); end if;

  if cardinality(v_retained_types) > 0 then
    raise exception using
      errcode = '23503',
      message = format(
        'This Client cannot be permanently deleted because an Assessment is linked to retained %s history. Keep the Client and Assessment archived.',
        array_to_string(v_retained_types, ', ')
      );
  end if;

  delete from public.assessment_photo_access access
  using public.walkthroughs assessment
  where access.walkthrough_id = assessment.id
    and assessment.client_id = old.id;

  delete from public.attention_item_states state
  using public.walkthroughs assessment
  where assessment.client_id = old.id
    and state.attention_key = 'walkthrough:' || assessment.id::text || ':requested';

  -- Remove the Storage references before their owning Assessment rows. The
  -- browser deletes the now-unreferenced objects through the Storage API.
  update public.walkthroughs
  set photos = '[]'::jsonb
  where client_id = old.id;

  delete from public.walkthroughs
  where client_id = old.id;

  return old;
end;
$$;

revoke all on function private.cleanup_client_assessments_before_delete()
from public, anon, authenticated;

drop trigger if exists clients_cleanup_assessments_before_delete on public.clients;
create trigger clients_cleanup_assessments_before_delete
before delete on public.clients
for each row execute function private.cleanup_client_assessments_before_delete();

-- Once the transaction has removed an Assessment and all database references,
-- permit the same Master Admin to remove its orphaned object through Storage.
create or replace function public.can_delete_operational_photo_path(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_id uuid;
begin
  if array_length(v_parts, 1) not in (3, 4)
    or v_parts[1] not in ('walkthroughs', 'jobs') then return false; end if;
  v_id := v_parts[2]::uuid;
  return public.is_valid_operational_photo_path(v_parts[1], v_id, p_name)
    and (
      public.can_delete_operational_photo_record(v_parts[1], v_id)
      or (
        v_parts[1] = 'walkthroughs'
        and public.is_master_admin()
        and not exists (select 1 from public.walkthroughs where id = v_id)
      )
    )
    and not exists (select 1 from public.invoice_job_photos reference where reference.storage_path = p_name)
    and not exists (
      select 1 from public.walkthroughs assessment,
        lateral jsonb_array_elements(case when jsonb_typeof(assessment.photos) = 'array' then assessment.photos else '[]'::jsonb end) photo
      where photo->>'storagePath' = p_name
    )
    and not exists (
      select 1 from public.jobs job,
        lateral jsonb_array_elements(case when jsonb_typeof(job.photos) = 'array' then job.photos else '[]'::jsonb end) photo
      where photo->>'storagePath' = p_name
    )
    and not exists (
      select 1 from public.proposals proposal,
        lateral jsonb_array_elements(case when jsonb_typeof(proposal.photos) = 'array' then proposal.photos else '[]'::jsonb end) photo
      where photo->>'storagePath' = p_name
    );
exception when invalid_text_representation then return false;
end;
$$;

revoke all on function public.can_delete_operational_photo_path(text)
from public, anon, authenticated;
grant execute on function public.can_delete_operational_photo_path(text)
to authenticated;

notify pgrst, 'reload schema';
commit;
