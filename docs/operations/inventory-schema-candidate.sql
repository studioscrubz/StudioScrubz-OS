-- Review-only schema candidate. Do not apply to production.
begin;
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
 requested_by uuid not null, current_quantity numeric not null check(current_quantity>=0),
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
 quantity_delta numeric not null check(quantity_delta<>0), actor_user_id uuid not null,
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
commit;
