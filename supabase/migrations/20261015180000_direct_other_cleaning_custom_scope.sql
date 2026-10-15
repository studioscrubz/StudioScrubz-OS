-- Atomic, authorized custom scope for direct Other Cleaning jobs.
-- No existing job, invoice, price, agreement or historical scope is modified.
begin;
create function public.create_direct_operational_job_with_custom_scope(
  p_client_id uuid,p_property_id uuid,p_service_id uuid,p_addon_ids uuid[] default '{}'::uuid[],
  p_scheduled_date date default null,p_start_time time default null,p_estimated_duration numeric default null,
  p_assignment_kind text default 'unassigned',p_assigned_employee_id uuid default null,p_assigned_crew_id uuid default null,
  p_labor_hours numeric default 0,p_access_instructions text default null,p_internal_notes text default null,
  p_master_price_override numeric default null,p_addon_quantities jsonb default '[]'::jsonb,
  p_custom_scope_description text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result_row jsonb; new_job_id uuid; description text;
begin
  description := nullif(btrim(p_custom_scope_description),'');
  if description is null or length(description) > 10000 then
    raise exception 'Other Cleaning requires a Service Description / Scope of Work (maximum 10000 characters).';
  end if;
  if not exists (
    select 1 from public.services s where s.id=p_service_id
      and s.service_name='Other Cleaning'
  ) then
    raise exception 'Custom scope is only supported for Other Cleaning.';
  end if;
  -- Reuse all existing pricing, permission, client/property, and assignment checks.
  result_row := public.create_direct_operational_job_v2(
    p_client_id,p_property_id,p_service_id,p_addon_ids,p_scheduled_date,p_start_time,
    p_estimated_duration,p_assignment_kind,p_assigned_employee_id,p_assigned_crew_id,
    p_labor_hours,p_access_instructions,p_internal_notes,p_master_price_override,p_addon_quantities
  );
  new_job_id := (result_row->>'id')::uuid;
  if new_job_id is null then raise exception 'Direct Job creation did not return a Job ID.'; end if;
  update public.jobs
    set scope=jsonb_build_array(jsonb_build_object(
      'id',gen_random_uuid()::text,'text',description
    ))
    where id=new_job_id and service_name='Other Cleaning';
  if not found then raise exception 'Custom scope could not be saved to the created Job.'; end if;
  return (select to_jsonb(j) from public.jobs_operational_safe j where j.id=new_job_id);
end $$;
revoke all on function public.create_direct_operational_job_with_custom_scope(uuid,uuid,uuid,uuid[],date,time,numeric,text,uuid,uuid,numeric,text,text,numeric,jsonb,text) from public,anon,authenticated;
grant execute on function public.create_direct_operational_job_with_custom_scope(uuid,uuid,uuid,uuid[],date,time,numeric,text,uuid,uuid,numeric,text,text,numeric,jsonb,text) to authenticated;
commit;
