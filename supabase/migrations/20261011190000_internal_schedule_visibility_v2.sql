begin;
alter table public.internal_schedule_events drop constraint internal_schedule_events_visibility_check;
update public.internal_schedule_events set visibility=case when visibility='Sales Visible' then 'Company-wide' when visibility='Management Only' then 'Management only' else visibility end where visibility in ('Sales Visible','Management Only');
alter table public.internal_schedule_events add constraint internal_schedule_events_visibility_check check (visibility in ('Authorized attendees only','Company-wide','Management only'));

create or replace function private.internal_schedule_active_os_user(p_user_id uuid) returns boolean language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from public.user_profiles p left join public.employees e on e.id=p.employee_id where p.id=p_user_id and p.is_active and (p.role='Master Admin' or (e.id is not null and e.employment_status='Active' and e.archived_at is null)));
$fn$;
create or replace function private.internal_schedule_is_master_admin(p_user_id uuid) returns boolean language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from public.user_profiles p where p.id=p_user_id and p.is_active and p.role='Master Admin');
$fn$;
create or replace function private.internal_schedule_employee_is_authorized(p_employee_id uuid) returns boolean language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from public.employees e join public.user_profiles p on p.employee_id=e.id where e.id=p_employee_id and e.employment_status='Active' and e.archived_at is null and p.is_active);
$fn$;
create or replace function private.current_user_is_internal_event_attendee(p_event_id uuid) returns boolean language sql stable security definer set search_path='' as $fn$
 select private.internal_schedule_active_os_user(auth.uid()) and exists(select 1 from public.internal_schedule_event_attendees a join public.user_profiles p on p.employee_id=a.employee_id where a.event_id=p_event_id and p.id=auth.uid() and p.is_active);
$fn$;
create or replace function private.can_view_internal_schedule_event(p_event_id uuid) returns boolean language sql stable security definer set search_path='' as $fn$
 select private.internal_schedule_active_os_user(auth.uid()) and exists(select 1 from public.internal_schedule_events e where e.id=p_event_id and (private.internal_schedule_is_master_admin(auth.uid()) or e.organizer_user_id=auth.uid() or private.current_user_is_internal_event_attendee(e.id) or e.visibility='Company-wide' or (e.visibility='Management only' and exists(select 1 from public.user_profiles p where p.id=auth.uid() and p.is_active and p.role in ('Master Admin','Administrator','Manager')))));
$fn$;
create or replace function public.get_internal_schedule_attendee_options() returns table(id uuid,display_name text) language sql stable security definer set search_path='' as $fn$
 select e.id,coalesce(nullif(btrim(e.preferred_name),''),nullif(btrim(e.first_name||' '||e.last_name),''),e.employee_number) from public.employees e where private.internal_schedule_access_level(auth.uid()) in ('Management','Sales') and e.employment_status='Active' and e.archived_at is null and private.internal_schedule_employee_is_authorized(e.id) order by 2,e.id;
$fn$;
drop policy if exists "Management updates internal events" on public.internal_schedule_events;
drop policy if exists "Management deletes internal events" on public.internal_schedule_events;
drop policy if exists "Sales creates own visible events" on public.internal_schedule_events;
drop policy if exists "Sales updates own visible events" on public.internal_schedule_events;
drop policy if exists "Sales deletes own visible events" on public.internal_schedule_events;
create policy "Sales creates permitted internal events" on public.internal_schedule_events for insert to authenticated with check(private.internal_schedule_access_level(auth.uid())='Sales' and organizer_user_id=auth.uid() and organizer_employee_id=current_employee_id() and visibility in ('Authorized attendees only','Company-wide'));
create policy "Authorized organizers update internal events" on public.internal_schedule_events for update to authenticated using(private.internal_schedule_is_master_admin(auth.uid()) or (organizer_user_id=auth.uid() and private.internal_schedule_access_level(auth.uid()) in ('Management','Sales'))) with check(private.internal_schedule_is_master_admin(auth.uid()) or (organizer_user_id=auth.uid() and private.internal_schedule_access_level(auth.uid())='Management') or (organizer_user_id=auth.uid() and private.internal_schedule_access_level(auth.uid())='Sales' and organizer_employee_id=current_employee_id() and visibility in ('Authorized attendees only','Company-wide')));
create policy "Authorized organizers delete internal events" on public.internal_schedule_events for delete to authenticated using(private.internal_schedule_is_master_admin(auth.uid()) or (organizer_user_id=auth.uid() and private.internal_schedule_access_level(auth.uid()) in ('Management','Sales')));
drop policy if exists "Management invites event attendees" on public.internal_schedule_event_attendees;
drop policy if exists "Management removes event attendees" on public.internal_schedule_event_attendees;
drop policy if exists "Sales organizers invite event attendees" on public.internal_schedule_event_attendees;
drop policy if exists "Sales organizers remove event attendees" on public.internal_schedule_event_attendees;
drop policy if exists "Invitees update only their RSVP" on public.internal_schedule_event_attendees;
create or replace function private.internal_schedule_can_manage_attendees(p_event_id uuid) returns boolean language sql stable security definer set search_path='' as $fn$
 select private.internal_schedule_is_master_admin(auth.uid()) or exists(select 1 from public.internal_schedule_events e where e.id=p_event_id and e.organizer_user_id=auth.uid() and private.internal_schedule_access_level(auth.uid()) in ('Management','Sales'));
$fn$;
create policy "Authorized organizers invite event attendees" on public.internal_schedule_event_attendees for insert to authenticated with check(private.internal_schedule_can_manage_attendees(event_id));
create policy "Authorized organizers remove event attendees" on public.internal_schedule_event_attendees for delete to authenticated using(private.internal_schedule_can_manage_attendees(event_id));
create policy "Invited employees update RSVP" on public.internal_schedule_event_attendees for update to authenticated using(private.internal_schedule_active_os_user(auth.uid()) and employee_id=current_employee_id()) with check(private.internal_schedule_active_os_user(auth.uid()) and employee_id=current_employee_id());
create or replace function private.prepare_internal_schedule_event_attendee() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 if not private.internal_schedule_employee_is_authorized(new.employee_id) then raise exception 'Internal-event attendees must have an active OS account.' using errcode='23514'; end if;
 if tg_op='INSERT' then
  new.invitation_status:='Invited'; new.invited_at:=transaction_timestamp(); new.responded_at:=null;
 else
  if new.event_id is distinct from old.event_id or new.employee_id is distinct from old.employee_id or new.invited_at is distinct from old.invited_at then raise exception 'Invitation identity cannot be changed.' using errcode='42501'; end if;
  if new.responded_at is distinct from old.responded_at then raise exception 'RSVP timestamps are maintained automatically.' using errcode='42501'; end if;
  if new.invitation_status is distinct from old.invitation_status then
   if new.invitation_status='Invited' then raise exception 'RSVP cannot reset invitation.' using errcode='42501'; end if;
   new.responded_at:=transaction_timestamp();
  end if;
 end if;
 return new;
end;
$fn$;
create or replace function public.get_current_internal_schedule_access_level() returns text language sql stable security definer set search_path='' as $fn$
 select case when auth.uid() is null then 'None' when private.internal_schedule_access_level(auth.uid()) in ('Management','Sales') then private.internal_schedule_access_level(auth.uid()) when private.internal_schedule_active_os_user(auth.uid()) then 'View' else 'None' end;
$fn$;
commit;
