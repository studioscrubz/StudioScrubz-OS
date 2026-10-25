-- Preserve notification scope and RPC signature; enrich authorized notices with job display information.
create or replace function public.get_my_equipment_notifications()
returns table(id uuid,job_id uuid,event_type text,created_at timestamptz,details jsonb)
language sql security definer set search_path='' as $$
 select n.id,n.job_id,n.event_type,n.created_at,
  coalesce(n.details,'{}'::jsonb) || jsonb_build_object(
   'clientName',j.client_name,
   'serviceDate',j.scheduled_date
  )
 from public.job_equipment_notifications n
 left join public.jobs j on j.id=n.job_id
 where auth.uid() is not null
  and n.employee_id=public.current_employee_id()
  and n.read_at is null
 order by n.created_at desc limit 30;
$$;
revoke all on function public.get_my_equipment_notifications() from public,anon,authenticated;
grant execute on function public.get_my_equipment_notifications() to authenticated;
