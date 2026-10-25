\set ON_ERROR_STOP on
-- Schema-only extension for the existing nonproduction workforce fixture.
create table public.properties (
  id uuid primary key,
  archived_at timestamptz
);
alter table public.jobs add column property_id uuid references public.properties(id);
