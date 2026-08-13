-- Review only. Apply after employees_crews.sql. Do not execute automatically.
alter table public.jobs add column if not exists assigned_crew_id uuid;
do $$ begin if not exists(select 1 from pg_constraint where conname='jobs_assigned_crew_id_fkey' and conrelid='public.jobs'::regclass) then alter table public.jobs add constraint jobs_assigned_crew_id_fkey foreign key(assigned_crew_id) references public.crews(id) on delete set null;end if;end $$;
create index if not exists jobs_assigned_crew_id_idx on public.jobs(assigned_crew_id);
