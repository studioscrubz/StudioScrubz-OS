alter table public.estimates
  drop constraint if exists estimates_status_check;

alter table public.estimates
  add constraint estimates_status_check
  check (status in ('Open', 'Declined', 'Archived'));

alter table public.estimates
  add column declined_at timestamptz null,
  add column decline_reason text null;
