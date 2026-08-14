-- Phase 19: Service Catalog, pricing and business defaults. REVIEW ONLY. DO NOT RUN AUTOMATICALLY.
create table if not exists public.services (
  id uuid primary key default gen_random_uuid(), service_code text not null unique, service_name text not null,
  division text not null check (division in ('Residential','Commercial','Both')), category text not null,
  description text, pricing_model text not null check (pricing_model in ('Flat Rate','Size Tier','Per Square Foot','Per Bedroom','Per Unit','Per Hour','Per Visit','Custom')),
  pricing_config jsonb not null default '{}'::jsonb, base_price numeric not null default 0 check(base_price>=0), unit_label text,
  minimum_price numeric not null default 0 check(minimum_price>=0), is_recurring_available boolean not null default false,
  is_active boolean not null default true, display_order integer not null default 0, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz
);
create table if not exists public.service_price_tiers (
  id uuid primary key default gen_random_uuid(), service_id uuid not null references public.services(id) on delete cascade,
  tier_name text not null, min_value numeric, max_value numeric, price numeric not null default 0 check(price>=0), unit_label text,
  pricing_config jsonb not null default '{}'::jsonb, display_order integer not null default 0, is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(service_id,tier_name)
);
alter table public.service_price_tiers
add column if not exists pricing_config jsonb not null default '{}'::jsonb;
create table if not exists public.service_addons (
  id uuid primary key default gen_random_uuid(), addon_code text not null unique, addon_name text not null, description text,
  division text not null default 'Both' check(division in ('Residential','Commercial','Both')),
  pricing_model text not null default 'Flat Rate' check (pricing_model in ('Flat Rate','Size Tier','Per Square Foot','Per Bedroom','Per Unit','Per Hour','Per Visit','Custom')),
  pricing_config jsonb not null default '{}'::jsonb, price numeric not null default 0 check(price>=0), unit_label text,
  is_active boolean not null default true, display_order integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz
);
create table if not exists public.service_addon_links (
  service_id uuid not null references public.services(id) on delete cascade,
  addon_id uuid not null references public.service_addons(id) on delete cascade,
  primary key(service_id,addon_id)
);
create table if not exists public.recurring_pricing_rules (
  id uuid primary key default gen_random_uuid(), service_id uuid references public.services(id) on delete cascade,
  frequency text not null, adjustment_type text not null check(adjustment_type in ('Flat Amount','Percentage','Override Price')),
  adjustment_value numeric not null default 0 check(adjustment_value>=0), is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists recurring_pricing_rule_unique_idx on public.recurring_pricing_rules(coalesce(service_id,'00000000-0000-0000-0000-000000000000'::uuid),frequency);
create table if not exists public.business_settings (
  id uuid primary key default '00000000-0000-0000-0000-000000000019'::uuid check(id='00000000-0000-0000-0000-000000000019'::uuid),
  business_name text not null default 'StudioScrubz', tagline text, business_email text, business_phone text, website text,
  address text, city text, state text, zip text, default_tax_rate numeric not null default 0,
  default_estimate_expiration_days integer not null default 30, default_proposal_expiration_days integer not null default 30,
  default_invoice_due_days integer not null default 15, default_payment_terms text, default_invoice_terms text,
  default_proposal_terms text, default_estimate_notes text, currency text not null default 'USD', timezone text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists services_active_order_idx on public.services(is_active,archived_at,display_order);
create index if not exists services_division_idx on public.services(division);
create index if not exists service_tiers_service_idx on public.service_price_tiers(service_id,display_order);
create index if not exists service_addons_active_order_idx on public.service_addons(is_active,archived_at,display_order);
create index if not exists recurring_rules_service_idx on public.recurring_pricing_rules(service_id,frequency);

create or replace function public.phase19_set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke execute on function public.phase19_set_updated_at() from public, anon, authenticated;
drop trigger if exists services_updated_at on public.services; create trigger services_updated_at before update on public.services for each row execute function public.phase19_set_updated_at();
drop trigger if exists service_price_tiers_updated_at on public.service_price_tiers; create trigger service_price_tiers_updated_at before update on public.service_price_tiers for each row execute function public.phase19_set_updated_at();
drop trigger if exists service_addons_updated_at on public.service_addons; create trigger service_addons_updated_at before update on public.service_addons for each row execute function public.phase19_set_updated_at();
drop trigger if exists recurring_pricing_rules_updated_at on public.recurring_pricing_rules; create trigger recurring_pricing_rules_updated_at before update on public.recurring_pricing_rules for each row execute function public.phase19_set_updated_at();
drop trigger if exists business_settings_updated_at on public.business_settings; create trigger business_settings_updated_at before update on public.business_settings for each row execute function public.phase19_set_updated_at();

alter table public.services enable row level security; alter table public.service_price_tiers enable row level security;
alter table public.service_addons enable row level security; alter table public.service_addon_links enable row level security;
alter table public.recurring_pricing_rules enable row level security; alter table public.business_settings enable row level security;
revoke all on
  public.services,
  public.service_price_tiers,
  public.service_addons,
  public.service_addon_links,
  public.recurring_pricing_rules,
  public.business_settings
from public, anon, authenticated;
grant select,insert,update on public.services,public.service_price_tiers,public.service_addons,public.service_addon_links,public.recurring_pricing_rules,public.business_settings to authenticated;
grant delete on public.service_addon_links to authenticated;
do $$ declare t text; begin foreach t in array array['services','service_price_tiers','service_addons','service_addon_links','recurring_pricing_rules'] loop
  execute format('drop policy if exists %I on public.%I','Catalog workflow read',t);
  execute format('drop policy if exists %I on public.%I','Master Admin catalog insert',t);
  execute format('drop policy if exists %I on public.%I','Master Admin catalog update',t);
  execute format('create policy %I on public.%I for select to authenticated using (public.has_any_role(array[''Master Admin'',''Administrator'',''Manager'',''Sales'']))','Catalog workflow read',t);
  execute format('create policy %I on public.%I for insert to authenticated with check (public.is_master_admin())','Master Admin catalog insert',t);
  execute format('create policy %I on public.%I for update to authenticated using (public.is_master_admin()) with check (public.is_master_admin())','Master Admin catalog update',t);
end loop; end; $$;
drop policy if exists "Master Admin removes catalog add-on links" on public.service_addon_links;
create policy "Master Admin removes catalog add-on links"
on public.service_addon_links
for delete
to authenticated
using (public.is_master_admin());
drop policy if exists "Master Admin reads business settings" on public.business_settings;
drop policy if exists "Master Admin inserts business settings" on public.business_settings;
drop policy if exists "Master Admin updates business settings" on public.business_settings;
create policy "Master Admin reads business settings" on public.business_settings for select to authenticated using(public.is_master_admin());
create policy "Master Admin inserts business settings" on public.business_settings for insert to authenticated with check(public.is_master_admin());
create policy "Master Admin updates business settings" on public.business_settings for update to authenticated using(public.is_master_admin()) with check(public.is_master_admin());
create or replace view public.business_settings_public
with (security_barrier = true) as
select
  business_name,
  tagline,
  business_email,
  business_phone,
  website,
  address,
  city,
  state,
  zip,
  currency,
  timezone
from public.business_settings
where (select auth.uid()) is not null;
revoke all on public.business_settings_public from public, anon, authenticated;
grant select on public.business_settings_public to authenticated;

-- Explicit workflow defaults used by Estimate, Proposal, and Invoice creation.
-- Keeping this separate prevents future settings columns from being exposed by SELECT *.
create or replace view public.business_settings_workflow
with (security_barrier = true) as
select
  id,
  business_name,
  tagline,
  business_email,
  business_phone,
  website,
  address,
  city,
  state,
  zip,
  default_tax_rate,
  default_estimate_expiration_days,
  default_proposal_expiration_days,
  default_invoice_due_days,
  default_payment_terms,
  default_invoice_terms,
  default_proposal_terms,
  default_estimate_notes,
  currency,
  timezone,
  created_at,
  updated_at
from public.business_settings
where (select auth.uid()) is not null
  and public.has_any_role(array['Master Admin','Administrator','Manager','Sales']);
revoke all on public.business_settings_workflow from public, anon, authenticated;
grant select on public.business_settings_workflow to authenticated;

-- Seed only prices/formulas discovered in lib/pricing/estimates.ts. DO NOTHING preserves later admin edits on rerun.
insert into public.services(service_code,service_name,division,category,pricing_model,is_recurring_available,display_order) values
('RES-STANDARD','Standard Cleaning','Residential','Standard Cleaning','Size Tier',true,10),
('RES-DEEP','Deep Cleaning','Residential','Deep Cleaning','Size Tier',true,20),
('RES-MOVE','Move-In / Move-Out Cleaning','Residential','Move-In / Move-Out','Size Tier',false,30)
on conflict(service_code) do nothing;
insert into public.services(service_code,service_name,division,category,pricing_model,pricing_config,is_recurring_available,display_order)
select
  v.service_code,
  v.service_name,
  'Commercial',
  v.category,
  'Custom',
  jsonb_build_object(
    'production_rate', v.production_rate,
    'restroom_hours', 0.4,
    'kitchen_hours', 0.55,
    'station_hours', 0.08,
    'unit_hours', 0.22,
    'additional_floor_hours', 0.5,
    'minimum_supply_cost', 18,
    'supply_cost_per_square_foot', 0.018,
    'maximum_margin_percent', 85,
    'minimum_margin_denominator', 0.15
  ),
  true,
  v.display_order
from (values
  ('COM-OFFICE','Office Cleaning','Office',1200,100),
  ('COM-BARBER','Barbershop / Salon Cleaning','Barbershop / Salon',800,110),
  ('COM-GYM','Gym / Spa Cleaning','Gym / Spa',900,120),
  ('COM-RESTAURANT','Restaurant Cleaning','Restaurant',700,130),
  ('COM-STUDIO','Recording Studio Cleaning','Recording Studio Cleaning',1200,140),
  ('COM-TATTOO','Tattoo Shop Cleaning','Tattoo Studio',800,150),
  ('COM-WAREHOUSE','Warehouse Cleaning','Commercial Cleaning',1800,160),
  ('COM-RETAIL','Retail Cleaning','Commercial Cleaning',1200,170),
  ('PM-COMMON','Apartment Building / Complex Cleaning','Property Management',1200,180),
  ('COM-EVENT','Event Venue Cleaning','Commercial Cleaning',1200,190),
  ('COM-OTHER','Other Cleaning','Other',1200,200)
) as v(service_code,service_name,category,production_rate,display_order)
on conflict(service_code) do nothing;
insert into public.service_price_tiers(service_id,tier_name,min_value,max_value,price,unit_label,pricing_config,display_order)
select s.id,v.tier_name,v.min_value,v.max_value,v.price,'Bedrooms',v.pricing_config::jsonb,v.display_order
from public.services s cross join(values
('Studio',0,0,110,'{"bedrooms":0}',0),('1 Bedroom',1,1,135,'{"bedrooms":1}',1),('2 Bedroom',2,2,160,'{"bedrooms":2}',2),('3 Bedroom',3,3,240,'{"bedrooms":3}',3),('4+ Bedrooms',4,null,350,'{"bedrooms":4}',4)
)v(tier_name,min_value,max_value,price,pricing_config,display_order)
where s.service_code = 'RES-STANDARD'
on conflict (service_id, tier_name) do nothing;
insert into public.service_price_tiers(service_id,tier_name,min_value,max_value,price,unit_label,pricing_config,display_order)
select s.id,v.tier_name,v.min_value,v.max_value,v.price,'Bedrooms',v.pricing_config::jsonb,v.display_order
from public.services s cross join(values
('Studio',0,0,160,'{"bedrooms":0}',0),('1 Bedroom',1,1,185,'{"bedrooms":1}',1),('2 Bedroom',2,2,240,'{"bedrooms":2}',2),('3 Bedroom',3,3,300,'{"bedrooms":3}',3),('4+ Bedrooms',4,null,425,'{"bedrooms":4}',4)
)v(tier_name,min_value,max_value,price,pricing_config,display_order)
where s.service_code = 'RES-DEEP'
on conflict (service_id, tier_name) do nothing;
insert into public.service_price_tiers(service_id,tier_name,min_value,max_value,price,unit_label,pricing_config,display_order)
select s.id,v.tier_name,v.min_value,v.max_value,v.price,'Bedrooms',v.pricing_config::jsonb,v.display_order
from public.services s cross join(values
('Studio',0,0,180,'{"bedrooms":0}',0),
('1 Bed / 1 Bath',1,1,225,'{"bedrooms":1,"bathrooms":1}',1),
('2 Bed / 1 Bath',2,2,275,'{"bedrooms":2,"bathrooms":1}',2),
('2 Bed / 2 Bath',2,2,325,'{"bedrooms":2,"bathrooms":2}',3),
('3 Bed / 2 Bath',3,3,385,'{"bedrooms":3,"bathrooms":2}',4)
)v(tier_name,min_value,max_value,price,pricing_config,display_order)
where s.service_code = 'RES-MOVE'
on conflict (service_id, tier_name) do nothing;
insert into public.service_addons(addon_code,addon_name,division,pricing_model,price,display_order) values
('RES-FRIDGE','Inside Refrigerator','Residential','Flat Rate',45,10),('RES-OVEN','Inside Oven','Residential','Flat Rate',40,20),
('RES-WINDOWS','Interior Windows','Residential','Flat Rate',65,30),('RES-CABINETS','Inside Cabinets','Residential','Flat Rate',70,40),
('RES-LAUNDRY','Laundry','Residential','Flat Rate',30,50),('RES-LINENS','Change Bed Linens','Residential','Flat Rate',18,60),
('RES-WALLS','Wall Washing','Residential','Flat Rate',80,70),('RES-GARAGE','Garage Cleaning','Residential','Flat Rate',75,80),
('RES-PATIO','Patio Cleaning','Residential','Flat Rate',55,90)
on conflict (addon_code) do nothing;
insert into public.service_addons(addon_code,addon_name,division,pricing_model,pricing_config,price,display_order) values
('COM-WINDOWS','Interior Windows','Commercial','Custom','{"labor_hours":1.5,"supply_cost":12}',12,110),
('COM-FLOOR','Floor Detail','Commercial','Custom','{"labor_hours":2,"supply_cost":18}',18,120),
('COM-APPLIANCE','Appliance Detail','Commercial','Custom','{"labor_hours":1,"supply_cost":10}',10,130),
('COM-HIGH-DUST','High Dusting','Commercial','Custom','{"labor_hours":1.5,"supply_cost":8}',8,140)
on conflict (addon_code) do nothing;
insert into public.business_settings(id,business_name,default_tax_rate,default_estimate_expiration_days,default_proposal_expiration_days,default_invoice_due_days,default_payment_terms,default_invoice_terms,default_proposal_terms,currency)
values('00000000-0000-0000-0000-000000000019','StudioScrubz',0,30,30,15,'Payment due within 15 days.','Payment due within 15 days.','Payment due upon completion of service.','USD')
on conflict (id) do nothing;
