alter table public.job_applications
  drop constraint job_applications_opening_identifier_check,
  drop constraint job_applications_commission_acknowledged_check,
  drop constraint job_applications_v2_answers_check,
  add constraint job_applications_opening_identifier_check
    check (opening_identifier in ('lead-generator', 'scrub-tech')),
  add constraint job_applications_commission_acknowledged_check
    check (
      (opening_identifier = 'lead-generator' and commission_acknowledged)
      or (opening_identifier = 'scrub-tech' and not commission_acknowledged)
    ),
  add constraint job_applications_v2_answers_check
    check (
      (opening_identifier = 'lead-generator' and submission_version = 1)
      or (
        submission_version = 2
        and relevant_experience_boolean is not null
        and relevant_experience is null
        and reachable_networks is null
        and weekly_availability is null
        and (
          (opening_identifier = 'lead-generator'
            and private.is_valid_lead_generator_contact_interests(contact_interests))
          or (opening_identifier = 'scrub-tech' and contact_interests is null)
        )
      )
    );
