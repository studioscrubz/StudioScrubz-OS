begin;

create function public.master_admin_permanently_delete_assessment(p_assessment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  assessment public.walkthroughs;
begin
  if (select auth.uid()) is null or not public.is_master_admin() then
    raise exception 'Master Admin authorization is required for permanent Assessment deletion.' using errcode = '42501';
  end if;

  select * into assessment from public.walkthroughs where id = p_assessment_id for update;
  if not found then
    return jsonb_build_object('deleted', false, 'assessment_id', p_assessment_id);
  end if;

  delete from public.assessment_history where walkthrough_id = assessment.id;

  -- Preserve authoritative downstream records; detach only Assessment provenance.
  update public.proposals set walkthrough_id = null where walkthrough_id = assessment.id;
  update public.jobs set walkthrough_id = null where walkthrough_id = assessment.id;

  -- assessment_photo_access is Assessment-owned and cascades on this delete.
  -- Retained communications survive through their preserved Estimate, Proposal,
  -- Agreement, and Invoice relationships; this function never deletes them.
  delete from public.walkthroughs where id = assessment.id;

  delete from public.attention_item_states
  where attention_key = 'walkthrough:' || assessment.id::text || ':requested';

  return jsonb_build_object(
    'deleted', true,
    'assessment_id', assessment.id,
    'photos', coalesce(assessment.photos, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.master_admin_permanently_delete_assessment(uuid)
from public, anon, authenticated;
grant execute on function public.master_admin_permanently_delete_assessment(uuid)
to authenticated;

notify pgrst, 'reload schema';
commit;
