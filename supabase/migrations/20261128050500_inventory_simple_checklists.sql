-- Qualitative supply/equipment checklists; physical inventory remains an optional separate workflow.
alter table public.technician_restock_requests
 add column checklist_only boolean not null default false,
 alter column current_quantity drop not null,
 alter column requested_quantity drop not null,
 add constraint technician_restock_checklist_mode check (
  (not checklist_only and current_quantity is not null and requested_quantity is not null)
  or (checklist_only and current_quantity is null and requested_quantity is null and target_quantity is null
      and issued_quantity=0 and received_quantity=0 and status in ('submitted','approved','completed','declined','cancelled'))
 );
create table public.technician_supply_checklists (
 id uuid primary key, requested_by uuid not null references public.user_profiles(id),
 location_id uuid not null references public.technician_inventory_locations(id),
 selections jsonb not null check(jsonb_typeof(selections)='object'),
 created_at timestamptz not null default now()
);
alter table public.technician_supply_checklists enable row level security;
revoke all on public.technician_supply_checklists from public,anon,authenticated;
grant select on public.technician_supply_checklists to authenticated,service_role;
create policy inventory_checklist_read on public.technician_supply_checklists for select to authenticated
 using(private.inventory_location_access(location_id));
create function public.inventory_submit_supply_checklist(p_id uuid,p_selections jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare worker uuid; loc uuid; entry record; prior public.technician_supply_checklists; total integer:=0; display_name text; catalog_name text;
begin
 if auth.uid() is null or not (private.inventory_manager() or private.inventory_employee()) then raise exception 'Active inventory access required' using errcode='42501'; end if;
 if p_id is null or p_selections is null or jsonb_typeof(p_selections)<>'object' or p_selections='{}'::jsonb then raise exception 'Select at least one checked item'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,11));
 select * into prior from public.technician_supply_checklists where id=p_id;
 if found then
  if prior.requested_by<>auth.uid() or prior.selections<>p_selections then raise exception 'Checklist retry does not match'; end if;
  return 0;
 end if;
 -- Use the authenticated user's own assigned location; managers without an employee record use central supplies.
 worker:=public.current_employee_id();
 if not private.inventory_employee() then worker:=null; end if;
 if worker is null and not private.inventory_manager() then raise exception 'Active employee required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(coalesce(worker::text,'inventory-central'),12));
 if worker is null then
  select id into loc from public.technician_inventory_locations where location_type='central' order by id limit 1;
  if loc is null then insert into public.technician_inventory_locations(name,location_type) values('Central supplies','central') returning id into loc; end if;
 else
  select id into loc from public.technician_inventory_locations where employee_id=worker and location_type='individual' order by id limit 1;
  if loc is null then
   select coalesce(nullif(btrim(concat_ws(' ',first_name,last_name)),''),'Employee supplies') into display_name from public.employees where id=worker;
   insert into public.technician_inventory_locations(name,location_type,employee_id) values(display_name,'individual',worker) returning id into loc;
  end if;
 end if;
 for entry in select key,value from jsonb_each_text(p_selections) loop
  select item_name into catalog_name from public.technician_kit_standard_items
   where item_key=entry.key and stock_state not in ('dirty','aggregate');
  if not found or entry.value not in ('good','restock','repair','missing') or entry.value is null then raise exception 'Invalid checklist selection'; end if;
  if entry.value in ('repair','missing') and entry.key not in ('bucket','organizer','cart','vacuum','steamer','scraper','brushes','measure_cup','measure_spoons','funnel','goggles','spill_tray') then raise exception 'Select a reusable equipment item'; end if;
  if entry.value<>'good' then
   insert into public.technician_restock_requests(location_id,item_key,requested_by,current_quantity,requested_quantity,target_quantity,reason,priority,checklist_only)
   values(loc,entry.key,auth.uid(),null,null,null,catalog_name||case entry.value when 'restock' then ' — needs restocking' when 'repair' then ' — needs repair' else ' — missing' end,
     case when entry.value in ('repair','missing') then 'high' else 'routine' end,true)
   on conflict(location_id,item_key) where status not in ('completed','declined','cancelled') do nothing;
   total:=total+1;
  end if;
 end loop;
 insert into public.technician_supply_checklists(id,requested_by,location_id,selections) values(p_id,auth.uid(),loc,p_selections);
 return total;
end $$;
revoke all on function public.inventory_submit_supply_checklist(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.inventory_submit_supply_checklist(uuid,jsonb) to authenticated;
create function public.inventory_finish_checklist_request(p_id uuid,p_decision text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.inventory_manager() then raise exception 'Inventory manager required' using errcode='42501'; end if;
 if p_decision not in ('completed','declined') or p_decision is null then raise exception 'Invalid checklist decision'; end if;
 update public.technician_restock_requests set status=p_decision,reviewed_by=auth.uid(),reviewed_at=now()
 where id=p_id and checklist_only and status in ('submitted','approved');
 if not found then raise exception 'Open checklist request required'; end if;
end $$;
revoke all on function public.inventory_finish_checklist_request(uuid,text) from public,anon,authenticated;
grant execute on function public.inventory_finish_checklist_request(uuid,text) to authenticated;
notify pgrst,'reload schema';
