begin;

create table public.communications_email_provider_submissions (
  communication_id uuid primary key
    references public.client_communications(id) on delete cascade,
  event_key text not null unique,
  provider text not null check (lower(provider) = 'resend'),
  provider_message_id text not null
    check (nullif(btrim(provider_message_id), '') is not null),
  created_at timestamptz not null default now()
);

alter table public.communications_email_provider_submissions enable row level security;

revoke all on table public.communications_email_provider_submissions
from public, anon, authenticated;
grant select, insert on table public.communications_email_provider_submissions
to service_role;

comment on table public.communications_email_provider_submissions is
  'Server-only durable receipt of Resend acceptance before client_communications finalization.';

notify pgrst, 'reload schema';

commit;
