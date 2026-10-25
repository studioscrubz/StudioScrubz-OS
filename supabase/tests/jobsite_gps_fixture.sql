\set ON_ERROR_STOP on
-- Schema-only extension for the existing nonproduction workforce fixture.
create table public.properties (
  id uuid primary key,
  archived_at timestamptz
);
alter table public.jobs add column property_id uuid references public.properties(id);

create table public.walkthroughs (
  id uuid primary key,
  property_id uuid references public.properties(id),
  assigned_employee_id uuid references public.employees(id),
  status text not null,
  walkthrough_date date,
  walkthrough_time time,
  archived_at timestamptz
);

create function public.current_employee_id()
returns uuid language sql stable security definer set search_path='' as $$
  select profile.employee_id
  from public.user_profiles profile
  where profile.id=(select auth.uid()) and profile.is_active
$$;

create function public.is_master_admin()
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.user_profiles profile
    where profile.id=(select auth.uid()) and profile.is_active and profile.role='Master Admin'
  )
$$;

create function public.has_walkthrough_execution_role()
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.user_profiles profile
    where profile.id=(select auth.uid()) and profile.is_active
      and profile.role in ('Master Admin','Manager','Crew Lead')
      and profile.employee_id is not null
  )
$$;

create function public.can_perform_scheduled_walkthrough(p_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select (select auth.uid()) is not null
    and exists (
      select 1 from public.walkthroughs walkthrough
      where walkthrough.id=p_id
        and walkthrough.status='Scheduled'
        and walkthrough.archived_at is null
        and walkthrough.walkthrough_date is not null
        and walkthrough.walkthrough_time is not null
        and (
          public.is_master_admin()
          or (
            public.has_walkthrough_execution_role()
            and public.current_employee_id() is not null
            and walkthrough.assigned_employee_id=public.current_employee_id()
          )
        )
    )
$$;
