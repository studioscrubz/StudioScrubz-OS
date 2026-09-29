begin;

create table public.prospects (
  id uuid primary key default gen_random_uuid(),
  company_name text not null check (length(btrim(company_name)) between 1 and 300),
  industry text,
  company_type text,
  website text,
  domain_normalized text,
  business_email text,
  email_normalized text,
  business_phone text,
  phone_normalized text,
  address text,
  city text,
  state text,
  zip text,
  territory text,
  services text[] not null default '{}',
  recurring_potential boolean not null default false,
  estimated_value numeric(12,2) check (estimated_value is null or estimated_value >= 0),
  source_type text not null default 'Manual',
  source_url text,
  discovered_at timestamptz not null default now(),
  verified_at timestamptz,
  verification_status text not null default 'Unverified' check (verification_status in ('Unverified','Pending','Verified','Invalid')),
  score integer not null default 0 check (score between 0 and 100),
  score_explanation text not null default '',
  assigned_user_id uuid references public.user_profiles(id) on delete set null,
  status text not null default 'New' check (status in ('New','Researching','Qualified','Contact Later','Disqualified')),
  next_action text,
  next_follow_up_at timestamptz,
  notes text,
  created_by uuid not null references public.user_profiles(id),
  updated_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.prospect_events (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects(id) on delete restrict,
  event_type text not null check (event_type in ('Created','Assignment Changed','Status Changed','Verification Changed','Notes Changed')),
  actor_user_id uuid not null references public.user_profiles(id),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.prospect_suppressions (
  id uuid primary key default gen_random_uuid(),
  email_normalized text,
  phone_normalized text,
  domain_normalized text,
  reason text not null check (length(btrim(reason)) between 1 and 1000),
  created_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default now(),
  check (num_nonnulls(email_normalized, phone_normalized, domain_normalized) = 1)
);

create unique index prospects_domain_normalized_key on public.prospects(domain_normalized) where domain_normalized is not null;
create unique index prospects_email_normalized_key on public.prospects(email_normalized) where email_normalized is not null;
create unique index prospects_phone_normalized_key on public.prospects(phone_normalized) where phone_normalized is not null;
create index prospects_assigned_status_follow_up_idx on public.prospects(assigned_user_id, status, next_follow_up_at);
create index prospect_events_prospect_created_idx on public.prospect_events(prospect_id, created_at desc);
create unique index prospect_suppressions_email_key on public.prospect_suppressions(email_normalized) where email_normalized is not null;
create unique index prospect_suppressions_phone_key on public.prospect_suppressions(phone_normalized) where phone_normalized is not null;
create unique index prospect_suppressions_domain_key on public.prospect_suppressions(domain_normalized) where domain_normalized is not null;

alter table public.prospects enable row level security;
alter table public.prospect_events enable row level security;
alter table public.prospect_suppressions enable row level security;

create function public.prospect_domain_normalized(value text)
returns text language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(regexp_replace(lower(btrim(value)), '^https?://(www\.)?', ''), '/.*$', ''), '')
$$;

create function public.prospect_phone_normalized(value text)
returns text language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(coalesce(value, ''), '[^0-9]', '', 'g'), '')
$$;

create function public.prospect_score(
  p_territory text, p_industry text, p_recurring boolean,
  p_verification_status text, p_email text, p_phone text,
  p_estimated_value numeric, p_discovered_at timestamptz
)
returns integer language sql stable set search_path = '' as $$
  select least(100,
    case lower(coalesce(p_territory,'')) when 'primary' then 20 when 'core' then 20 when 'local' then 20 when 'secondary' then 10 else 0 end
    + case when lower(coalesce(p_industry,'')) in ('office','property management','medical','restaurant','retail') then 15 else 5 end
    + case when p_recurring then 20 else 0 end
    + case when p_verification_status = 'Verified' and (p_email is not null or p_phone is not null) then 15 else 0 end
    + case when coalesce(p_estimated_value,0) >= 10000 then 20 when coalesce(p_estimated_value,0) >= 5000 then 15 when coalesce(p_estimated_value,0) >= 1000 then 10 else 0 end
    + case when p_discovered_at >= now() - interval '30 days' then 10 when p_discovered_at >= now() - interval '90 days' then 5 else 0 end
  )::integer
$$;

create function public.prepare_prospect_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid());
declare territory_points integer;
declare industry_points integer;
declare recurring_points integer;
declare contact_points integer;
declare value_points integer;
declare freshness_points integer;
begin
  if actor is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  new.company_name := btrim(new.company_name);
  new.email_normalized := nullif(lower(btrim(new.business_email)), '');
  new.phone_normalized := public.prospect_phone_normalized(new.business_phone);
  new.domain_normalized := public.prospect_domain_normalized(coalesce(new.website, split_part(new.email_normalized, '@', 2)));
  if new.assigned_user_id is not null and not exists (
    select 1 from public.user_profiles profile
    where profile.id = new.assigned_user_id and profile.is_active and profile.role = 'Sales'
  ) then raise exception 'Prospects may only be assigned to an active Sales user.' using errcode = '23514'; end if;
  new.score := public.prospect_score(new.territory,new.industry,new.recurring_potential,new.verification_status,new.email_normalized,new.phone_normalized,new.estimated_value,new.discovered_at);
  territory_points := case lower(coalesce(new.territory,'')) when 'primary' then 20 when 'core' then 20 when 'local' then 20 when 'secondary' then 10 else 0 end;
  industry_points := case when lower(coalesce(new.industry,'')) in ('office','property management','medical','restaurant','retail') then 15 else 5 end;
  recurring_points := case when new.recurring_potential then 20 else 0 end;
  contact_points := case when new.verification_status='Verified' and (new.email_normalized is not null or new.phone_normalized is not null) then 15 else 0 end;
  value_points := case when coalesce(new.estimated_value,0)>=10000 then 20 when coalesce(new.estimated_value,0)>=5000 then 15 when coalesce(new.estimated_value,0)>=1000 then 10 else 0 end;
  freshness_points := case when new.discovered_at>=now()-interval '30 days' then 10 when new.discovered_at>=now()-interval '90 days' then 5 else 0 end;
  new.score_explanation := format('Territory %s; industry %s; recurring %s; verified contact %s; value %s; freshness %s.',territory_points,industry_points,recurring_points,contact_points,value_points,freshness_points);
  new.updated_by := actor; new.updated_at := now();
  if tg_op='INSERT' then new.created_by := actor; end if;
  return new;
end
$$;

create function public.record_prospect_events()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid());
begin
  if actor is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if tg_op='INSERT' then
    insert into public.prospect_events(prospect_id,event_type,actor_user_id,details) values(new.id,'Created',actor,jsonb_build_object('status',new.status,'assignedUserId',new.assigned_user_id));
  else
    if new.assigned_user_id is distinct from old.assigned_user_id then insert into public.prospect_events(prospect_id,event_type,actor_user_id,details) values(new.id,'Assignment Changed',actor,jsonb_build_object('from',old.assigned_user_id,'to',new.assigned_user_id)); end if;
    if new.status is distinct from old.status then insert into public.prospect_events(prospect_id,event_type,actor_user_id,details) values(new.id,'Status Changed',actor,jsonb_build_object('from',old.status,'to',new.status)); end if;
    if new.verification_status is distinct from old.verification_status or new.verified_at is distinct from old.verified_at then insert into public.prospect_events(prospect_id,event_type,actor_user_id,details) values(new.id,'Verification Changed',actor,jsonb_build_object('from',old.verification_status,'to',new.verification_status,'verifiedAt',new.verified_at)); end if;
    if new.notes is distinct from old.notes then insert into public.prospect_events(prospect_id,event_type,actor_user_id,details) values(new.id,'Notes Changed',actor,jsonb_build_object('notes',new.notes)); end if;
  end if;
  return new;
end
$$;

create function public.prepare_prospect_suppression()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid());
begin
  if actor is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then raise exception 'Prospect suppression management denied.' using errcode='42501'; end if;
  new.email_normalized := nullif(lower(btrim(new.email_normalized)), '');
  new.phone_normalized := public.prospect_phone_normalized(new.phone_normalized);
  new.domain_normalized := public.prospect_domain_normalized(new.domain_normalized);
  new.created_by := actor;
  return new;
end
$$;

create trigger prospects_prepare before insert or update on public.prospects for each row execute function public.prepare_prospect_write();
create trigger prospects_audit after insert or update on public.prospects for each row execute function public.record_prospect_events();
create trigger prospect_suppressions_prepare before insert on public.prospect_suppressions for each row execute function public.prepare_prospect_suppression();

create policy "Prospect managers read all" on public.prospects for select to authenticated using (public.has_any_role(array['Master Admin','Administrator','Manager']));
create policy "Sales read assigned prospects" on public.prospects for select to authenticated using (public.has_any_role(array['Sales']) and assigned_user_id = (select auth.uid()));
create policy "Prospect managers create" on public.prospects for insert to authenticated with check (public.has_any_role(array['Master Admin','Administrator','Manager']));
create policy "Prospect managers update all" on public.prospects for update to authenticated using (public.has_any_role(array['Master Admin','Administrator','Manager'])) with check (public.has_any_role(array['Master Admin','Administrator','Manager']));
create policy "Sales update assigned prospects" on public.prospects for update to authenticated using (public.has_any_role(array['Sales']) and assigned_user_id = (select auth.uid())) with check (public.has_any_role(array['Sales']) and assigned_user_id = (select auth.uid()));

create policy "Authorized prospect events read" on public.prospect_events for select to authenticated using (
  public.has_any_role(array['Master Admin','Administrator','Manager']) or
  (public.has_any_role(array['Sales']) and exists(select 1 from public.prospects p where p.id=prospect_id and p.assigned_user_id=(select auth.uid())))
);
create policy "Prospect team reads suppressions" on public.prospect_suppressions for select to authenticated using (public.has_any_role(array['Master Admin','Administrator','Manager','Sales']));
create policy "Prospect managers create suppressions" on public.prospect_suppressions for insert to authenticated with check (public.has_any_role(array['Master Admin','Administrator','Manager']));

create function public.get_prospect_assignees()
returns table(id uuid, display_name text)
language sql stable security definer set search_path = '' as $$
  select profile.id, coalesce(nullif(btrim(profile.display_name),''),profile.email,'Sales User')
  from public.user_profiles profile
  where (select auth.uid()) is not null
    and public.has_any_role(array['Master Admin','Administrator','Manager'])
    and profile.is_active and profile.role='Sales'
  order by 2,1
$$;

revoke all on table public.prospects, public.prospect_events, public.prospect_suppressions from public, anon, authenticated;
grant select,insert,update on table public.prospects to authenticated;
grant select on table public.prospect_events to authenticated;
grant select,insert on table public.prospect_suppressions to authenticated;
revoke all on function public.prospect_domain_normalized(text), public.prospect_phone_normalized(text), public.prospect_score(text,text,boolean,text,text,text,numeric,timestamptz), public.prepare_prospect_write(), public.record_prospect_events(), public.prepare_prospect_suppression(), public.get_prospect_assignees() from public,anon,authenticated;
grant execute on function public.get_prospect_assignees() to authenticated;

notify pgrst,'reload schema';
commit;
