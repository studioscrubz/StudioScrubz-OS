begin;

alter function public.archive_sales_assessment(uuid)
  rename to archive_sales_assessment_before_retained_history_override_20261008;

revoke all on function public.archive_sales_assessment_before_retained_history_override_20261008(uuid)
from public, anon, authenticated;

create function public.archive_sales_assessment(p_assessment_id uuid)
returns public.walkthroughs
language plpgsql
security definer
set search_path = ''
as $$
declare
  assessment public.walkthroughs;
  target_assessment_id constant uuid := 'd1f5ecaf-94fe-4223-a944-15b78e86ea6f'::uuid;
  audit_note constant text := 'The linked Proposal was created by mistake. Assessment archived with retained historical dependencies; no related records were deleted or detached.';
begin
  if p_assessment_id is distinct from target_assessment_id then
    return public.archive_sales_assessment_before_retained_history_override_20261008(p_assessment_id);
  end if;

  if (select auth.uid()) is null or not public.is_master_admin() then
    raise exception 'Master Admin authorization is required to archive this Assessment with retained history.' using errcode = '42501';
  end if;

  select * into assessment
  from public.walkthroughs
  where id = target_assessment_id
  for update;

  if not found then
    raise exception 'Assessment not found.';
  end if;

  if assessment.archived_at is not null then
    return assessment;
  end if;

  update public.walkthroughs
  set archived_at = now(),
      status = 'Archived'
  where id = assessment.id
  returning * into assessment;

  insert into public.assessment_history(
    walkthrough_id,
    event_type,
    from_stage,
    to_stage,
    changed_fields,
    snapshot,
    changed_by_user_id
  ) values (
    assessment.id,
    'Archived With Retained History',
    assessment.sales_stage,
    assessment.sales_stage,
    array['status', 'archived_at']::text[],
    to_jsonb(assessment) || jsonb_build_object('audit_note', audit_note),
    auth.uid()
  );

  return assessment;
end;
$$;

revoke all on function public.archive_sales_assessment(uuid)
from public, anon, authenticated;
grant execute on function public.archive_sales_assessment(uuid)
to authenticated;

notify pgrst, 'reload schema';

commit;
