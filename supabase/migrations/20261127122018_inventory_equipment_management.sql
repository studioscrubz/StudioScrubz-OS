-- Inventory catalog and stock ledger. No physical stock or assignments are seeded.
-- Transaction boundary is owned by the migration runner.
create schema if not exists private;
create table public.technician_kit_standard_items (
 item_key text primary key, item_name text not null,
 kit text not null check(kit in ('essentials','standard','deep','specialty')),
 target numeric not null check(target>0), restock_at numeric check(restock_at>=0 and restock_at<=target),
 unit text not null, standard_version text not null default '1.0'
);
insert into public.technician_kit_standard_items(item_key,item_name,kit,target,restock_at,unit) values
('microfiber','Microfiber towels','essentials',100,35,'towels'),
('trash','Trash bags','essentials',20,5,'bags'),
('gloves','Disposable gloves','essentials',40,10,'pairs'),
('shoe','Shoe covers','essentials',10,5,'pairs'),
('paper','Paper towels','essentials',2,1,'rolls'),
('bucket','5-gallon bucket','standard',1,null,'each'),
('organizer','Bucket organizer','standard',1,null,'each'),
('cart','Transport cart','standard',1,null,'each'),
('disinfectant','Disinfectant spray bottle','standard',1,null,'each'),
('glass','Glass cleaner spray bottle','standard',1,null,'each'),
('alcohol','Alcohol cleaner spray bottle','standard',1,null,'each'),
('degreaser','Degreaser spray bottle','standard',1,null,'each'),
('wood','Wood cleaner','standard',1,null,'each'),
('air','Air freshener','standard',1,null,'each'),
('toilet','Toilet bowl cleaner','standard',1,null,'each'),
('powerwash','Dawn Powerwash','standard',1,null,'each'),
('sponges','Scrub Daddy sponges','standard',2,null,'each'),
('steamer','Floor steamer','standard',1,null,'each'),
('vacuum','Vacuum','standard',1,null,'each'),
('scraper','Scraper','deep',1,null,'each'),
('pink','The Pink Stuff cleaning paste','deep',1,null,'each'),
('bkf','Bar Keepers Friend liquid','deep',1,null,'each'),
('shower','Shower cleaner','specialty',1,null,'each'),
('mold','Mold and mildew cleaner','specialty',1,null,'each'),
('grout','Grout cleaner','specialty',1,null,'each'),
('brushes','Grout brushes','specialty',2,null,'each'),
('steel','Steel wool cleaning towels','specialty',2,null,'each');
create table public.technician_towel_standards (
 color text primary key, usage text not null, target integer not null check(target>0),
 restock_at integer not null check(restock_at>=0 and restock_at<=target)
);
insert into public.technician_towel_standards values
('Red','Toilets',15,5),
('Yellow','Bathroom surfaces',15,5),
('Green','Kitchen',15,5),
('Blue','Glass and mirrors',15,5),
('Orange','General surfaces, furniture and dusting',30,10),
('Gray','Stainless steel',10,5);
create table public.technician_inventory_locations (
 id uuid primary key default gen_random_uuid(), location_type text not null check(location_type in ('central','crew','individual')),
 employee_id uuid references public.employees(id), crew_id uuid references public.crews(id),
 name text not null,
 check ((location_type='central' and employee_id is null and crew_id is null) or
 (location_type='individual' and employee_id is not null and crew_id is null) or
 (location_type='crew' and crew_id is not null and employee_id is null))
);
create table public.technician_inventory_stock (
 location_id uuid not null references public.technician_inventory_locations(id),
 item_key text not null references public.technician_kit_standard_items(item_key),
 quantity numeric not null check(quantity>=0), updated_at timestamptz not null default now(),
 primary key(location_id,item_key)
);
create table public.technician_restock_requests (
 id uuid primary key default gen_random_uuid(),
 location_id uuid not null references public.technician_inventory_locations(id),
 item_key text not null references public.technician_kit_standard_items(item_key),
 requested_by uuid not null references public.user_profiles(id), current_quantity numeric not null check(current_quantity>=0),
 requested_quantity numeric not null check(requested_quantity>0),
 reason text not null check(length(btrim(reason))>0),
 priority text not null check(priority in ('routine','high','urgent')),
 status text not null default 'submitted' check(status in ('submitted','approved','awaiting_purchase','ready','issued','received','completed','declined','cancelled')),
 created_at timestamptz not null default now()
);
create unique index technician_restock_one_open on public.technician_restock_requests(location_id,item_key) where status not in ('completed','declined','cancelled');
create table public.technician_inventory_transactions (
 id uuid primary key default gen_random_uuid(),
 location_id uuid not null references public.technician_inventory_locations(id),
 item_key text not null references public.technician_kit_standard_items(item_key),
 quantity_delta numeric not null check(quantity_delta<>0), actor_user_id uuid not null references public.user_profiles(id),
 reason text not null check(length(btrim(reason))>0), created_at timestamptz not null default now(),
 idempotency_key uuid not null unique
);
-- Fail closed until authorized RPCs and row policies are reviewed and tested.
alter table public.technician_kit_standard_items enable row level security;
revoke all on public.technician_kit_standard_items from public,anon,authenticated;
alter table public.technician_towel_standards enable row level security;
revoke all on public.technician_towel_standards from public,anon,authenticated;
alter table public.technician_inventory_locations enable row level security;
revoke all on public.technician_inventory_locations from public,anon,authenticated;
alter table public.technician_inventory_stock enable row level security;
revoke all on public.technician_inventory_stock from public,anon,authenticated;
alter table public.technician_restock_requests enable row level security;
revoke all on public.technician_restock_requests from public,anon,authenticated;
alter table public.technician_inventory_transactions enable row level security;
revoke all on public.technician_inventory_transactions from public,anon,authenticated;

-- Colored clean/dirty stock is held as leaf catalog items. The parent is derived.
alter table public.technician_kit_standard_items add column parent_key text references public.technician_kit_standard_items(item_key);
alter table public.technician_kit_standard_items add column stock_state text not null default 'available' check(stock_state in ('available','clean','dirty','aggregate'));
update public.technician_kit_standard_items set stock_state='aggregate' where item_key='microfiber';
insert into public.technician_kit_standard_items(item_key,item_name,kit,target,restock_at,unit,parent_key,stock_state)
select 'microfiber_'||lower(color)||'_'||s.state,color||' microfiber ('||s.state||')','essentials',target,
 case when s.state='clean' then restock_at else null end,'towels','microfiber',s.state
from public.technician_towel_standards cross join (values ('clean'),('dirty')) s(state);
-- Color quantities are maintained only in the catalog leaf rows after bootstrap.
alter table public.technician_towel_standards drop column target, drop column restock_at;
insert into public.technician_kit_standard_items(item_key,item_name,kit,target,restock_at,unit) values
('bulk_disinfectant','Zep Antibacterial Disinfectant & Cleaner with Lemon','specialty',128,32,'fl oz'),
('bulk_dawn','Dawn Ultra Original Dishwashing Liquid','specialty',56,14,'fl oz'),
('bulk_citrus','Zep Heavy-Duty Citrus Degreaser','specialty',128,32,'fl oz'),
('bulk_floor','Zep Neutral pH Floor Cleaner','specialty',128,32,'fl oz'),
('bulk_alcohol','90% isopropyl rubbing alcohol (no fragrance, dyes or oils)','specialty',1,0.25,'fl oz'),
('measure_cup','Chemical-resistant measuring cup','specialty',1,null,'each'),
('measure_spoons','Measuring spoon set','specialty',1,null,'set'),
('funnel','Chemical-resistant funnel','specialty',1,null,'each'),
('chemical_gloves','Appropriate chemical-resistant gloves','specialty',1,null,'pairs'),
('goggles','Chemical splash goggles','specialty',1,null,'each'),
('labels','Waterproof identification labels','specialty',1,null,'pack'),
('marker','Permanent marker','specialty',1,null,'each'),
('spill_tray','Spill containment tray','specialty',1,null,'each');
update public.technician_kit_standard_items set restock_at=0.25 where item_key in ('wood','air','toilet','powerwash','pink','bkf','shower','mold','grout');
alter table public.technician_inventory_stock add column capacity numeric check(capacity>0);
alter table public.technician_restock_requests add column target_quantity numeric check(target_quantity>0);
alter table public.technician_restock_requests add column issued_quantity numeric not null default 0 check(issued_quantity>=0 and issued_quantity<=requested_quantity);
alter table public.technician_restock_requests add column received_quantity numeric not null default 0 check(received_quantity>=0 and received_quantity<=issued_quantity);
alter table public.technician_restock_requests add column job_id uuid references public.jobs(id);
alter table public.technician_restock_requests add column notes text;
alter table public.technician_restock_requests add column reviewed_by uuid references public.user_profiles(id);
alter table public.technician_restock_requests add column reviewed_at timestamptz;
alter table public.technician_inventory_transactions add column transaction_type text not null check(transaction_type in ('purchase','issue','consumption','return','transfer','adjustment','laundry_return','damage','loss','disposal'));
alter table public.technician_inventory_transactions add column movement_id uuid not null;
alter table public.technician_inventory_transactions add column job_id uuid references public.jobs(id);
alter table public.technician_inventory_transactions add column request_id uuid references public.technician_restock_requests(id);
alter table public.technician_inventory_transactions add column unit_cost numeric check(unit_cost>=0);
create index technician_transactions_location_time on public.technician_inventory_transactions(location_id,created_at desc);
create unique index technician_location_employee on public.technician_inventory_locations(employee_id) where employee_id is not null;
create unique index technician_location_crew on public.technician_inventory_locations(crew_id) where crew_id is not null;

create table public.technician_inventory_actions (
 id uuid primary key, actor uuid not null references public.user_profiles(id),
 payload jsonb not null, result jsonb, created_at timestamptz not null default now()
);
create table public.technician_inventory_audit (
 id bigint generated always as identity primary key, table_name text not null, record_id text not null,
 actor uuid references public.user_profiles(id), before_row jsonb, after_row jsonb, occurred_at timestamptz not null default now()
);
create table public.technician_chemical_formulas (
 id uuid primary key default gen_random_uuid(), name text not null, version integer not null default 1 check(version>0),
 supersedes uuid references public.technician_chemical_formulas(id),
 status text not null default 'unverified' check(status in ('unverified','conflict','released','retired')),
 manufacturer text, product_name text, sku text, label_url text, sds_url text,
 manufacturer_instructions text, preparation text not null, ppe text, surface_compatibility text,
 dwell_time text, storage_requirements text, hazard_labeling text, conflict_notes text,
 verified_by uuid references public.user_profiles(id), verified_at timestamptz,
 created_at timestamptz not null default now(), unique(name,version),
 check(status<>'released' or (verified_by is not null and verified_at is not null and
   length(btrim(coalesce(manufacturer,'')))>0 and length(btrim(coalesce(product_name,'')))>0 and
   length(btrim(coalesce(sku,'')))>0 and coalesce(label_url,'') like 'https://%' and coalesce(sds_url,'') like 'https://%' and
   length(btrim(coalesce(manufacturer_instructions,'')))>0 and length(btrim(coalesce(ppe,'')))>0 and
   length(btrim(coalesce(surface_compatibility,'')))>0 and length(btrim(coalesce(dwell_time,'')))>0 and
   length(btrim(coalesce(storage_requirements,'')))>0 and length(btrim(coalesce(hazard_labeling,'')))>0 and
   nullif(btrim(conflict_notes),'') is null))
);
insert into public.technician_chemical_formulas(name,preparation) values
('Zep Lemon Disinfectant','Candidate only: 24 fl oz product; no water ONLY if exact label confirms ready-to-use.'),
('Dawn Glass Cleaner','Candidate only: 1/4 teaspoon Dawn Ultra Original; water to 24 fl oz total.'),
('Alcohol Cleaner','Candidate only: 18 2/3 fl oz of 90% isopropyl alcohol; water to 24 fl oz total.'),
('Citrus Degreaser Light','Candidate only: 1.41 fl oz product + 22.59 fl oz water. Intended everyday strength.'),
('Citrus Degreaser Moderate','Candidate only: 12 fl oz product + 12 fl oz water. Applicable compatible surfaces only.'),
('Citrus Degreaser Heavy','Candidate only: 24 fl oz product; no water. Applicable compatible surfaces only.'),
('Neutral Floor Cleaner Light','Candidate only: 1 fl oz per gallon water.'),
('Neutral Floor Cleaner Normal','Candidate only: 2 fl oz per gallon water.'),
('Neutral Floor Cleaner Heavy','Candidate only: 3–5 fl oz per gallon water.');

create or replace function private.inventory_manager() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.user_profiles p where p.id=auth.uid() and p.is_active and p.role in ('Master Admin','Manager')
 and not exists(select 1 from public.employees e where e.id=p.employee_id and e.employment_type='1099'))
$$;
create or replace function private.inventory_employee() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.user_profiles p join public.employees e on e.id=p.employee_id
 where p.id=auth.uid() and p.is_active and p.role in ('Crew Lead','Scrub Technician','Manager','Master Admin')
 and e.employment_status='Active' and e.archived_at is null and e.employment_type is distinct from '1099')
$$;
create or replace function private.inventory_location_access(p_location uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.inventory_manager() or (private.inventory_employee() and exists(
 select 1 from public.technician_inventory_locations l where l.id=p_location and
 (l.employee_id=public.current_employee_id() or exists(select 1 from public.crews c where c.id=l.crew_id and c.crew_lead_id=public.current_employee_id()))))
$$;
revoke all on function private.inventory_manager(),private.inventory_employee(),private.inventory_location_access(uuid) from public,anon;
grant execute on function private.inventory_manager(),private.inventory_employee(),private.inventory_location_access(uuid) to authenticated;

create or replace function private.inventory_audit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.technician_inventory_audit(table_name,record_id,actor,before_row,after_row)
 values(tg_table_name,coalesce(to_jsonb(new)->>'id',to_jsonb(new)->>'item_key',to_jsonb(old)->>'id',to_jsonb(old)->>'item_key',''),auth.uid(),
 case when tg_op<>'INSERT' then to_jsonb(old) end,case when tg_op<>'DELETE' then to_jsonb(new) end);
 return coalesce(new,old);
end $$;
revoke all on function private.inventory_audit() from public,anon,authenticated;

do $$ declare t text; begin
 foreach t in array array['technician_kit_standard_items','technician_towel_standards','technician_inventory_locations','technician_inventory_stock',
 'technician_restock_requests','technician_inventory_transactions','technician_chemical_formulas','technician_inventory_actions','technician_inventory_audit'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to service_role',t);
 if t not in ('technician_inventory_audit','technician_inventory_actions') then
 execute format('create trigger inventory_audit after insert or update or delete on public.%I for each row execute function private.inventory_audit()',t);
 end if;
 end loop;
end $$;
grant select on public.technician_kit_standard_items,public.technician_towel_standards,public.technician_inventory_locations,
public.technician_inventory_stock,public.technician_restock_requests,public.technician_inventory_transactions,public.technician_chemical_formulas,public.technician_inventory_audit to authenticated;
create policy inventory_catalog_read on public.technician_kit_standard_items for select to authenticated using(private.inventory_manager() or private.inventory_employee());
create policy inventory_colors_read on public.technician_towel_standards for select to authenticated using(private.inventory_manager() or private.inventory_employee());
create policy inventory_locations_read on public.technician_inventory_locations for select to authenticated using(private.inventory_location_access(id));
create policy inventory_stock_read on public.technician_inventory_stock for select to authenticated using(private.inventory_location_access(location_id));
create policy inventory_requests_read on public.technician_restock_requests for select to authenticated using(private.inventory_location_access(location_id));
create policy inventory_transactions_read on public.technician_inventory_transactions for select to authenticated using(private.inventory_location_access(location_id));
create policy inventory_formulas_read on public.technician_chemical_formulas for select to authenticated using(private.inventory_manager() or (status='released' and private.inventory_employee()));
create policy inventory_audit_read on public.technician_inventory_audit for select to authenticated using(private.inventory_manager());

-- Writes go exclusively through authenticated, audited RPCs. No client stock UPDATE grants.
create or replace function public.inventory_create_location(p_name text,p_type text,p_employee uuid default null,p_crew uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$ declare result uuid; begin
 if not private.inventory_manager() then raise exception 'Inventory manager required' using errcode='42501'; end if;
 if nullif(btrim(p_name),'') is null then raise exception 'Location name required'; end if;
 if p_employee is not null and not exists(select 1 from public.employees where id=p_employee and employment_status='Active' and archived_at is null and employment_type is distinct from '1099') then raise exception 'Active internal employee required'; end if;
 insert into public.technician_inventory_locations(name,location_type,employee_id,crew_id) values(btrim(p_name),p_type,p_employee,p_crew) returning id into result;
 return result;
end $$;

create or replace function public.inventory_move(p_key uuid,p_item text,p_quantity numeric,p_type text,p_reason text,
 p_source uuid default null,p_destination uuid default null,p_job uuid default null,p_request uuid default null,p_unit_cost numeric default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare payload jsonb; previous public.technician_inventory_actions; destination_item text:=p_item; r public.technician_restock_requests;
begin
 if not private.inventory_manager() then raise exception 'Inventory manager required' using errcode='42501'; end if;
 if p_key is null or p_quantity is null or p_quantity<=0 or p_quantity::text in ('NaN','Infinity','-Infinity') or nullif(btrim(p_reason),'') is null then raise exception 'Positive finite quantity, reason and idempotency key required'; end if;
 if p_source is null and p_destination is null or p_type is null then raise exception 'Movement locations and type required'; end if;
 if p_type='disposal' and not public.is_master_admin() then raise exception 'Master Admin required for disposal' using errcode='42501'; end if;
 if (p_type='purchase' and (p_source is not null or p_destination is null)) or
 (p_type in ('issue','return','transfer','laundry_return') and (p_source is null or p_destination is null)) or
 (p_type in ('consumption','damage','loss','disposal') and (p_source is null or p_destination is not null)) or
 (p_type='adjustment' and ((p_source is null)=(p_destination is null))) or
 p_type not in ('purchase','issue','consumption','return','transfer','adjustment','laundry_return','damage','loss','disposal') or
 (p_source=p_destination and p_type<>'laundry_return') then raise exception 'Invalid movement locations or type'; end if;
 if not exists(select 1 from public.technician_kit_standard_items where item_key=p_item and stock_state<>'aggregate') then raise exception 'Stock must use a leaf inventory item'; end if;
 if p_type='laundry_return' then
 select replace(p_item,'_dirty','_clean') into destination_item;
 if destination_item=p_item or not exists(select 1 from public.technician_kit_standard_items where item_key=destination_item and stock_state='clean') then raise exception 'Laundry return requires dirty microfiber'; end if;
 end if;
 payload:=jsonb_build_object('item',p_item,'quantity',p_quantity,'type',p_type,'reason',p_reason,'source',p_source,'destination',p_destination,'job',p_job,'request',p_request,'unit_cost',p_unit_cost);
 perform pg_advisory_xact_lock(hashtextextended('inventory:'||p_key::text,0));
 select * into previous from public.technician_inventory_actions where id=p_key;
 if found then
 if previous.actor<>auth.uid() or previous.payload<>payload then raise exception 'Idempotency key already used for another action'; end if;
 return p_key;
 end if;
 insert into public.technician_inventory_actions(id,actor,payload) values(p_key,auth.uid(),payload);
 -- All writers lock locations in stable order, including first-time stock rows.
 perform id from public.technician_inventory_locations where id in (p_source,p_destination) order by id for update;
 if p_request is not null then
 select * into r from public.technician_restock_requests where id=p_request for update;
 if not found or p_type<>'issue' or r.status not in ('approved','ready','issued','received') or r.location_id<>p_destination or r.item_key<>p_item or r.issued_quantity+p_quantity>r.requested_quantity then raise exception 'Request cannot be fulfilled with this movement'; end if;
 end if;
 if p_source is not null then
 update public.technician_inventory_stock set quantity=quantity-p_quantity,updated_at=now() where location_id=p_source and item_key=p_item and quantity>=p_quantity;
 if not found then raise exception 'Insufficient source stock'; end if;
 insert into public.technician_inventory_transactions(location_id,item_key,quantity_delta,actor_user_id,reason,idempotency_key,movement_id,transaction_type,job_id,request_id,unit_cost)
 values(p_source,p_item,-p_quantity,auth.uid(),p_reason,gen_random_uuid(),p_key,p_type,p_job,p_request,p_unit_cost);
 end if;
 if p_destination is not null then
 insert into public.technician_inventory_stock(location_id,item_key,quantity) values(p_destination,destination_item,p_quantity)
 on conflict(location_id,item_key) do update set quantity=public.technician_inventory_stock.quantity+excluded.quantity,updated_at=now();
 insert into public.technician_inventory_transactions(location_id,item_key,quantity_delta,actor_user_id,reason,idempotency_key,movement_id,transaction_type,job_id,request_id,unit_cost)
 values(p_destination,destination_item,p_quantity,auth.uid(),p_reason,gen_random_uuid(),p_key,p_type,p_job,p_request,p_unit_cost);
 end if;
 if p_request is not null then update public.technician_restock_requests set issued_quantity=issued_quantity+p_quantity,status='issued' where id=p_request; end if;
 update public.technician_inventory_actions set result=jsonb_build_object('movement_id',p_key) where id=p_key;
 return p_key;
end $$;

create or replace function public.inventory_request_restock(p_location uuid,p_item text,p_current numeric,p_quantity numeric,p_reason text,p_priority text,p_job uuid default null,p_notes text default null)
returns uuid language plpgsql security definer set search_path='' as $$ declare result uuid; target numeric; begin
 if not private.inventory_location_access(p_location) then raise exception 'Assigned inventory access required' using errcode='42501'; end if;
 if p_current::text in ('NaN','Infinity','-Infinity') or p_quantity::text in ('NaN','Infinity','-Infinity') then raise exception 'Finite quantities required'; end if;
 if p_job is not null and not public.can_access_job(p_job) then raise exception 'Job access required' using errcode='42501'; end if;
 select coalesce(s.capacity,i.target) into target from public.technician_kit_standard_items i left join public.technician_inventory_stock s on s.item_key=i.item_key and s.location_id=p_location where i.item_key=p_item and i.stock_state not in ('aggregate','dirty');
 if not found then raise exception 'Select an available stock item'; end if;
 if p_item='bulk_alcohol' and not exists(select 1 from public.technician_inventory_stock where location_id=p_location and item_key=p_item and capacity is not null) then raise exception 'Record the actual alcohol container capacity before requesting replenishment'; end if;
 insert into public.technician_restock_requests(location_id,item_key,requested_by,current_quantity,requested_quantity,target_quantity,reason,priority,job_id,notes)
 values(p_location,p_item,auth.uid(),p_current,p_quantity,target,p_reason,p_priority,p_job,p_notes) returning id into result;
 return result;
end $$;

create or replace function public.inventory_update_request(p_id uuid,p_status text,p_received numeric default null)
returns void language plpgsql security definer set search_path='' as $$ declare r public.technician_restock_requests; begin
 select * into r from public.technician_restock_requests where id=p_id for update;
 if not found or not private.inventory_location_access(r.location_id) then raise exception 'Request access denied' using errcode='42501'; end if;
 if p_status='received' then
 if r.status not in ('issued','received') or p_received is null or p_received<r.received_quantity or p_received>r.issued_quantity then raise exception 'Invalid cumulative received quantity'; end if;
 update public.technician_restock_requests set received_quantity=p_received,status='received' where id=p_id;
 elsif private.inventory_manager() then
 if not ((r.status='submitted' and p_status in ('approved','declined','cancelled')) or
 (r.status='approved' and p_status in ('awaiting_purchase','ready','cancelled')) or
 (r.status='awaiting_purchase' and p_status in ('ready','cancelled')) or
 (r.status='ready' and p_status='cancelled' and r.issued_quantity=0) or
 (r.status='received' and p_status='completed' and r.received_quantity=r.requested_quantity)) then raise exception 'Invalid request transition'; end if;
 update public.technician_restock_requests set status=p_status,reviewed_by=auth.uid(),reviewed_at=now() where id=p_id;
 else raise exception 'Inventory manager required' using errcode='42501'; end if;
end $$;

revoke all on function public.inventory_create_location(text,text,uuid,uuid),public.inventory_move(uuid,text,numeric,text,text,uuid,uuid,uuid,uuid,numeric),
 public.inventory_request_restock(uuid,text,numeric,numeric,text,text,uuid,text),public.inventory_update_request(uuid,text,numeric) from public,anon,authenticated;
grant execute on function public.inventory_create_location(text,text,uuid,uuid),public.inventory_move(uuid,text,numeric,text,text,uuid,uuid,uuid,uuid,numeric),
 public.inventory_request_restock(uuid,text,numeric,numeric,text,text,uuid,text),public.inventory_update_request(uuid,text,numeric) to authenticated;
create or replace function public.inventory_set_standard(p_item text,p_target numeric,p_threshold numeric,p_version text)
returns void language plpgsql security definer set search_path='' as $$ begin
 if not exists(select 1 from public.user_profiles where id=auth.uid() and is_active and role='Master Admin') then raise exception 'Master Admin required' using errcode='42501'; end if;
 if p_target::text in ('NaN','Infinity','-Infinity') or p_threshold::text in ('NaN','Infinity','-Infinity') or nullif(btrim(p_version),'') is null then raise exception 'Finite quantities and version required'; end if;
 if p_item='microfiber' then raise exception 'Edit clean color standards; microfiber totals are derived'; end if;
 update public.technician_kit_standard_items set target=p_target,restock_at=p_threshold,standard_version=p_version where item_key=p_item;
 if not found then raise exception 'Unknown inventory item'; end if;
 if p_item like 'microfiber_%_clean' then
 update public.technician_kit_standard_items set target=(select sum(target) from public.technician_kit_standard_items where parent_key='microfiber' and stock_state='clean'),
 restock_at=(select sum(restock_at) from public.technician_kit_standard_items where parent_key='microfiber' and stock_state='clean'),standard_version=p_version where item_key='microfiber';
 end if;
end $$;
create or replace function public.inventory_set_capacity(p_location uuid,p_item text,p_capacity numeric)
returns void language plpgsql security definer set search_path='' as $$ begin
 if not private.inventory_manager() then raise exception 'Inventory manager required' using errcode='42501'; end if;
 if p_capacity is null or p_capacity<=0 or p_capacity::text in ('NaN','Infinity','-Infinity') then raise exception 'Actual finite container capacity required'; end if;
 insert into public.technician_inventory_stock(location_id,item_key,quantity,capacity) values(p_location,p_item,0,p_capacity)
 on conflict(location_id,item_key) do update set capacity=excluded.capacity,updated_at=now();
end $$;
create or replace function public.inventory_revise_formula(p_id uuid,p_details jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare old public.technician_chemical_formulas; result uuid; begin
 if not exists(select 1 from public.user_profiles where id=auth.uid() and is_active and role='Master Admin') then raise exception 'Master Admin required' using errcode='42501'; end if;
 select * into old from public.technician_chemical_formulas where id=p_id for update;
 if not found then raise exception 'Formula not found'; end if;
 perform pg_advisory_xact_lock(hashtextextended('formula:'||old.name,0));
 if exists(select 1 from public.technician_chemical_formulas where name=old.name and version>old.version) then raise exception 'Revise the latest formula version'; end if;
 if p_details->>'status' not in ('unverified','conflict','released') then raise exception 'Invalid verification status'; end if;
 insert into public.technician_chemical_formulas(name,version,supersedes,status,manufacturer,product_name,sku,label_url,sds_url,
 manufacturer_instructions,preparation,ppe,surface_compatibility,dwell_time,storage_requirements,hazard_labeling,conflict_notes,verified_by,verified_at)
 values(old.name,old.version+1,old.id,p_details->>'status',p_details->>'manufacturer',p_details->>'product_name',p_details->>'sku',p_details->>'label_url',p_details->>'sds_url',
 p_details->>'manufacturer_instructions',p_details->>'preparation',p_details->>'ppe',p_details->>'surface_compatibility',p_details->>'dwell_time',p_details->>'storage_requirements',p_details->>'hazard_labeling',p_details->>'conflict_notes',
 case when p_details->>'status'='released' then auth.uid() end,case when p_details->>'status'='released' then now() end) returning id into result;
 update public.technician_chemical_formulas set status='retired' where name=old.name and status='released' and id<>result;
 return result;
end $$;
revoke all on function public.inventory_set_standard(text,numeric,numeric,text),public.inventory_set_capacity(uuid,text,numeric),public.inventory_revise_formula(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.inventory_set_standard(text,numeric,numeric,text),public.inventory_set_capacity(uuid,text,numeric),public.inventory_revise_formula(uuid,jsonb) to authenticated;
create table public.technician_equipment_assets (
 id uuid primary key default gen_random_uuid(), equipment_number text not null unique check(length(btrim(equipment_number))>0),
 item_key text not null references public.technician_kit_standard_items(item_key),
 location_id uuid references public.technician_inventory_locations(id), brand text, model text, serial_number text,
 condition text not null default 'good' check(condition in ('excellent','good','fair','needs_maintenance','out_of_service','missing','retired')),
 assigned_at timestamptz, acknowledged_at timestamptz, acknowledged_by uuid references public.user_profiles(id),
 maintenance_interval text check(maintenance_interval in ('after_assignment','end_of_day','weekly','monthly')),
 maintenance_due_at timestamptz, manufacturer_instructions text, created_at timestamptz not null default now()
);
create index technician_assets_location on public.technician_equipment_assets(location_id);
create index technician_assets_maintenance_due on public.technician_equipment_assets(maintenance_due_at) where condition<>'retired';
create table public.technician_equipment_maintenance (
 id uuid primary key default gen_random_uuid(), asset_id uuid not null references public.technician_equipment_assets(id),
 reported_by uuid not null references public.user_profiles(id), reported_at timestamptz not null default now(),
 report_type text not null check(report_type in ('maintenance','damage','defective','missing')),
 description text not null check(length(btrim(description))>0), photo_reference text,
 status text not null default 'submitted' check(status in ('submitted','repair_authorized','replacement_authorized','completed')),
 resolution text, completed_by uuid references public.user_profiles(id),completed_at timestamptz,
 check(status<>'completed' or (completed_by is not null and completed_at is not null and nullif(btrim(resolution),'') is not null))
);
create index technician_maintenance_asset on public.technician_equipment_maintenance(asset_id,reported_at desc);
alter table public.technician_equipment_assets enable row level security;
alter table public.technician_equipment_maintenance enable row level security;
revoke all on public.technician_equipment_assets,public.technician_equipment_maintenance from public,anon,authenticated;
grant select on public.technician_equipment_assets,public.technician_equipment_maintenance to authenticated;
create policy inventory_asset_read on public.technician_equipment_assets for select to authenticated using(private.inventory_location_access(location_id));
create policy inventory_maintenance_read on public.technician_equipment_maintenance for select to authenticated using(exists(select 1 from public.technician_equipment_assets a where a.id=asset_id and private.inventory_location_access(a.location_id)));
create trigger inventory_audit after insert or update or delete on public.technician_equipment_assets for each row execute function private.inventory_audit();
create trigger inventory_audit after insert or update or delete on public.technician_equipment_maintenance for each row execute function private.inventory_audit();
create or replace function public.inventory_save_asset(p_id uuid,p_number text,p_item text,p_location uuid,p_condition text,p_interval text default null,p_due timestamptz default null,p_instructions text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare a public.technician_equipment_assets; result uuid; begin
 if not private.inventory_manager() then raise exception 'Inventory manager required' using errcode='42501'; end if;
 if p_condition='retired' and not public.is_master_admin() then raise exception 'Master Admin required for retirement' using errcode='42501'; end if;
 if p_item not in ('bucket','organizer','cart','steamer','vacuum','scraper','brushes','measure_cup','measure_spoons','funnel','goggles','spill_tray') then raise exception 'Only reusable equipment can be serialized'; end if;
 if p_id is null then
 insert into public.technician_equipment_assets(equipment_number,item_key,location_id,condition,assigned_at,maintenance_interval,maintenance_due_at,manufacturer_instructions)
 values(p_number,p_item,p_location,p_condition,case when p_location is not null then now() end,p_interval,p_due,p_instructions) returning id into result;
 else
 select * into a from public.technician_equipment_assets where id=p_id for update;
 if not found then raise exception 'Asset not found'; end if;
 if p_condition in ('excellent','good','fair') and exists(select 1 from public.technician_equipment_maintenance where asset_id=p_id and status<>'completed') then raise exception 'Complete open maintenance reports before returning equipment to service'; end if;
 update public.technician_equipment_assets set equipment_number=p_number,item_key=p_item,location_id=p_location,condition=p_condition,
 assigned_at=case when location_id is distinct from p_location then now() else assigned_at end,
 acknowledged_at=case when location_id is distinct from p_location then null else acknowledged_at end,
 acknowledged_by=case when location_id is distinct from p_location then null else acknowledged_by end,
 maintenance_interval=p_interval,maintenance_due_at=p_due,manufacturer_instructions=p_instructions where id=p_id;
 result:=p_id;
 end if;
 return result;
end $$;
create or replace function public.inventory_acknowledge_asset(p_id uuid) returns void language plpgsql security definer set search_path='' as $$ begin
 update public.technician_equipment_assets set acknowledged_at=now(),acknowledged_by=auth.uid()
 where id=p_id and location_id is not null and private.inventory_employee() and private.inventory_location_access(location_id)
 and exists(select 1 from public.technician_inventory_locations l where l.id=location_id and
 (l.employee_id=public.current_employee_id() or exists(select 1 from public.crews c where c.id=l.crew_id and c.crew_lead_id=public.current_employee_id()))) and acknowledged_at is null;
 if not found then raise exception 'Assigned asset acknowledgment denied' using errcode='42501'; end if;
end $$;
create or replace function public.inventory_report_equipment(p_asset uuid,p_type text,p_description text,p_photo text default null)
returns uuid language plpgsql security definer set search_path='' as $$ declare a public.technician_equipment_assets; result uuid; begin
 select * into a from public.technician_equipment_assets where id=p_asset for update;
 if not found or not private.inventory_location_access(a.location_id) then raise exception 'Assigned asset access required' using errcode='42501'; end if;
 insert into public.technician_equipment_maintenance(asset_id,reported_by,report_type,description,photo_reference) values(p_asset,auth.uid(),p_type,p_description,p_photo) returning id into result;
 update public.technician_equipment_assets set condition=case when p_type='missing' then 'missing' else 'out_of_service' end where id=p_asset;
 return result;
end $$;
create or replace function public.inventory_resolve_equipment(p_report uuid,p_status text,p_resolution text,p_next_due timestamptz default null)
returns void language plpgsql security definer set search_path='' as $$ declare r public.technician_equipment_maintenance; begin
 if not private.inventory_manager() then raise exception 'Inventory manager required' using errcode='42501'; end if;
 select * into r from public.technician_equipment_maintenance where id=p_report for update;
 if not found or r.status='completed' or p_status not in ('repair_authorized','replacement_authorized','completed') then raise exception 'Invalid maintenance transition'; end if;
 update public.technician_equipment_maintenance set status=p_status,resolution=p_resolution,
 completed_by=case when p_status='completed' then auth.uid() end,completed_at=case when p_status='completed' then now() end where id=p_report;
 if p_status='completed' then
 update public.technician_equipment_assets set maintenance_due_at=coalesce(p_next_due,
 case maintenance_interval when 'weekly' then now()+interval '7 days' when 'monthly' then now()+interval '1 month'
 when 'end_of_day' then (date_trunc('day',now() at time zone 'America/Los_Angeles')+interval '1 day') at time zone 'America/Los_Angeles' end) where id=r.asset_id;
 -- A separate explicit condition review is required to return the asset to service.
 end if;
end $$;
revoke all on function public.inventory_save_asset(uuid,text,text,uuid,text,text,timestamptz,text),public.inventory_acknowledge_asset(uuid),public.inventory_report_equipment(uuid,text,text,text),public.inventory_resolve_equipment(uuid,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.inventory_save_asset(uuid,text,text,uuid,text,text,timestamptz,text),public.inventory_acknowledge_asset(uuid),public.inventory_report_equipment(uuid,text,text,text),public.inventory_resolve_equipment(uuid,text,text,timestamptz) to authenticated;
notify pgrst,'reload schema';


