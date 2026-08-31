\set ON_ERROR_STOP on

begin;

create temporary table master_time_correction_results (
  test_name text primary key,
  passed boolean not null,
  detail text not null
);

insert into public.business_settings (id, business_name, timezone)
values ('00000000-0000-0000-0000-000000000019', 'StudioScrubz', 'America/Los_Angeles')
on conflict (id) do update set timezone = excluded.timezone;

insert into auth.users (id, aud, role, email, created_at, updated_at) values
  ('fc700000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'manager@job-time.invalid', now(), now()),
  ('fc700000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'tech@job-time.invalid', now(), now());
insert into public.employees (id, employee_number, first_name, last_name, email, department, employment_status, employment_type) values
  ('fc700000-0000-0000-0000-000000000011', 'EMP-JT-MGR', 'Job Time', 'Manager', 'manager@job-time.invalid', 'Management', 'Active', 'Full-Time'),
  ('fc700000-0000-0000-0000-000000000012', 'EMP-JT-TECH', 'Job Time', 'Tech', 'tech@job-time.invalid', 'Scrub Technicians', 'Active', 'Part-Time');
insert into public.user_profiles (id, email, display_name, role, is_active, employee_id) values
  ('fc700000-0000-0000-0000-000000000001', 'manager@job-time.invalid', 'Job Time Manager', 'Manager', true, 'fc700000-0000-0000-0000-000000000011'),
  ('fc700000-0000-0000-0000-000000000002', 'tech@job-time.invalid', 'Job Time Tech', 'Scrub Technician', true, 'fc700000-0000-0000-0000-000000000012');
insert into public.clients (id, client_type, first_name, last_name, status)
values ('fc700000-0000-0000-0000-000000000020', 'Residential', 'Historical', 'Client', 'Active');
insert into public.properties (id, client_id, property_name, property_type, address, city, state, zip)
values ('fc700000-0000-0000-0000-000000000021', 'fc700000-0000-0000-0000-000000000020', 'Historical Property', 'Residential', '700 Test Avenue', 'Los Angeles', 'CA', '90001');
insert into public.crews (id, crew_name, status)
values ('fc700000-0000-0000-0000-000000000030', 'Historical Crew', 'Active');
insert into public.crew_members (crew_id, employee_id) values
  ('fc700000-0000-0000-0000-000000000030', 'fc700000-0000-0000-0000-000000000011'),
  ('fc700000-0000-0000-0000-000000000030', 'fc700000-0000-0000-0000-000000000012');
insert into public.jobs (
  id, job_number, division, status, client_id, property_id, client_name, property_name,
  service_name, assigned_crew_id, assigned_crew_name, assigned_team, completed_at
) values (
  'fc700000-0000-0000-0000-000000000040', 'JOB-HISTORICAL-TIME', 'Residential', 'Completed',
  'fc700000-0000-0000-0000-000000000020', 'fc700000-0000-0000-0000-000000000021',
  'Historical Client', 'Historical Property', 'Historical Service',
  'fc700000-0000-0000-0000-000000000030', 'Historical Crew', '[]', now() - interval '1 day'
);
insert into public.time_entries (
  id, time_entry_number, employee_id, job_id, crew_id, work_date, clock_in, clock_out,
  total_hours, regular_hours, entry_type, status
) values (
  'fc700000-0000-0000-0000-000000000050', 'TIME-HISTORICAL-UNCHANGED',
  'fc700000-0000-0000-0000-000000000012', 'fc700000-0000-0000-0000-000000000040',
  'fc700000-0000-0000-0000-000000000030', '2026-08-29',
  '2026-08-29 23:00:00-07', '2026-08-30 02:00:00-07', 3, 3, 'Job', 'Completed'
);
insert into public.employee_work_sessions (id, employee_id, clock_in, status)
values ('fc700000-0000-0000-0000-000000000060', 'fc700000-0000-0000-0000-000000000012', now() - interval '2 hours', 'Open');
insert into public.invoices (
  id, invoice_number, job_id, client_id, property_id, client_name, property_name,
  service_name, status, subtotal, discount, tax, total, amount_paid, balance_due, paid_at
) values (
  'fc700000-0000-0000-0000-000000000070', 'INV-HISTORICAL-PAID',
  'fc700000-0000-0000-0000-000000000040', 'fc700000-0000-0000-0000-000000000020',
  'fc700000-0000-0000-0000-000000000021', 'Historical Client', 'Historical Property',
  'Historical Service', 'Paid', 100, 0, 0, 100, 100, 0, now() - interval '1 day'
);
insert into public.payments (id, invoice_id, client_id, job_id, amount, payment_date, payment_method, reference_number)
values ('fc700000-0000-0000-0000-000000000080', 'fc700000-0000-0000-0000-000000000070',
  'fc700000-0000-0000-0000-000000000020', 'fc700000-0000-0000-0000-000000000040',
  100, '2026-08-30', 'Credit Card', 'HISTORICAL-PAID');

create temporary table protected_snapshot as
select
  (select to_jsonb(entry) from public.time_entries entry where id = 'fc700000-0000-0000-0000-000000000050') as time_entry,
  (select count(*) from public.time_entries entry where entry.job_id = 'fc700000-0000-0000-0000-000000000040') as time_entry_count,
  (select to_jsonb(session) from public.employee_work_sessions session where id = 'fc700000-0000-0000-0000-000000000060') as presence,
  (select count(*) from public.employee_work_sessions) as presence_count,
  (select to_jsonb(invoice) from public.invoices invoice where id = 'fc700000-0000-0000-0000-000000000070') as invoice,
  (select count(*) from public.invoices invoice where invoice.job_id = 'fc700000-0000-0000-0000-000000000040') as invoice_count,
  (select to_jsonb(payment) from public.payments payment where id = 'fc700000-0000-0000-0000-000000000080') as payment,
  (select count(*) from public.payments payment where payment.job_id = 'fc700000-0000-0000-0000-000000000040') as payment_count;

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'fc700000-0000-0000-0000-000000000001', true);
select public.correct_completed_job_master_time(
  'fc700000-0000-0000-0000-000000000040', '2026-08-29', '22:30', '2026-08-30', '02:45'
);

insert into master_time_correction_results
select 'historical_completed_time_added',
  job.status = 'Completed'
    and job.operational_started_at at time zone 'America/Los_Angeles' = timestamp '2026-08-29 22:30:00'
    and job.operational_ended_at at time zone 'America/Los_Angeles' = timestamp '2026-08-30 02:45:00'
    and job.completed_at = job.operational_ended_at
    and extract(epoch from (job.operational_ended_at - job.operational_started_at)) / 3600 = 4.25,
  'A Completed historical Job receives an authoritative 4h15m master duration and remains Completed.'
from public.jobs job where id = 'fc700000-0000-0000-0000-000000000040';

insert into master_time_correction_results
select 'financial_labor_presence_unchanged',
  snapshot.time_entry = (select to_jsonb(entry) from public.time_entries entry where id = 'fc700000-0000-0000-0000-000000000050')
    and snapshot.time_entry_count = (select count(*) from public.time_entries entry where entry.job_id = 'fc700000-0000-0000-0000-000000000040')
    and snapshot.presence = (select to_jsonb(session) from public.employee_work_sessions session where id = 'fc700000-0000-0000-0000-000000000060')
    and snapshot.presence_count = (select count(*) from public.employee_work_sessions)
    and snapshot.invoice = (select to_jsonb(invoice) from public.invoices invoice where id = 'fc700000-0000-0000-0000-000000000070')
    and snapshot.invoice_count = (select count(*) from public.invoices invoice where invoice.job_id = 'fc700000-0000-0000-0000-000000000040')
    and snapshot.payment = (select to_jsonb(payment) from public.payments payment where id = 'fc700000-0000-0000-0000-000000000080')
    and snapshot.payment_count = (select count(*) from public.payments payment where payment.job_id = 'fc700000-0000-0000-0000-000000000040'),
  'Paid invoice, payment, employee labor, and platform presence remain unchanged.'
from protected_snapshot snapshot;

select public.correct_completed_job_master_time(
  'fc700000-0000-0000-0000-000000000040', '2026-08-28', '20:00', '2026-08-30', '02:00'
);
insert into master_time_correction_results
select 'existing_time_corrected_multi_day',
  status = 'Completed'
    and extract(epoch from (operational_ended_at - operational_started_at)) / 3600 = 30,
  'Existing master time can be corrected to a 30-hour multi-day duration.'
from public.jobs where id = 'fc700000-0000-0000-0000-000000000040';

do $$
begin
  begin
    perform public.correct_completed_job_master_time(
      'fc700000-0000-0000-0000-000000000040', '2026-08-30', '10:00', '2026-08-30', '09:59'
    );
    raise exception 'Expected end-before-start rejection.';
  exception when others then
    if sqlerrm not like 'Job End cannot be before Job Start.%' then raise; end if;
  end;
end
$$;
insert into master_time_correction_results values ('end_before_start_rejected', true, 'End before Start is rejected.');

select set_config('request.jwt.claim.sub', 'fc700000-0000-0000-0000-000000000002', true);
do $$
begin
  begin
    perform public.correct_completed_job_master_time(
      'fc700000-0000-0000-0000-000000000040', '2026-08-29', '22:30', '2026-08-30', '02:45'
    );
    raise exception 'Expected unauthorized-role rejection.';
  exception when others then
    if sqlerrm not like 'Job time correction permission denied.%' then raise; end if;
  end;
end
$$;
insert into master_time_correction_results values ('technician_rejected', true, 'Scrub Technician correction is rejected by the RPC.');

do $$
begin
  if exists (select 1 from master_time_correction_results where not passed) then
    raise exception 'Completed Job master-time correction regression failure.';
  end if;
end
$$;

table master_time_correction_results;
rollback;
