-- Server-controlled employee email delivery history and durable provider receipts.
begin;

create table public.employee_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  request_id uuid not null,
  employee_id uuid not null references public.employees(id) on delete restrict,
  employee_name text not null,
  recipient_email text not null,
  department text not null,
  subject text not null check (char_length(btrim(subject)) between 1 and 200),
  message_body text not null check (char_length(btrim(message_body)) between 1 and 10000),
  sender_id uuid references public.user_profiles(id) on delete set null,
  sender_name text not null,
  sender_role text not null check (sender_role in ('Master Admin', 'Administrator')),
  status text not null default 'Pending' check (status in ('Pending', 'Accepted', 'Failed')),
  provider text not null default 'resend' check (provider = 'resend'),
  provider_message_id text,
  provider_submission_started_at timestamptz,
  accepted_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_email_deliveries_request_employee_key unique (request_id, employee_id),
  constraint employee_email_deliveries_result_check check (
    (status = 'Pending' and provider_message_id is null and accepted_at is null and failed_at is null and failure_reason is null)
    or (status = 'Accepted' and provider_message_id is not null and accepted_at is not null and failed_at is null and failure_reason is null)
    or (status = 'Failed' and provider_message_id is null and accepted_at is null and failed_at is not null and failure_reason is not null)
  )
);

create index employee_email_deliveries_history_idx on public.employee_email_deliveries(created_at desc);
create index employee_email_deliveries_employee_idx on public.employee_email_deliveries(employee_id, created_at desc);

create table public.employee_email_provider_submissions (
  delivery_id uuid primary key references public.employee_email_deliveries(id) on delete restrict,
  event_key text not null unique,
  provider text not null check (provider = 'resend'),
  provider_message_id text not null unique,
  accepted_at timestamptz not null default now()
);

alter table public.employee_email_deliveries enable row level security;
alter table public.employee_email_provider_submissions enable row level security;
revoke all on table public.employee_email_deliveries from public, anon, authenticated;
revoke all on table public.employee_email_provider_submissions from public, anon, authenticated;
grant select, insert, update on table public.employee_email_deliveries to service_role;
grant select, insert on table public.employee_email_provider_submissions to service_role;

create function private.protect_employee_email_delivery_identity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.event_key is distinct from old.event_key
    or new.request_id is distinct from old.request_id
    or new.employee_id is distinct from old.employee_id
    or new.employee_name is distinct from old.employee_name
    or new.recipient_email is distinct from old.recipient_email
    or new.department is distinct from old.department
    or new.subject is distinct from old.subject
    or new.message_body is distinct from old.message_body
    or new.sender_id is distinct from old.sender_id
    or new.sender_name is distinct from old.sender_name
    or new.sender_role is distinct from old.sender_role
    or new.provider is distinct from old.provider
    or new.created_at is distinct from old.created_at then
    raise exception 'Employee email delivery identity and content are immutable.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger protect_employee_email_delivery_identity
before update on public.employee_email_deliveries
for each row execute function private.protect_employee_email_delivery_identity();

create function private.protect_employee_email_provider_submission()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Employee email provider acceptance receipts are append-only.';
end;
$$;

create trigger employee_email_provider_submissions_append_only
before update or delete on public.employee_email_provider_submissions
for each row execute function private.protect_employee_email_provider_submission();

revoke all on function private.protect_employee_email_delivery_identity() from public, anon, authenticated;
revoke all on function private.protect_employee_email_provider_submission() from public, anon, authenticated;

commit;
