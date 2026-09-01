-- Enforce the existing Custom frequency interval without altering signed historical agreements.
begin;

alter table public.service_agreements
  add constraint service_agreements_custom_schedule_check
    check (
      (frequency = 'Custom' and custom_interval_days is not null and custom_interval_days >= 1)
      or (frequency <> 'Custom' and custom_interval_days is null)
    ) not valid;

notify pgrst, 'reload schema';
commit;
