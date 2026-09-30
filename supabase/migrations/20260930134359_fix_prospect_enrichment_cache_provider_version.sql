begin;

create or replace function public.get_prospect_enrichment_inputs(p_run_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'itemId',i.id,
        'resultId',i.discovery_result_id,
        'website',i.official_website_url,
        'canonicalDomain',i.canonical_domain,
        'cacheKey',i.cache_key,
        'locationQuery',d.location_query,
        'input',i.input_snapshot
      )
      order by i.id
    ),
    '[]'::jsonb
  )
  from public.prospect_enrichment_items i
  join public.prospect_enrichment_runs r on r.id=i.run_id
  join public.prospect_discovery_runs d on d.id=r.discovery_run_id
  where i.run_id=p_run_id
    and (select auth.uid()) is not null
    and (
      public.has_any_role(array['Master Admin','Administrator','Manager'])
      or (
        public.has_any_role(array['Sales'])
        and r.created_by=(select auth.uid())
        and d.created_by=(select auth.uid())
        and d.assigned_user_id=(select auth.uid())
      )
    );
$$;

create or replace function public.get_prospect_enrichment_cache(p_cache_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  actor uuid:=(select auth.uid());
  c public.prospect_enrichment_cache;
begin
  if actor is null
     or not public.has_any_role(array['Master Admin','Administrator','Manager','Sales'])
  then
    raise exception 'Prospect enrichment denied.' using errcode='42501';
  end if;

  select * into c
  from public.prospect_enrichment_cache
  where cache_key=p_cache_key
    and expires_at>now();

  if not found then return null; end if;

  return jsonb_build_object(
    'status',c.status,
    'results',c.result_snapshot,
    'fetchedAt',c.fetched_at,
    'providerVersion',c.provider_version
  );
end
$$;

revoke all on function public.get_prospect_enrichment_inputs(uuid),public.get_prospect_enrichment_cache(text)
from public,anon,authenticated;

grant execute on function public.get_prospect_enrichment_inputs(uuid),public.get_prospect_enrichment_cache(text)
to authenticated;

notify pgrst,'reload schema';

commit;
