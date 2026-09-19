-- Restore the application-facing Proposal pricing-photo RPCs to the tracked
-- migration chain. Proposal-owned uploads remain governed by the existing
-- private operational-photos bucket and its proposal-path Storage policies.
create or replace function public.get_proposal_pricing_photos(p_proposal_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_photos jsonb;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.user_profiles profile
    where profile.id = (select auth.uid())
      and profile.is_active
      and profile.role in ('Master Admin', 'Administrator', 'Manager')
  ) then
    raise exception 'Proposal photo access denied.';
  end if;

  select proposal.photos
  into v_photos
  from public.proposals proposal
  where proposal.id = p_proposal_id;

  if not found then
    raise exception 'Proposal not found.';
  end if;

  return coalesce(v_photos, '[]'::jsonb);
end;
$$;

create or replace function public.set_proposal_pricing_photo_caption(
  p_proposal_id uuid,
  p_photo_id text,
  p_caption text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_photos jsonb;
  v_match_count integer;
  v_status text;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.user_profiles profile
    where profile.id = (select auth.uid())
      and profile.is_active
      and profile.role in ('Master Admin', 'Administrator', 'Manager')
  ) then
    raise exception 'Proposal photo update denied.';
  end if;

  if length(btrim(coalesce(p_photo_id, ''))) not between 1 and 128
    or length(coalesce(p_caption, '')) > 1000
  then
    raise exception 'Invalid Proposal photo caption request.';
  end if;

  select
    case
      when jsonb_typeof(proposal.photos) = 'array' then proposal.photos
      else '[]'::jsonb
    end,
    proposal.status
  into v_photos, v_status
  from public.proposals proposal
  where proposal.id = p_proposal_id
  for update;

  if not found then
    raise exception 'Proposal not found.';
  end if;

  if v_status is distinct from 'Draft' then
    raise exception 'Pricing photos cannot be changed after the Proposal is finalized.';
  end if;

  select count(*)
  into v_match_count
  from jsonb_array_elements(v_photos) photo
  where photo->>'id' = p_photo_id;

  if v_match_count = 0 then
    raise exception 'Proposal photo not found.';
  elsif v_match_count > 1 then
    raise exception 'Proposal photo identity is ambiguous.';
  end if;

  select jsonb_agg(
    case
      when photo->>'id' = p_photo_id then jsonb_set(
        photo,
        '{caption}',
        coalesce(
          to_jsonb(nullif(btrim(coalesce(p_caption, '')), '')),
          'null'::jsonb
        ),
        true
      )
      else photo
    end
    order by ordinal
  )
  into v_photos
  from jsonb_array_elements(v_photos)
    with ordinality item(photo, ordinal);

  update public.proposals
  set photos = v_photos
  where id = p_proposal_id;

  return v_photos;
end;
$$;

create or replace function public.remove_proposal_pricing_photo(
  p_proposal_id uuid,
  p_photo_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_photos jsonb;
  v_removed jsonb;
  v_match_count integer;
  v_status text;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.user_profiles profile
    where profile.id = (select auth.uid())
      and profile.is_active
      and profile.role in ('Master Admin', 'Administrator', 'Manager')
  ) then
    raise exception 'Proposal photo update denied.';
  end if;

  if length(btrim(coalesce(p_photo_id, ''))) not between 1 and 128 then
    raise exception 'Invalid Proposal photo removal request.';
  end if;

  select
    case
      when jsonb_typeof(proposal.photos) = 'array' then proposal.photos
      else '[]'::jsonb
    end,
    proposal.status
  into v_photos, v_status
  from public.proposals proposal
  where proposal.id = p_proposal_id
  for update;

  if not found then
    raise exception 'Proposal not found.';
  end if;

  if v_status is distinct from 'Draft' then
    raise exception 'Pricing photos cannot be changed after the Proposal is finalized.';
  end if;

  select count(*)
  into v_match_count
  from jsonb_array_elements(v_photos) photo
  where photo->>'id' = p_photo_id;

  if v_match_count = 0 then
    raise exception 'Proposal photo not found.';
  elsif v_match_count > 1 then
    raise exception 'Proposal photo identity is ambiguous.';
  end if;

  select photo
  into v_removed
  from jsonb_array_elements(v_photos) photo
  where photo->>'id' = p_photo_id;

  select coalesce(jsonb_agg(photo order by ordinal), '[]'::jsonb)
  into v_photos
  from jsonb_array_elements(v_photos)
    with ordinality item(photo, ordinal)
  where photo->>'id' <> p_photo_id;

  update public.proposals
  set photos = v_photos
  where id = p_proposal_id;

  return jsonb_build_object(
    'photos', v_photos,
    'removedPhoto', v_removed,
    'deleteStorageObject', coalesce(v_removed->>'ownership', '') = 'proposal'
  );
end;
$$;

revoke all on function public.get_proposal_pricing_photos(uuid),
  public.set_proposal_pricing_photo_caption(uuid, text, text),
  public.remove_proposal_pricing_photo(uuid, text)
from public, anon, authenticated;

grant execute on function public.get_proposal_pricing_photos(uuid),
  public.set_proposal_pricing_photo_caption(uuid, text, text),
  public.remove_proposal_pricing_photo(uuid, text)
to authenticated;
