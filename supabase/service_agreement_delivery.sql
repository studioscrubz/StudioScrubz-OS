-- StudioScrubz OS: Service Agreement client delivery workflow.
-- REVIEW ONLY. Do not execute automatically.

alter table public.service_agreements
  add column if not exists sent_at timestamptz,
  add column if not exists sent_to text,
  add column if not exists sent_by text,
  add column if not exists accepted_at timestamptz,
  add column if not exists agreement_terms text,
  add column if not exists cancellation_terms text;

alter table public.service_agreements drop constraint if exists service_agreements_status_check;
alter table public.service_agreements add constraint service_agreements_status_check
  check (status in ('Draft','Sent','Accepted','Active','Paused','Completed','Cancelled','Expired','Archived'));

create index if not exists service_agreements_sent_at_idx on public.service_agreements(sent_at);

-- Existing Phase 18 privileges and RLS remain authoritative. No grants or policies
-- are changed here, so this migration does not broaden agreement access.
