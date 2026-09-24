begin;

create or replace function public.archive_sales_assessment(p_assessment_id uuid)
returns public.walkthroughs
language plpgsql
security definer
set search_path = ''
as $$
declare
  assessment public.walkthroughs;
  retained_types text[] := '{}'::text[];
begin
  if auth.uid() is null
    or not public.has_any_role(array['Master Admin', 'Administrator', 'Manager']) then
    raise exception 'Assessment archive permission denied.' using errcode = '42501';
  end if;

  select *
  into assessment
  from public.walkthroughs
  where id = p_assessment_id
  for update;

  if not found then
    raise exception 'Assessment not found.';
  end if;

  if assessment.archived_at is not null then
    return assessment;
  end if;

  if exists (
    select 1 from public.proposals proposal
    where proposal.walkthrough_id = assessment.id
  ) then retained_types := array_append(retained_types, 'Proposal'); end if;

  if exists (
    select 1
    from public.service_agreements agreement
    join public.proposals proposal on proposal.id = agreement.proposal_id
    where proposal.walkthrough_id = assessment.id
  ) then retained_types := array_append(retained_types, 'Agreement'); end if;

  if exists (
    select 1
    from public.jobs job
    left join public.proposals proposal on proposal.id = job.proposal_id
    where job.walkthrough_id = assessment.id
      or proposal.walkthrough_id = assessment.id
  ) then retained_types := array_append(retained_types, 'Job'); end if;

  if exists (
    select 1
    from public.invoices invoice
    left join public.proposals proposal on proposal.id = invoice.proposal_id
    left join public.jobs job on job.id = invoice.job_id
    left join public.proposals job_proposal on job_proposal.id = job.proposal_id
    left join public.service_agreements agreement on agreement.id = invoice.service_agreement_id
    left join public.proposals agreement_proposal on agreement_proposal.id = agreement.proposal_id
    where proposal.walkthrough_id = assessment.id
      or job.walkthrough_id = assessment.id
      or job_proposal.walkthrough_id = assessment.id
      or agreement_proposal.walkthrough_id = assessment.id
  ) then retained_types := array_append(retained_types, 'Invoice'); end if;

  if exists (
    select 1
    from public.payments payment
    left join public.jobs payment_job on payment_job.id = payment.job_id
    left join public.proposals payment_job_proposal on payment_job_proposal.id = payment_job.proposal_id
    left join public.invoices invoice on invoice.id = payment.invoice_id
    left join public.proposals invoice_proposal on invoice_proposal.id = invoice.proposal_id
    left join public.jobs invoice_job on invoice_job.id = invoice.job_id
    left join public.proposals invoice_job_proposal on invoice_job_proposal.id = invoice_job.proposal_id
    left join public.service_agreements agreement on agreement.id = invoice.service_agreement_id
    left join public.proposals agreement_proposal on agreement_proposal.id = agreement.proposal_id
    where payment_job.walkthrough_id = assessment.id
      or payment_job_proposal.walkthrough_id = assessment.id
      or invoice_proposal.walkthrough_id = assessment.id
      or invoice_job.walkthrough_id = assessment.id
      or invoice_job_proposal.walkthrough_id = assessment.id
      or agreement_proposal.walkthrough_id = assessment.id
  ) then retained_types := array_append(retained_types, 'Payment'); end if;

  if exists (
    select 1
    from public.walkthroughs source_assessment
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(source_assessment.photos) = 'array' then source_assessment.photos else '[]'::jsonb end
    ) assessment_photo
    where source_assessment.id = assessment.id
      and (
        exists (
          select 1 from public.invoice_job_photos snapshot
          where snapshot.storage_path = assessment_photo->>'storagePath'
        )
        or exists (
          select 1
          from public.proposals proposal,
            lateral jsonb_array_elements(
              case when jsonb_typeof(proposal.photos) = 'array' then proposal.photos else '[]'::jsonb end
            ) proposal_photo
          where proposal_photo->>'storagePath' = assessment_photo->>'storagePath'
        )
      )
  ) then retained_types := array_append(retained_types, 'photo snapshot'); end if;

  if exists (
    select 1
    from public.client_communications communication
    where (assessment.estimate_id is not null and communication.estimate_id = assessment.estimate_id)
      or communication.proposal_id in (
        select proposal.id from public.proposals proposal where proposal.walkthrough_id = assessment.id
      )
      or communication.agreement_id in (
        select agreement.id
        from public.service_agreements agreement
        join public.proposals proposal on proposal.id = agreement.proposal_id
        where proposal.walkthrough_id = assessment.id
      )
      or communication.invoice_id in (
        select invoice.id
        from public.invoices invoice
        left join public.proposals proposal on proposal.id = invoice.proposal_id
        left join public.jobs job on job.id = invoice.job_id
        left join public.proposals job_proposal on job_proposal.id = job.proposal_id
        left join public.service_agreements agreement on agreement.id = invoice.service_agreement_id
        left join public.proposals agreement_proposal on agreement_proposal.id = agreement.proposal_id
        where proposal.walkthrough_id = assessment.id
          or job.walkthrough_id = assessment.id
          or job_proposal.walkthrough_id = assessment.id
          or agreement_proposal.walkthrough_id = assessment.id
      )
  ) then retained_types := array_append(retained_types, 'communication'); end if;

  if exists (
    select 1
    from public.jobs job
    left join public.proposals proposal on proposal.id = job.proposal_id
    where (job.walkthrough_id = assessment.id or proposal.walkthrough_id = assessment.id)
      and (
        exists (select 1 from public.time_entries entry where entry.job_id = job.id)
        or exists (select 1 from public.expenses expense where expense.job_id = job.id)
        or exists (select 1 from public.mileage_entries mileage where mileage.job_id = job.id)
        or exists (select 1 from public.job_mileage_trips trip where trip.job_id = job.id)
        or exists (select 1 from public.service_occurrences occurrence where occurrence.job_id = job.id)
        or exists (select 1 from public.invoice_job_photos photo where photo.job_id = job.id)
      )
  ) then retained_types := array_append(retained_types, 'operational or financial'); end if;

  if cardinality(retained_types) > 0 then
    raise exception using
      errcode = '23503',
      message = format(
        'This Assessment cannot be archived because it is linked to retained %s history.',
        array_to_string(retained_types, ', ')
      );
  end if;

  update public.walkthroughs
  set archived_at = now(), status = 'Archived'
  where id = assessment.id
  returning * into assessment;

  return assessment;
end;
$$;

revoke all on function public.archive_sales_assessment(uuid)
from public, anon, authenticated;
grant execute on function public.archive_sales_assessment(uuid)
to authenticated;

notify pgrst, 'reload schema';
commit;
