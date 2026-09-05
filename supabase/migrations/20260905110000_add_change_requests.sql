begin;

create sequence public.change_request_number_seq;

create table public.change_requests (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id),
  scope_snapshot_id uuid references public.scope_snapshots(id),
  field_discovery_id uuid references public.field_discoveries(id),
  change_request_number text not null unique,
  status text not null default 'Draft',
  title text not null,
  description text not null,
  area text,
  price_impact numeric not null default 0,
  time_impact_minutes integer not null default 0,
  public_token uuid not null default gen_random_uuid() unique,
  created_by uuid references public.user_profiles(id),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  decided_at timestamptz,
  constraint change_requests_status_check check (status in ('Draft','Sent','Approved','Declined')),
  constraint change_requests_price_check check (price_impact >= 0),
  constraint change_requests_time_check check (time_impact_minutes >= 0)
);

create index change_requests_job_created_idx on public.change_requests(job_id, created_at desc);
create unique index change_requests_discovery_key on public.change_requests(field_discovery_id) where field_discovery_id is not null;

create table public.change_request_items (
  id uuid primary key default gen_random_uuid(),
  change_request_id uuid not null references public.change_requests(id) on delete restrict,
  description text not null,
  quantity numeric,
  unit text,
  unit_price numeric,
  line_total numeric,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint change_request_items_quantity_check check (quantity is null or quantity >= 0),
  constraint change_request_items_unit_price_check check (unit_price is null or unit_price >= 0),
  constraint change_request_items_line_total_check check (line_total is null or line_total >= 0)
);

create index change_request_items_request_idx on public.change_request_items(change_request_id, sort_order);

create table public.change_request_approvals (
  id uuid primary key default gen_random_uuid(),
  change_request_id uuid not null references public.change_requests(id) on delete restrict,
  decision text not null,
  client_name text not null,
  consent boolean not null,
  decided_at timestamptz not null default now(),
  constraint change_request_approvals_decision_check check (decision in ('Approved','Declined')),
  constraint change_request_approvals_request_key unique (change_request_id)
);

alter table public.change_requests enable row level security;
alter table public.change_request_items enable row level security;
alter table public.change_request_approvals enable row level security;
revoke all on table public.change_requests from public, anon, authenticated;
revoke all on table public.change_request_items from public, anon, authenticated;
revoke all on table public.change_request_approvals from public, anon, authenticated;
revoke all on sequence public.change_request_number_seq from public, anon, authenticated;
grant select on table public.change_requests, public.change_request_items, public.change_request_approvals to authenticated;
grant select on table public.change_requests, public.change_request_items, public.change_request_approvals to service_role;

create policy "Master Admin reads full Change Requests" on public.change_requests for select to authenticated using (public.is_master_admin());
create policy "Master Admin reads full Change Request items" on public.change_request_items for select to authenticated using (public.is_master_admin());
create policy "Master Admin reads Change Request approvals" on public.change_request_approvals for select to authenticated using (public.is_master_admin());

create view public.change_requests_operational with (security_barrier = true) as
select id, job_id, scope_snapshot_id, field_discovery_id, change_request_number, status,
  title, description, area, time_impact_minutes, created_by, created_at, sent_at, decided_at
from public.change_requests
where public.has_any_role(array['Master Admin','Administrator','Manager','Sales','Crew Lead','Scrub Technician']);
revoke all on table public.change_requests_operational from public, anon, authenticated;
grant select on table public.change_requests_operational to authenticated;

create or replace function public.create_change_request(
  p_job_id uuid, p_field_discovery_id uuid default null, p_title text default null,
  p_description text default null, p_area text default null, p_price_impact numeric default 0,
  p_time_impact_minutes integer default 0
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_role text; v_id uuid; v_snapshot_id uuid;
begin
  if auth.uid() is null then raise exception 'An active authenticated profile is required.'; end if;
  v_role := public.current_user_role();
  if v_role not in ('Master Admin','Administrator','Manager') then raise exception 'Change Request creation permission denied.'; end if;
  if not public.can_read_operational_photo_record('jobs', p_job_id) then raise exception 'Job not found or outside your permitted scope.'; end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null then raise exception 'Title is required.'; end if;
  if nullif(btrim(coalesce(p_description, '')), '') is null then raise exception 'Description is required.'; end if;
  if coalesce(p_time_impact_minutes, 0) < 0 then raise exception 'Time impact cannot be negative.'; end if;
  if coalesce(p_price_impact, 0) = 'NaN'::numeric or coalesce(p_price_impact, 0) < 0 then raise exception 'Price impact cannot be negative.'; end if;
  if v_role <> 'Master Admin' and coalesce(p_price_impact, 0) <> 0 then raise exception 'Only Master Admin may set Change Request pricing.'; end if;
  if p_field_discovery_id is not null and not exists(select 1 from public.field_discoveries where id = p_field_discovery_id and job_id = p_job_id) then raise exception 'Field Discovery does not belong to this Job.'; end if;
  select id into v_snapshot_id from public.scope_snapshots where job_id = p_job_id and version = 1 limit 1;
  insert into public.change_requests(job_id, scope_snapshot_id, field_discovery_id, change_request_number, title, description, area, price_impact, time_impact_minutes, created_by)
  values (p_job_id, v_snapshot_id, p_field_discovery_id, 'CR-' || lpad(nextval('public.change_request_number_seq')::text, 6, '0'), btrim(p_title), btrim(p_description), nullif(btrim(coalesce(p_area, '')), ''), case when v_role = 'Master Admin' then coalesce(p_price_impact, 0) else 0 end, coalesce(p_time_impact_minutes, 0), auth.uid())
  returning id into v_id;
  if p_field_discovery_id is not null then update public.field_discoveries set status = 'Converted to Change Request' where id = p_field_discovery_id; end if;
  return v_id;
end;
$$;

create or replace function public.update_change_request_draft(
  p_change_request_id uuid, p_title text, p_description text, p_area text,
  p_price_impact numeric, p_time_impact_minutes integer
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_master_admin() then raise exception 'Only Master Admin may finalize Change Request terms.'; end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null or nullif(btrim(coalesce(p_description, '')), '') is null then raise exception 'Title and description are required.'; end if;
  if coalesce(p_price_impact, 0) = 'NaN'::numeric or coalesce(p_price_impact, 0) < 0 or coalesce(p_time_impact_minutes, 0) < 0 then raise exception 'Price and time impact cannot be negative.'; end if;
  update public.change_requests set title=btrim(p_title), description=btrim(p_description), area=nullif(btrim(coalesce(p_area,'')),''), price_impact=coalesce(p_price_impact,0), time_impact_minutes=coalesce(p_time_impact_minutes,0)
  where id=p_change_request_id and status='Draft';
  if not found then raise exception 'Draft Change Request not found.'; end if;
end;
$$;

create or replace function public.add_change_request_item(
  p_change_request_id uuid, p_description text, p_quantity numeric default null,
  p_unit text default null, p_unit_price numeric default null, p_line_total numeric default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_sort integer;
begin
  if auth.uid() is null or not public.is_master_admin() then raise exception 'Only Master Admin may add Change Request items.'; end if;
  if nullif(btrim(coalesce(p_description,'')),'') is null then raise exception 'Item description is required.'; end if;
  if (p_quantity is not null and (p_quantity='NaN'::numeric or p_quantity<0)) or (p_unit_price is not null and (p_unit_price='NaN'::numeric or p_unit_price<0)) or (p_line_total is not null and (p_line_total='NaN'::numeric or p_line_total<0)) then raise exception 'Item values cannot be negative.'; end if;
  if not exists(select 1 from public.change_requests where id=p_change_request_id and status='Draft') then raise exception 'Draft Change Request not found.'; end if;
  select coalesce(max(sort_order),-1)+1 into v_sort from public.change_request_items where change_request_id=p_change_request_id;
  insert into public.change_request_items(change_request_id,description,quantity,unit,unit_price,line_total,sort_order)
  values(p_change_request_id,btrim(p_description),p_quantity,nullif(btrim(coalesce(p_unit,'')),''),p_unit_price,p_line_total,v_sort) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.send_change_request(p_change_request_id uuid)
returns public.change_requests language plpgsql security definer set search_path = '' as $$
declare v_request public.change_requests;
begin
  if auth.uid() is null or not public.is_master_admin() then raise exception 'Only Master Admin may send Change Requests.'; end if;
  select * into v_request from public.change_requests where id=p_change_request_id for update;
  if not found or v_request.status <> 'Draft' then raise exception 'Draft Change Request not found.'; end if;
  if nullif(btrim(v_request.title),'') is null or nullif(btrim(v_request.description),'') is null or v_request.price_impact < 0 or v_request.time_impact_minutes < 0 then raise exception 'Change Request terms are invalid.'; end if;
  update public.change_requests set status='Sent', sent_at=now() where id=v_request.id returning * into v_request;
  return v_request;
end;
$$;

create or replace function public.get_change_request_by_token(p_token uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'change_request_number', request.change_request_number, 'status', request.status,
    'title', request.title, 'description', request.description, 'area', request.area,
    'price_impact', request.price_impact, 'time_impact_minutes', request.time_impact_minutes,
    'sent_at', request.sent_at, 'decided_at', request.decided_at,
    'job_number', job.job_number, 'property_name', job.property_name,
    'service_name', job.service_name,
    'items', coalesce((select jsonb_agg(jsonb_build_object('id',item.id,'description',item.description,'quantity',item.quantity,'unit',item.unit,'unit_price',item.unit_price,'line_total',item.line_total) order by item.sort_order) from public.change_request_items item where item.change_request_id=request.id), '[]'::jsonb)
  )
  from public.change_requests request join public.jobs job on job.id=request.job_id
  where request.public_token=p_token and request.status in ('Sent','Approved','Declined');
$$;

create or replace function public.decide_change_request_by_token(p_token uuid, p_client_name text, p_consent boolean, p_decision text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_request public.change_requests; v_name text := btrim(coalesce(p_client_name,''));
begin
  if length(v_name) < 2 or length(v_name) > 200 then raise exception 'Enter your full name.'; end if;
  if p_consent is not true then raise exception 'Consent is required.'; end if;
  if p_decision not in ('Approved','Declined') then raise exception 'Invalid decision.'; end if;
  select * into v_request from public.change_requests where public_token=p_token for update;
  if not found or v_request.status <> 'Sent' then raise exception 'This Change Request is no longer awaiting a decision.'; end if;
  insert into public.change_request_approvals(change_request_id,decision,client_name,consent) values(v_request.id,p_decision,v_name,true);
  update public.change_requests set status=p_decision, decided_at=now() where id=v_request.id;
  return public.get_change_request_by_token(p_token);
end;
$$;

revoke all on function public.create_change_request(uuid,uuid,text,text,text,numeric,integer) from public,anon,authenticated;
revoke all on function public.update_change_request_draft(uuid,text,text,text,numeric,integer) from public,anon,authenticated;
revoke all on function public.add_change_request_item(uuid,text,numeric,text,numeric,numeric) from public,anon,authenticated;
revoke all on function public.send_change_request(uuid) from public,anon,authenticated;
grant execute on function public.create_change_request(uuid,uuid,text,text,text,numeric,integer) to authenticated;
grant execute on function public.update_change_request_draft(uuid,text,text,text,numeric,integer) to authenticated;
grant execute on function public.add_change_request_item(uuid,text,numeric,text,numeric,numeric) to authenticated;
grant execute on function public.send_change_request(uuid) to authenticated;
revoke all on function public.get_change_request_by_token(uuid) from public,anon,authenticated;
revoke all on function public.decide_change_request_by_token(uuid,text,boolean,text) from public,anon,authenticated;
grant execute on function public.get_change_request_by_token(uuid) to anon,authenticated;
grant execute on function public.decide_change_request_by_token(uuid,text,boolean,text) to anon,authenticated;

notify pgrst, 'reload schema';
commit;
