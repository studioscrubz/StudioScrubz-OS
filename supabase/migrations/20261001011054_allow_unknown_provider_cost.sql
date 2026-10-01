begin;

alter table public.prospect_enrichment_provider_calls
  alter column cost_minor_units drop not null,
  alter column cost_minor_units drop default,
  drop constraint if exists prospect_enrichment_provider_calls_check,
  drop constraint if exists prospect_enrichment_provider_calls_cost_minor_units_check;

alter table public.prospect_enrichment_provider_calls
  add constraint prospect_enrichment_provider_calls_cost_minor_units_check
    check(cost_minor_units is null or cost_minor_units>=0),
  add constraint prospect_enrichment_provider_calls_cost_requires_currency_check
    check(cost_minor_units is null or cost_minor_units=0 or cost_currency is not null);

alter table public.prospect_enrichment_fields
  alter column cost_minor_units drop not null,
  alter column cost_minor_units drop default,
  drop constraint if exists prospect_enrichment_fields_cost_check,
  drop constraint if exists prospect_enrichment_fields_cost_currency_check;

alter table public.prospect_enrichment_fields
  add constraint prospect_enrichment_fields_cost_check
    check(cost_minor_units is null or cost_minor_units>=0),
  add constraint prospect_enrichment_fields_cost_currency_check
    check(cost_minor_units is null or cost_minor_units=0 or cost_currency is not null);

create function public.prospect_enrichment_inherit_unknown_call_cost()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.provider_call_id is not null and exists(
    select 1 from public.prospect_enrichment_provider_calls c
    where c.id=new.provider_call_id and c.cost_minor_units is null
  ) then
    new.cost_minor_units:=null;
    new.cost_currency:=null;
  end if;
  return new;
end $$;

create trigger prospect_enrichment_fields_unknown_call_cost
before insert or update of provider_call_id,cost_minor_units on public.prospect_enrichment_fields
for each row execute function public.prospect_enrichment_inherit_unknown_call_cost();

create or replace function public.complete_prospect_enrichment_provider_call(
  p_provider_call_id uuid,
  p_status text,
  p_cache_hit boolean default false,
  p_provider_request_id text default null,
  p_credits_used numeric default 0,
  p_cost_minor_units bigint default null,
  p_cost_currency text default null,
  p_http_status integer default null,
  p_error_code text default null,
  p_response_metadata jsonb default '{}'::jsonb
)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); call public.prospect_enrichment_provider_calls; run public.prospect_enrichment_runs;
begin
  if actor is null or p_status not in('Completed','No Data','Failed')
     or coalesce(p_credits_used,-1)<0
     or (p_cost_minor_units is not null and p_cost_minor_units<0)
     or (p_cost_currency is not null and p_cost_currency !~ '^[A-Z]{3}$')
     or (p_cost_minor_units is not null and p_cost_minor_units<>0 and p_cost_currency is null)
     or (p_http_status is not null and p_http_status not between 100 and 599)
     or jsonb_typeof(coalesce(p_response_metadata,'{}'::jsonb))<>'object'
     or pg_column_size(coalesce(p_response_metadata,'{}'::jsonb))>16384
     or coalesce(p_response_metadata,'{}'::jsonb)::text ~* '"(authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|secret|password|cookie|raw[-_]?response|html)"\s*:'
  then raise exception 'Invalid provider call completion.'; end if;

  select * into call from public.prospect_enrichment_provider_calls where id=p_provider_call_id for update;
  if not found then raise exception 'Provider call unavailable.'; end if;
  if call.status<>'In Progress' then raise exception 'Provider call already completed.'; end if;
  select * into run from public.prospect_enrichment_runs where id=call.enrichment_run_id;
  if not(
    public.has_any_role(array['Master Admin','Administrator','Manager'])
    or (public.has_any_role(array['Sales']) and run.created_by=actor and exists(
      select 1 from public.prospect_discovery_runs d
      where d.id=run.discovery_run_id and d.created_by=actor and d.assigned_user_id=actor
    ))
  ) then raise exception 'Prospect enrichment denied.' using errcode='42501'; end if;

  update public.prospect_enrichment_provider_calls set
    status=p_status,cache_hit=coalesce(p_cache_hit,false),completed_at=now(),
    provider_request_id=nullif(left(btrim(p_provider_request_id),500),''),
    credits_used=p_credits_used,cost_minor_units=p_cost_minor_units,cost_currency=p_cost_currency,
    http_status=p_http_status,error_code=nullif(left(btrim(p_error_code),200),''),
    response_metadata=coalesce(p_response_metadata,'{}'::jsonb)
  where id=call.id;
end $$;

revoke all on function public.prospect_enrichment_inherit_unknown_call_cost(),public.complete_prospect_enrichment_provider_call(uuid,text,boolean,text,numeric,bigint,text,integer,text,jsonb)
from public,anon,authenticated;

grant execute on function public.complete_prospect_enrichment_provider_call(uuid,text,boolean,text,numeric,bigint,text,integer,text,jsonb)
to authenticated;

notify pgrst,'reload schema';
commit;
