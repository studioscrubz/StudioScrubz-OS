begin;

create function private.is_valid_lead_generator_contact_interests(p_values text[])
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select p_values is not null
    and cardinality(p_values) between 1 and 11
    and cardinality(p_values) = (select count(distinct value) from unnest(p_values) value)
    and not exists (
      select 1 from unnest(p_values) value
      where value is null or btrim(value) = '' or value not in (
        'Homeowners / Residential',
        'Property Management / Multifamily',
        'General Contractors / Construction Companies',
        'Commercial Offices',
        'Restaurants / Hospitality',
        'Salons / Barbershops',
        'Gyms / Spas',
        'Airbnb / Short-Term Rentals',
        'Recording / Production Facilities',
        'Luxury Estates',
        'Other Local Businesses'
      )
    )
$$;
revoke all on function private.is_valid_lead_generator_contact_interests(text[]) from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.is_valid_lead_generator_contact_interests(text[]) to service_role;

alter table public.job_applications
  add column relevant_experience_boolean boolean,
  add column contact_interests text[],
  add column submission_version smallint not null default 1,
  alter column relevant_experience drop not null,
  alter column reachable_networks drop not null,
  alter column weekly_availability drop not null,
  add constraint job_applications_submission_version_check
    check (submission_version in (1, 2)) not valid,
  add constraint job_applications_v2_answers_check
    check (
      submission_version = 1
      or (
        relevant_experience_boolean is not null
        and private.is_valid_lead_generator_contact_interests(contact_interests)
        and relevant_experience is null
        and reachable_networks is null
        and weekly_availability is null
      )
    ) not valid;

alter table public.job_applications validate constraint job_applications_submission_version_check;
alter table public.job_applications validate constraint job_applications_v2_answers_check;

notify pgrst, 'reload schema';
commit;
