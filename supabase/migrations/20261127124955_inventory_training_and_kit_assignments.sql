-- Reuse onboarding steps for inventory training and competency; do not auto-certify personnel.
alter table public.employee_onboarding_steps add column inventory_assessments jsonb not null default '{}'::jsonb check(jsonb_typeof(inventory_assessments)='object');
create table public.technician_kit_assignments (
 id uuid primary key default gen_random_uuid(), kit_number text not null unique,
 kit_id text not null references public.technician_kit_definitions(id), location_id uuid not null references public.technician_inventory_locations(id),
 issued_by uuid not null references public.user_profiles(id), assigned_at timestamptz not null default now(),
 acknowledged_by uuid references public.user_profiles(id), acknowledged_at timestamptz, return_required boolean not null default false,
 returned_at timestamptz,returned_by uuid references public.user_profiles(id),return_notes text,
 check(returned_at is null or (returned_by is not null and nullif(btrim(return_notes),'') is not null))
);
create unique index technician_one_active_kit on public.technician_kit_assignments(location_id,kit_id) where returned_at is null;
alter table public.technician_kit_assignments enable row level security;
revoke all on public.technician_kit_assignments from public,anon,authenticated;
grant select on public.technician_kit_assignments to authenticated;
create policy inventory_assignments_read on public.technician_kit_assignments for select to authenticated using(private.inventory_location_access(location_id));
create trigger inventory_audit after insert or update or delete on public.technician_kit_assignments for each row execute function private.inventory_audit();
create function public.inventory_assign_kit(p_number text,p_kit text,p_location uuid) returns uuid language plpgsql security definer set search_path='' as $$ declare result uuid; begin
 if not private.inventory_manager() then raise exception 'Inventory manager required' using errcode='42501'; end if;
 if nullif(btrim(p_number),'') is null then raise exception 'Kit identification required'; end if;
 if not exists(select 1 from public.technician_inventory_locations where id=p_location and location_type<>'central') then raise exception 'Employee or crew inventory location required'; end if;
 insert into public.technician_kit_assignments(kit_number,kit_id,location_id,issued_by) values(p_number,p_kit,p_location,auth.uid()) returning id into result;
 return result;
end $$;
create function public.inventory_acknowledge_kit(p_id uuid) returns void language plpgsql security definer set search_path='' as $$ begin
 update public.technician_kit_assignments k set acknowledged_by=auth.uid(),acknowledged_at=now() where k.id=p_id and k.returned_at is null and k.acknowledged_at is null
 and private.inventory_employee() and exists(select 1 from public.technician_inventory_locations l where l.id=k.location_id and
 (l.employee_id=public.current_employee_id() or exists(select 1 from public.crews c where c.id=l.crew_id and c.crew_lead_id=public.current_employee_id())));
 if not found then raise exception 'Assigned kit acknowledgment denied' using errcode='42501'; end if;
end $$;
create function public.inventory_return_kit(p_id uuid,p_notes text) returns void language plpgsql security definer set search_path='' as $$ begin
 if not private.inventory_manager() then raise exception 'Inventory manager required' using errcode='42501'; end if;
 update public.technician_kit_assignments set returned_at=now(),returned_by=auth.uid(),return_notes=p_notes,return_required=false where id=p_id and returned_at is null;
 if not found then raise exception 'Active assignment required'; end if;
 -- Stock and serialized equipment require their own explicit physical returns; this does not fabricate them.
end $$;
create function private.inventory_offboarding_recovery() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if (new.employment_status is distinct from old.employment_status or new.archived_at is distinct from old.archived_at) and
 (new.employment_status<>'Active' or new.archived_at is not null) then
 update public.technician_kit_assignments k set return_required=true from public.technician_inventory_locations l
 where l.id=k.location_id and (l.employee_id=new.id or exists(select 1 from public.crews c where c.id=l.crew_id and c.crew_lead_id=new.id)) and k.returned_at is null;
 insert into public.technician_inventory_audit(table_name,record_id,actor,before_row,after_row)
 values('employees_equipment_recovery',new.id::text,auth.uid(),jsonb_build_object('employment_status',old.employment_status),jsonb_build_object('employment_status',new.employment_status,'equipment_recovery_required',true));
 end if;
 return new;
end $$;
create trigger inventory_offboarding_recovery after update of employment_status,archived_at on public.employees for each row execute function private.inventory_offboarding_recovery();
revoke all on function private.inventory_offboarding_recovery() from public,anon,authenticated;
create function private.inventory_assignment_maintenance_due() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if new.status='Completed' and old.status is distinct from new.status then
 update public.technician_equipment_assets a set maintenance_due_at=least(a.maintenance_due_at,
 case when a.maintenance_interval='after_assignment' then now() else (date_trunc('day',now() at time zone 'America/Los_Angeles')+interval '1 day') at time zone 'America/Los_Angeles' end)
 from public.technician_inventory_locations l where l.id=a.location_id and
 (l.employee_id=new.assigned_employee_id or l.crew_id=new.assigned_crew_id) and a.condition<>'retired' and a.maintenance_interval in ('after_assignment','end_of_day');
 end if;
 return new;
end $$;
create trigger inventory_assignment_maintenance_due after update of status on public.jobs for each row execute function private.inventory_assignment_maintenance_due();
revoke all on function private.inventory_assignment_maintenance_due() from public,anon,authenticated;

create function public.inventory_training_records() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('case_id',c.id,'employee_id',c.employee_id,'employee_name',concat_ws(' ',e.first_name,e.last_name),'assessments',coalesce(s.inventory_assessments,'{}'::jsonb))),'[]'::jsonb)
 from public.employee_onboarding_cases c join public.employees e on e.id=c.employee_id
 left join public.employee_onboarding_steps s on s.case_id=c.id and s.code='cleaning_checklists_training'
 where private.inventory_manager() or (private.inventory_employee() and c.employee_id=public.current_employee_id())
$$;
create function public.inventory_assess_training(p_case uuid,p_module text,p_passed boolean,p_practical boolean,p_notes text)
returns void language plpgsql security definer set search_path='' as $$ begin
 if not private.inventory_manager() then raise exception 'Inventory manager required' using errcode='42501'; end if;
 if p_module not in ('kit_familiarization','everyday_essentials','microfiber_colors','chemical_preparation','chemical_safety','equipment_inspection','equipment_maintenance','restocking') or p_passed is null or p_practical is null or nullif(btrim(p_notes),'') is null then raise exception 'Module, result, practical assessment and management notes required'; end if;
 if not exists(select 1 from public.employee_onboarding_cases c join public.employees e on e.id=c.employee_id where c.id=p_case and e.employment_type is distinct from '1099') then raise exception 'Internal employee onboarding record required'; end if;
 insert into public.employee_onboarding_steps(case_id,code,inventory_assessments) values(p_case,'cleaning_checklists_training',jsonb_build_object(p_module,jsonb_build_object('version',1,'trainer',auth.uid(),'training_date',now(),'passed',p_passed,'practical',p_practical,'notes',p_notes,'acknowledged_at',null)))
 on conflict(case_id,code) do update set inventory_assessments=public.employee_onboarding_steps.inventory_assessments||excluded.inventory_assessments;
 insert into public.technician_inventory_audit(table_name,record_id,actor,after_row) values('inventory_training_assessment',p_case::text,auth.uid(),jsonb_build_object('module',p_module,'passed',p_passed,'practical',p_practical,'notes',p_notes));
end $$;
create function public.inventory_acknowledge_training(p_case uuid,p_module text) returns void language plpgsql security definer set search_path='' as $$ begin
 if not private.inventory_employee() or not exists(select 1 from public.employee_onboarding_cases where id=p_case and employee_id=public.current_employee_id()) then raise exception 'Own training record required' using errcode='42501'; end if;
 update public.employee_onboarding_steps set inventory_assessments=jsonb_set(inventory_assessments,array[p_module,'acknowledged_at'],to_jsonb(now()))
 where case_id=p_case and code='cleaning_checklists_training' and inventory_assessments ? p_module;
 if not found then raise exception 'Management assessment required before acknowledgment'; end if;
 insert into public.technician_inventory_audit(table_name,record_id,actor,after_row) values('inventory_training_acknowledgment',p_case::text,auth.uid(),jsonb_build_object('module',p_module));
end $$;
create function public.inventory_chemical_authorization() returns boolean language sql stable security definer set search_path='' as $$
 select private.inventory_employee() and exists(select 1 from public.employee_onboarding_steps s join public.employee_onboarding_cases c on c.id=s.case_id
 where c.employee_id=public.current_employee_id() and s.code='cleaning_checklists_training'
 and s.inventory_assessments->'chemical_preparation'->>'passed'='true' and s.inventory_assessments->'chemical_preparation'->>'practical'='true'
 and s.inventory_assessments->'chemical_preparation'->>'acknowledged_at' is not null
 and s.inventory_assessments->'chemical_safety'->>'passed'='true' and s.inventory_assessments->'chemical_safety'->>'acknowledged_at' is not null)
$$;
revoke all on function public.inventory_assign_kit(text,text,uuid),public.inventory_acknowledge_kit(uuid),public.inventory_return_kit(uuid,text),public.inventory_training_records(),public.inventory_assess_training(uuid,text,boolean,boolean,text),public.inventory_acknowledge_training(uuid,text),public.inventory_chemical_authorization() from public,anon,authenticated;
grant execute on function public.inventory_assign_kit(text,text,uuid),public.inventory_acknowledge_kit(uuid),public.inventory_return_kit(uuid,text),public.inventory_training_records(),public.inventory_assess_training(uuid,text,boolean,boolean,text),public.inventory_acknowledge_training(uuid,text),public.inventory_chemical_authorization() to authenticated;
create function public.inventory_configure_kit(p_id text,p_name text,p_services text[],p_members jsonb) returns void language plpgsql security definer set search_path='' as $$
declare member jsonb; begin
 if not private.inventory_manager() or not public.is_master_admin() then raise exception 'Master Admin required' using errcode='42501'; end if;
 if nullif(btrim(p_id),'') is null or nullif(btrim(p_name),'') is null or jsonb_typeof(p_members)<>'array' or jsonb_array_length(p_members)=0 then raise exception 'Kit identity, name and members required'; end if;
 insert into public.technician_kit_definitions(id,name,service_names) values(p_id,p_name,p_services)
 on conflict(id) do update set name=excluded.name,service_names=excluded.service_names,version=public.technician_kit_definitions.version+1;
 delete from public.technician_kit_members where kit_id=p_id;
 for member in select * from jsonb_array_elements(p_members) loop
 if (member->>'minimum')::numeric::text in ('NaN','Infinity','-Infinity') then raise exception 'Finite minimum required'; end if;
 insert into public.technician_kit_members(kit_id,item_key,minimum_quantity) values(p_id,member->>'item_key',(member->>'minimum')::numeric);
 end loop;
end $$;
revoke all on function public.inventory_configure_kit(text,text,text[],jsonb) from public,anon,authenticated;
grant execute on function public.inventory_configure_kit(text,text,text[],jsonb) to authenticated;
do $$ declare t text; begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
 foreach t in array array['technician_restock_requests','technician_equipment_maintenance','technician_inventory_stock','technician_equipment_assets','technician_kit_assignments','job_inventory_inspections'] loop
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
 execute format('alter publication supabase_realtime add table public.%I',t);
 end if;
 end loop;
 end if;
end $$;
notify pgrst,'reload schema';
